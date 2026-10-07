import { z } from 'zod';

import type { SessionStore } from '../auth/store';
import { synchronizeClock, type ServerClock } from '../game/rounds';
import {
  authSchema, gameSchema, guessSchema, leaderboardSchema, problemSchema,
  type AuthResult, type BoardFilter, type Game, type Side,
} from './contracts';
import { CancelledRequest, ClientError, describeError } from './errors';

export interface SessionSnapshot {
  status: 'loading' | 'signed-out' | 'signed-in';
  auth: AuthResult | null;
  generation: number;
  notice: string | null;
  storageWarning: string | null;
  cleanupRequired: boolean;
}

export interface GameSnapshot {
  game: Game;
  clock: ServerClock;
}

interface ResponseEnvelope<T> {
  data: T;
  startedAt: number;
  receivedAt: number;
  monotonicAtReceipt: number;
}

interface ClientOptions {
  baseUrl: string;
  store: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
  monotonicNow?: () => number;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: object;
  token?: string;
  signal?: AbortSignal;
}

export class ApiClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly controllers = new Set<AbortController>();
  private readonly listeners = new Set<() => void>();
  private persistence: Promise<void> = Promise.resolve();
  private refreshFlight: { generation: number; promise: Promise<AuthResult> } | null = null;
  private restoreFlight: Promise<void> | null = null;
  private generation = 0;
  private snapshot: SessionSnapshot = {
    status: 'loading', auth: null, generation: 0, notice: null,
    storageWarning: null, cleanupRequired: false,
  };

  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(update: Partial<SessionSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...update,
      generation: this.generation,
      storageWarning: this.options.store.warning(),
    };
    this.listeners.forEach((listener) => listener());
  }

  private assertCurrent(generation: number) {
    if (generation !== this.generation) throw new CancelledRequest();
  }

  private persist<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.persistence.then(operation);
    this.persistence = result.then(() => undefined, () => undefined);
    return result;
  }

  private invalidate(notice: string | null) {
    this.generation += 1;
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.refreshFlight = null;
    this.publish({ status: 'signed-out', auth: null, notice });
    return this.generation;
  }

  restore(): Promise<void> {
    if (this.restoreFlight) return this.restoreFlight;
    this.restoreFlight = this.restoreSession();
    return this.restoreFlight;
  }

  private async restoreSession(): Promise<void> {
    const generation = this.generation;
    try {
      const auth = await this.persist(() => this.options.store.read());
      this.assertCurrent(generation);
      this.publish({ auth, status: auth ? 'signed-in' : 'signed-out' });
    } catch (error) {
      if (error instanceof CancelledRequest) return;
      if (generation !== this.generation) return;
      this.publish({
        status: 'signed-out', auth: null, notice: describeError(error), cleanupRequired: true,
      });
    }
  }

  async signOut(notice: string | null = null): Promise<void> {
    const generation = this.invalidate(notice);
    try {
      await this.persist(() => this.options.store.clear());
      this.assertCurrent(generation);
      this.publish({ cleanupRequired: false });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ cleanupRequired: true, notice: describeError(error) });
    }
  }

  async login(inviteCode: string, displayName: string): Promise<void> {
    const name = displayName.trim();
    if (name.length < 1 || name.length > 60 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
      throw new ClientError('http', 'Use a display name of 1 to 60 characters, without control characters.', 400);
    }
    if (inviteCode.length < 32 || inviteCode.length > 256 || /[\s\u0085]/u.test(inviteCode)) {
      throw new ClientError('http', 'Enter the complete invite code (32 to 256 characters, with no spaces).', 400);
    }
    const generation = this.invalidate(null);
    try {
      await this.persist(() => this.options.store.clear());
      this.assertCurrent(generation);
      this.publish({ cleanupRequired: false });
      const result = await this.raw('/api/test/login', authSchema, generation, {
        method: 'POST', body: { inviteCode, displayName: name },
      });
      await this.saveAuth(result.data, generation);
    } catch (error) {
      if (generation !== this.generation) throw new CancelledRequest();
      if (error instanceof ClientError && error.kind === 'storage') {
        await this.signOut(error.message);
      }
      throw error;
    }
  }

  private async saveAuth(auth: AuthResult, generation: number) {
    await this.persist(async () => {
      this.assertCurrent(generation);
      await this.options.store.write(auth);
    });
    this.assertCurrent(generation);
    this.publish({ auth, status: 'signed-in', notice: null, cleanupRequired: false });
  }

  private refresh(generation: number): Promise<AuthResult> {
    this.assertCurrent(generation);
    if (this.refreshFlight?.generation === generation) return this.refreshFlight.promise;
    const auth = this.snapshot.auth;
    if (!auth) return Promise.reject(new ClientError('session', 'Please sign in to continue.'));
    const promise = this.rotate(auth, generation);
    const flight = { generation, promise };
    this.refreshFlight = flight;
    void promise.finally(() => {
      if (this.refreshFlight === flight) this.refreshFlight = null;
    }).catch(() => { /* The caller receives the refresh rejection. */ });
    return promise;
  }

  private async rotate(auth: AuthResult, generation: number): Promise<AuthResult> {
    try {
      const result = await this.raw('/api/auth/refresh', authSchema, generation, {
        method: 'POST', body: { refreshToken: auth.refreshToken },
      });
      if (result.data.userId !== auth.userId) {
        throw new ClientError('session', 'The refreshed session did not match your account. Please sign in again.');
      }
      await this.saveAuth(result.data, generation);
      return result.data;
    } catch (error) {
      if (generation !== this.generation) throw new CancelledRequest();
      if (error instanceof ClientError && (
        [400, 401, 403].includes(error.status ?? 0)
        || ['session', 'storage', 'invalid-response'].includes(error.kind)
      )) {
        await this.signOut(error.kind === 'storage' ? error.message : 'Your session expired. Sign in again with your invite code.');
        throw new ClientError('session', 'Your session expired. Please sign in again.');
      }
      throw error;
    }
  }

  private async authenticated<T>(
    path: string,
    schema: z.ZodType<T>,
    options: Omit<RequestOptions, 'token'> = {},
  ): Promise<ResponseEnvelope<T>> {
    const generation = this.generation;
    let auth = this.snapshot.auth;
    if (!auth) throw new ClientError('session', 'Please sign in to continue.');
    if (Date.parse(auth.accessTokenExpiresAt) <= this.now() + 30_000) {
      auth = await this.refresh(generation);
    }
    try {
      return await this.raw(path, schema, generation, { ...options, token: auth.accessToken });
    } catch (error) {
      if (!(error instanceof ClientError) || error.status !== 401) throw error;
      this.assertCurrent(generation);
      // A delayed 401 may arrive after another request has already rotated the token.
      const current = this.snapshot.auth;
      const refreshed = current && current.accessToken !== auth.accessToken
        ? current
        : await this.refresh(generation);
      try {
        return await this.raw(path, schema, generation, { ...options, token: refreshed.accessToken });
      } catch (retryError) {
        if (retryError instanceof ClientError && retryError.status === 401) {
          this.assertCurrent(generation);
          await this.signOut('Your session is no longer accepted. Please sign in again.');
        }
        throw retryError;
      }
    }
  }

  async game(signal?: AbortSignal): Promise<GameSnapshot> {
    const result = await this.authenticated('/api/test/game', gameSchema, { signal });
    return {
      game: result.data,
      clock: synchronizeClock(result.data.serverTimeUtc, result.startedAt, result.receivedAt, result.monotonicAtReceipt),
    };
  }

  async submit(questionId: string, pick: Side | null, signal?: AbortSignal) {
    const result = await this.authenticated('/api/guesses', guessSchema, {
      method: 'POST', body: { questionId, pick, skip: pick === null }, signal,
    });
    if (result.data.questionId !== questionId || result.data.pick !== pick || result.data.isSkip !== (pick === null)) {
      throw new ClientError('invalid-response', 'The server confirmation did not match this call. Refresh before trying again.');
    }
    return result.data;
  }

  async leaderboard(filter: BoardFilter, signal?: AbortSignal) {
    const query = new URLSearchParams({ type: filter.type, scope: 'Global' });
    if ('category' in filter) query.set('category', filter.category);
    const result = await this.authenticated(`/api/leaderboards?${query}`, leaderboardSchema, { signal });
    if (result.data.type !== filter.type || result.data.scope !== 'Global'
      || result.data.categoryCode !== ('category' in filter ? filter.category : null)) {
      throw new ClientError('invalid-response', 'The returned leaderboard did not match the selected filter. Please retry.');
    }
    return result.data;
  }

  private async raw<T>(
    path: string,
    schema: z.ZodType<T>,
    generation: number,
    options: RequestOptions,
  ): Promise<ResponseEnvelope<T>> {
    this.assertCurrent(generation);
    if (options.signal?.aborted) throw new CancelledRequest();
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs ?? 15_000);
    const startedAt = this.now();
    try {
      const response = await this.fetcher(`${this.options.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      const receivedAt = this.now();
      const monotonicAtReceipt = this.monotonicNow();
      this.assertCurrent(generation);
      if (options.signal?.aborted) throw new CancelledRequest();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        if (response.ok) throw new ClientError('invalid-response', 'The API returned an unreadable response. Check the TEST API address and retry.');
      }
      if (!response.ok) {
        const problem = problemSchema.safeParse(body);
        const fallback = response.status === 401
          ? 'Your session is no longer accepted.'
          : response.status === 404
            ? 'The TEST game is unavailable at this address. Check that TEST mode is enabled.'
            : response.status === 429
              ? 'Too many requests. Wait a moment, then retry.'
              : `The request failed (${response.status}). Please retry.`;
        const validation = problem.success && problem.data.errors
          ? Object.values(problem.data.errors).flat().join(' ')
          : null;
        throw new ClientError('http', problem.success
          ? (problem.data.detail || validation || problem.data.title || fallback)
          : fallback, response.status);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ClientError('invalid-response', 'The API returned an unexpected response. Refresh or check that the client and TEST API versions match.');
      }
      return { data: parsed.data, startedAt, receivedAt, monotonicAtReceipt };
    } catch (error) {
      if (generation !== this.generation || options.signal?.aborted) throw new CancelledRequest();
      if (error instanceof ClientError || error instanceof CancelledRequest) throw error;
      if (timedOut) throw new ClientError('timeout', 'The request timed out. Live updates are paused; check your connection and retry.');
      throw new ClientError('network', 'Cannot reach the TEST API. Live updates are paused; check your connection and retry.');
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}

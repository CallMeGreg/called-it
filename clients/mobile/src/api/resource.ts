import { CancelledRequest, ClientError, describeError } from './errors';

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: ClientError | null };

interface ResourceSnapshot<T> {
  data: T | null;
  error: ClientError | null;
  busy: boolean;
}

export class PollingResource<T> {
  private snapshot: ResourceSnapshot<T> = { data: null, error: null, busy: false };
  private readonly listeners = new Set<() => void>();
  private active = false;
  private request: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly load: (signal: AbortSignal) => Promise<T>,
    private readonly intervalMs: number,
  ) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(update: Partial<ResourceSnapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }

  private cancelTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  resume() {
    this.active = true;
    return this.refresh();
  }

  pause() {
    this.active = false;
    this.cancelTimer();
    this.request?.abort();
    this.request = null;
    if (this.snapshot.busy) this.publish({ busy: false });
  }

  refresh = async (): Promise<LoadResult<T>> => {
    if (!this.active) return { ok: false, error: null };
    this.cancelTimer();
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.publish({ busy: true, error: null });
    let succeeded = false;
    try {
      const data = await this.load(controller.signal);
      if (this.request !== controller || controller.signal.aborted) return { ok: false, error: null };
      this.publish({ data });
      succeeded = true;
      return { ok: true, data };
    } catch (cause) {
      if (cause instanceof CancelledRequest || controller.signal.aborted || this.request !== controller) {
        return { ok: false, error: null };
      }
      const error = cause instanceof ClientError
        ? cause
        : new ClientError('invalid-response', describeError(cause));
      this.publish({ error });
      return { ok: false, error };
    } finally {
      if (this.request === controller) {
        this.request = null;
        this.publish({ busy: false });
        if (succeeded && this.active) {
          this.timer = setTimeout(() => { void this.refresh(); }, this.intervalMs);
        }
      }
    }
  };
}

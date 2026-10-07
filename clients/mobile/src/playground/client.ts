import type { BoardFilter, CategoryCode, Leaderboard, Side } from '../api/contracts';
import { CancelledRequest, ClientError, describeError } from '../api/errors';
import type { GameClient, GameSnapshot } from '../api/game-client';
import {
  advanceClock, chooseOutcome, demoPlayer, initialPlayground, lockRound, publishOutcomes, savePick,
  type OutcomeChoice, type PlaygroundState,
} from './model';
import { PlaygroundStorage } from './storage';

interface PlaygroundSnapshot {
  state: PlaygroundState | null;
  error: string | null;
  generation: number;
}

export class PlaygroundClient implements GameClient {
  private snapshot: PlaygroundSnapshot = { state: null, error: null, generation: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly gameListeners = new Set<() => void>();

  constructor(
    private readonly storage: PlaygroundStorage,
    private readonly now = Date.now,
    private readonly monotonicNow = () => performance.now(),
  ) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribeGame = (listener: () => void) => {
    this.gameListeners.add(listener);
    return () => { this.gameListeners.delete(listener); };
  };

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  load = () => {
    try {
      const state = this.storage.load(this.now());
      this.snapshot = { state, error: null, generation: this.snapshot.generation + 1 };
      this.notify();
      this.gameListeners.forEach((listener) => listener());
    } catch (error) {
      this.snapshot = { ...this.snapshot, state: null, error: describeError(error) };
      this.notify();
    }
  };

  private requireState(signal?: AbortSignal) {
    if (signal?.aborted) throw new CancelledRequest();
    if (!this.snapshot.state) throw new ClientError('storage', this.snapshot.error ?? 'The local demo has not loaded yet.');
    return this.snapshot.state;
  }

  private commit(next: PlaygroundState, reset = false) {
    if (!reset && next === this.snapshot.state) return;
    try {
      this.storage.save(next, reset);
    } catch (error) {
      this.snapshot = { ...this.snapshot, error: describeError(error) };
      this.notify();
      throw error;
    }
    this.snapshot = { state: next, error: null, generation: this.snapshot.generation + (reset ? 1 : 0) };
    this.notify();
    this.gameListeners.forEach((listener) => listener());
  }

  async game(signal?: AbortSignal): Promise<GameSnapshot> {
    const state = this.requireState(signal);
    return {
      game: structuredClone(state.game),
      clock: { serverAtSyncMs: Date.parse(state.game.serverTimeUtc), monotonicAtSyncMs: this.monotonicNow(), rate: 0 },
    };
  }

  async submit(questionId: string, pick: Side | null, signal?: AbortSignal) {
    const next = savePick(this.requireState(signal), questionId, pick);
    this.commit(next);
    const question = next.game.currentRound.questions.find((item) => item.questionId === questionId);
    if (!question) throw new ClientError('invalid-response', 'The local question is missing after saving.');
    return {
      questionId, categoryCode: question.categoryCode, pick,
      isSkip: pick === null, submittedAt: next.game.serverTimeUtc,
    };
  }

  async leaderboard(filter: BoardFilter, signal?: AbortSignal): Promise<Leaderboard> {
    const { stats } = this.requireState(signal).game;
    let score: number;
    if ('category' in filter) {
      const category = stats.categories.find((item) => item.categoryCode === filter.category);
      if (!category) throw new ClientError('http', 'That category is not available in the local demo.', 400);
      score = filter.type === 'CategoryStreak' ? category.currentStreak : category.bestStreak;
    } else {
      score = filter.type === 'TotalScore' ? stats.totalScore : stats.overallStreak;
    }
    return {
      type: filter.type, scope: 'Global', categoryCode: 'category' in filter ? filter.category : null,
      rows: [{ ...demoPlayer, rank: 1, score, isMe: true }],
    };
  }

  fastForward(roundId: string) {
    this.commit(advanceClock(this.requireState(), roundId, 30));
  }

  lock(roundId: string) {
    this.commit(lockRound(this.requireState(), roundId));
  }

  choose(roundId: string, category: CategoryCode, outcome: OutcomeChoice) {
    this.commit(chooseOutcome(this.requireState(), roundId, category, outcome));
  }

  publish(roundId: string) {
    this.commit(publishOutcomes(this.requireState(), roundId));
  }

  reset() {
    this.commit(initialPlayground(this.now()), true);
  }
}

import type { ServerClock } from '../game/rounds';
import type { BoardFilter, Game, GuessResult, Leaderboard, Side } from './contracts';

export interface GameSnapshot {
  game: Game;
  clock: ServerClock;
}

export interface GameClient {
  game(signal?: AbortSignal): Promise<GameSnapshot>;
  submit(questionId: string, pick: Side | null, signal?: AbortSignal): Promise<GuessResult>;
  leaderboard(filter: BoardFilter, signal?: AbortSignal): Promise<Leaderboard>;
  subscribeGame?: (listener: () => void) => () => void;
}

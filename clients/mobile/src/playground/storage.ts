import { ClientError } from '../api/errors';
import { initialPlayground, playgroundStateSchema, type PlaygroundState } from './model';

export const PLAYGROUND_KEY = 'called_it_local_playground_v1';
type LocalStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class PlaygroundStorage {
  private expected: string | null = null;

  constructor(private readonly storage: () => LocalStorage) {}

  load(now: number): PlaygroundState {
    try {
      this.expected = this.storage().getItem(PLAYGROUND_KEY);
    } catch {
      throw new ClientError('storage', 'Local demo storage is unavailable. Enable browser storage and retry; no temporary save is being substituted.');
    }
    if (this.expected === null) {
      const state = initialPlayground(now);
      this.save(state);
      return state;
    }
    let value: unknown;
    try {
      value = JSON.parse(this.expected);
    } catch {
      throw new ClientError('storage', 'The local demo save is unreadable. Retry loading or deliberately reset the demo.');
    }
    const parsed = playgroundStateSchema.safeParse(value);
    if (!parsed.success) throw new ClientError('storage', 'The local demo save is invalid or from another version. Reset the demo to continue.');
    return parsed.data;
  }

  save(state: PlaygroundState, reset = false) {
    const parsed = playgroundStateSchema.safeParse(state);
    if (!parsed.success) throw new ClientError('storage', 'The local demo state is inconsistent. The action was not saved.');
    const encoded = JSON.stringify(parsed.data);
    try {
      const storage = this.storage();
      if (!reset && storage.getItem(PLAYGROUND_KEY) !== this.expected) {
        throw new ClientError('storage', 'Another tab changed this demo. Reload the saved demo before making more changes.');
      }
      storage.setItem(PLAYGROUND_KEY, encoded);
      this.expected = encoded;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError('storage', 'The local demo could not be saved. No action was applied. Check browser storage, then retry.');
    }
  }
}

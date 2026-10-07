export type ErrorKind = 'http' | 'network' | 'timeout' | 'invalid-response' | 'session' | 'storage' | 'configuration';

export class ClientError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ClientError';
  }

  get isSubmissionLocked() {
    return this.status === 423;
  }
}

export class CancelledRequest extends Error {
  constructor() {
    super('The request was cancelled.');
    this.name = 'CancelledRequest';
  }
}

export function describeError(error: unknown): string {
  return error instanceof ClientError
    ? error.message
    : 'Something unexpected happened. Please refresh and try again.';
}

export class Failure extends Error {
  constructor(public readonly code: string, public readonly unknownOutcome = false, public readonly retryable = false) {
    super(code);
    this.name = 'Failure';
  }
}
export function code(error: unknown): string {
  return error instanceof Failure ? error.code : 'internal_error';
}
export function check(signal: AbortSignal): void {
  if (signal.aborted) throw new Failure('cancelled');
}
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  check(signal);
  let listener: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    listener = () => reject(new Failure('cancelled'));
    signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', listener!); }
}

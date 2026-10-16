const BRAND = Symbol.for('neighborline.HttpError');

/** Thrown by service implementations; route handlers turn it into an HTTP status + JSON error. */
export class HttpError extends Error {
  readonly [BRAND] = true;
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Structural check: in `next dev` each route can get its own copy of this module, so an error thrown
 * by the engine (created in another route's bundle) is not `instanceof` this route's HttpError.
 */
export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError || (typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[BRAND] === true);
}

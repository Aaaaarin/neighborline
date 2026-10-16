/** Thrown by service implementations; route handlers turn it into an HTTP status + JSON error. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** PayPal-shaped error bodies: `{name, message, debug_id, information_link, details?, links?}`. */
import { HttpError } from './http.js';

export interface ErrorDetail {
  field?: string;
  value?: string;
  location?: 'body' | 'path' | 'query' | 'header';
  issue: string;
  description?: string;
  link?: Array<{ href: string; rel: string; method: string; encType?: string }>;
}

let debugIdGen: () => string = () => Math.random().toString(16).slice(2, 15).padEnd(13, '0');
export function setDebugIdGenerator(fn: () => string): void {
  debugIdGen = fn;
}

const STANDARD_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: 'Request is not well-formed, syntactically incorrect, or violates schema.',
  VALIDATION_ERROR: 'Invalid request - see details',
  UNPROCESSABLE_ENTITY: 'The requested action could not be performed, semantically incorrect, or failed business validation.',
  RESOURCE_NOT_FOUND: 'The specified resource does not exist.',
  INVALID_RESOURCE_ID: 'Requested resource ID was not found.',
  INTERNAL_SERVER_ERROR: 'An internal server error has occurred.',
  RATE_LIMIT_REACHED: 'Too many requests. Blocked due to rate limiting.',
  AUTHENTICATION_FAILURE: 'Authentication failed due to invalid authentication credentials or a missing Authorization header.',
  NOT_AUTHORIZED: 'Authorization failed due to insufficient permissions.',
  USER_BUSINESS_ERROR: 'User business error.',
  MALFORMED_REQUEST_JSON: 'The request JSON is not well formed.',
};

export function errorBody(name: string, message?: string, details?: ErrorDetail[], api = 'payments.payouts-batch') {
  return {
    name,
    message: message ?? STANDARD_MESSAGES[name] ?? name,
    debug_id: debugIdGen(),
    information_link: `https://developer.paypal.com/docs/api/${api}/#errors`,
    ...(details && details.length ? { details } : {}),
    links: [] as unknown[],
  };
}

export function ppError(status: number, name: string, message?: string, details?: ErrorDetail[], api?: string): HttpError {
  return new HttpError(status, errorBody(name, message, details, api));
}

export const validation = (details: ErrorDetail[], api?: string) => ppError(400, 'VALIDATION_ERROR', undefined, details, api);
export const unprocessable = (issue: string, description: string, api = 'orders/v2') =>
  ppError(422, 'UNPROCESSABLE_ENTITY', undefined, [{ issue, description }], api);

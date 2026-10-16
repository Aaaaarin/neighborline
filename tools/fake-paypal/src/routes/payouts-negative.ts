/**
 * Payouts sandbox negative testing (https://docs.paypal.ai/send/test-go-live): Payouts does NOT use the
 * PayPal-Mock-Response header — a test value goes in `items[0].note` (create) or replaces the id in the path (GET).
 * HTTP statuses are not documented; the fake picks 422 for business errors, 400 validation, 500 internal, 429 rate.
 */
import { ppError } from '../errors.js';
import type { BatchStatus } from '../state.js';

const API = 'payments.payouts-batch';

const CREATE_ERRORS: Record<string, { status: number; name: string; message: string }> = {
  ERRPYO001: { status: 422, name: 'SENDER_RESTRICTED', message: 'Sender is restricted.' },
  ERRPYO002: { status: 422, name: 'SENDER_EMAIL_UNCONFIRMED', message: 'Sender email is unconfirmed.' },
  ERRPYO003: { status: 403, name: 'AUTHORIZATION_ERROR', message: 'Authorization error occurred.' },
  ERRPYO005: { status: 422, name: 'INSUFFICIENT_FUNDS', message: 'Sender does not have sufficient funds. Please add funds and retry.' },
  ERRPYO006: { status: 500, name: 'INTERNAL_ERROR', message: 'An internal error has occurred.' },
  ERRPYO010: { status: 400, name: 'VALIDATION_ERROR', message: 'Invalid request - see details.' },
  ERRPYO011: { status: 403, name: 'REQUIRED_SCOPE_MISSING', message: 'Access token does not have required scope.' },
  ERRPYO012: { status: 422, name: 'SENDER_LOCKED', message: 'Sender account is locked or inactive.' },
  ERRPYO014: { status: 422, name: 'USER_BUSINESS_ERROR', message: 'User business error.' },
  ERRPYO035: { status: 429, name: 'RATE_LIMIT_VALIDATION', message: 'Rate limit exceeded.' },
  ERRPYO036: { status: 504, name: 'REQUEST_TIMEOUT_EXCEEDED', message: 'Request timeout exceeded.' },
  ERRPYO038: { status: 422, name: 'NON_HOLDING_CURRENCY', message: 'Currency is not held by the sender.' },
  ERRPYO039: { status: 409, name: 'PREVIOUS_REQUEST_IN_PROGRESS', message: 'Previous request with the same idempotency key is in progress.' },
  ERRPYO040: { status: 422, name: 'CIP_NOT_VERIFIED', message: 'Sender has not completed Customer Identification Program verification.' },
};

const BATCH_STATUS_VALUES: Record<string, BatchStatus> = {
  ERRPYOB001: 'SUCCESS',
  ERRPYOB002: 'PENDING',
  ERRPYOB003: 'PROCESSING',
  ERRPYOB004: 'DENIED',
};

export function negativeCreatePayout(body: { sender_batch_header?: Record<string, unknown>; items?: unknown }): void {
  const items = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  const first = items[0] ?? {};
  // ERRPYO013 is documented at items[0]/sender_batch_id; accept the batch header too.
  if (first.sender_batch_id === 'ERRPYO013' || body.sender_batch_header?.sender_batch_id === 'ERRPYO013') {
    throw ppError(400, 'VALIDATION_ERROR', 'Invalid request - see details.', [
      { field: 'items[0].note', location: 'body', issue: 'Note is required for Venmo payouts.' },
    ], API);
  }
  const note = typeof first.note === 'string' ? first.note.trim() : '';
  const spec = CREATE_ERRORS[note];
  if (spec) throw ppError(spec.status, spec.name, spec.message, undefined, API);
}

export function negativeGetBatch(id: string): BatchStatus | undefined {
  return BATCH_STATUS_VALUES[id];
}

/**
 * `PayPal-Mock-Response: {"mock_application_codes":"<CODE>"}` (sandbox negative testing; documented for Orders v2
 * and Payments v1/v2). Generic codes below apply to every API route in the fake — useful for exercising client
 * retry policy — and are a fake-only extension.
 */
import { ppError } from '../errors.js';
import type { Ctx } from '../http.js';

export function mockCode(c: Ctx): string | undefined {
  const raw = c.header('paypal-mock-response');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { mock_application_codes?: unknown };
    return typeof parsed.mock_application_codes === 'string' ? parsed.mock_application_codes : undefined;
  } catch {
    return undefined;
  }
}

/** Throws for generic transport-level mock codes (retryable classes). */
export function applyGenericMock(c: Ctx): void {
  const code = mockCode(c);
  if (code === 'INTERNAL_SERVER_ERROR') throw ppError(500, 'INTERNAL_SERVER_ERROR');
  if (code === 'SERVICE_UNAVAILABLE') throw ppError(503, 'SERVICE_UNAVAILABLE', 'Service Unavailable.');
  if (code === 'RATE_LIMIT_REACHED') throw ppError(429, 'RATE_LIMIT_REACHED');
}

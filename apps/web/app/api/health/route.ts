import { NextResponse } from 'next/server';
import { services } from '@/lib/server/services';
import type { HealthResponse } from '@/lib/server/internal-contract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Render's health check + keep-warm. Public, fast, no PayPal or model calls, no secrets.
 * `approver` reports whether the approver process (the only one that can pay) answers its own
 * health check; the web app stays healthy without it (nothing can be paid until it is back).
 */
export async function GET() {
  const svc = services();
  const body: HealthResponse & { approver: 'up' | 'down' | 'n/a' } = {
    ok: true,
    ...(process.env.RENDER_GIT_COMMIT ? { version: process.env.RENDER_GIT_COMMIT.slice(0, 12) } : {}),
    paypalMode: svc.modes.paypalMode === 'sandbox' ? 'sandbox' : 'fake',
    aiMode: svc.modes.aiMode,
    db: process.env.DATABASE_URL ? 'postgres' : 'pglite',
    approver: svc.approverUp ? ((await svc.approverUp().catch(() => false)) ? 'up' : 'down') : 'n/a',
  };
  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
}

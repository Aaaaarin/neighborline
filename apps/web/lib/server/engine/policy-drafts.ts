/**
 * Policy drafts, their organizer signatures and the views of them. State lives in the append-only,
 * hash-chained audit log (no new tables):
 *
 *   policy.drafted               entity = draft hash; data = the draft + review data (quotes, diff, trace)
 *   policy.signed_with_passkey   entity = draft hash; data = { organizerId, assertion over the draft hash }
 *   policy.signed_with_demo_key  same, DEMO_MODE only, labelled
 *   policy.draft_activated       entity = draft hash; data = { policyId, version, approvedBy }
 *
 * The draft hash (core policyDraftHash) is recomputed from the stored content every time it is read,
 * so a draft whose content no longer matches the hash it was signed under is refused.
 */
import {
  formatUsd,
  policyDraftHash,
  type ApproverAssertion,
  type Policy,
  type PolicyDraftBody,
  type PolicyDraftContent,
} from '@neighborline/core';
import { auditLog, getActivePolicy, getOrganizerCredential, listApprovalsForRequest, listOrganizers, listRequests, policies, type Executor } from '@neighborline/db';
import { expectedFor, verifyApprovalAssertion } from '@neighborline/passkeys';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PolicyCategoryDraftView, PolicyChangeView, PolicyDraftView, PolicyLimitView, PolicySignatureView, QueueImpactRow } from '../../types';
import { HttpError } from '../errors';
import { demoModeOn } from '../passkeys/demo-signer';
import { categoryLabelFor, type BaseCtx as Ctx } from './context';
import { QUEUE_PEOPLE } from './demo-extras';
import { railFor } from './intake';

export type LimitField = PolicyLimitView['field'];

export interface StoredDraft {
  content: PolicyDraftContent;
  baseVersion: number | null;
  quotes: Record<string, string>;
  limitQuotes: Partial<Record<LimitField, string>>;
  changes: PolicyChangeView[];
  ambiguities: string[];
  warnings: string[];
  trace: PolicyDraftView['trace'];
  createdBy: string;
}

export interface DraftRecord extends StoredDraft {
  hash: string;
  createdAt: string;
  seq: number;
}

export const SIGNED_ACTIONS = ['policy.signed_with_passkey', 'policy.signed_with_demo_key'] as const;

/* ---------------- reading the audit log ---------------- */

const toRecord = (row: typeof auditLog.$inferSelect): DraftRecord => {
  const d = row.data as unknown as StoredDraft;
  return { ...d, hash: row.entityId, createdAt: row.at.toISOString(), seq: row.seq };
};

/** A stored draft by hash. Throws 409 when its content no longer hashes to the hash it is stored (and signed) under. */
export async function loadDraft(db: Executor, hash: string): Promise<DraftRecord | null> {
  const [row] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'policy.drafted'), eq(auditLog.entityId, hash))).orderBy(desc(auditLog.seq)).limit(1);
  if (!row) return null;
  const rec = toRecord(row);
  if (policyDraftHash(rec.content) !== hash) throw new HttpError(409, 'This draft’s content doesn’t match its hash. It can’t be signed or activated; draft the rules again.');
  return rec;
}

export async function latestDraft(db: Executor, groupId: string): Promise<DraftRecord | null> {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'policy.drafted'), sql`${auditLog.data}->'content'->>'groupId' = ${groupId}`))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  return row ? loadDraft(db, row.entityId) : null;
}

export async function activationOf(db: Executor, hash: string): Promise<{ policyId: string; version: number } | null> {
  const [row] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'policy.draft_activated'), eq(auditLog.entityId, hash))).limit(1);
  return row ? { policyId: String(row.data.policyId), version: Number(row.data.version) } : null;
}

export interface StoredSignature {
  organizerId: string;
  assertion: ApproverAssertion;
  at: string;
}

/** Signatures over a draft hash, first one per organizer. */
export async function storedSignatures(db: Executor, hash: string): Promise<StoredSignature[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(inArray(auditLog.action, [...SIGNED_ACTIONS]), eq(auditLog.entityId, hash)))
    .orderBy(asc(auditLog.seq));
  const seen = new Set<string>();
  const out: StoredSignature[] = [];
  for (const r of rows) {
    const organizerId = String(r.data.organizerId);
    if (seen.has(organizerId)) continue;
    seen.add(organizerId);
    out.push({ organizerId, assertion: r.data.assertion as ApproverAssertion, at: r.at.toISOString() });
  }
  return out;
}

/**
 * Re-verify a stored signature from first principles, as the approval service does for payouts:
 * the credential must still exist (not revoked), belong to the signer, be of the same kind, and its
 * public key (read from the database, never the payload) must verify the assertion over this hash.
 */
export async function signatureCounts(ctx: Pick<Ctx, 'db' | 'env'>, s: StoredSignature, hash: string): Promise<boolean> {
  const a = s.assertion;
  if (!a || a.approvalHash !== hash) return false;
  const cred = await getOrganizerCredential(ctx.db, a.credentialId);
  if (!cred || cred.organizerId !== s.organizerId || cred.kind !== a.kind) return false;
  if (a.kind === 'demo_key' && !demoModeOn(ctx.env)) return false;
  const exp = expectedFor(a, ctx.env);
  if (!exp) return false;
  const v = await verifyApprovalAssertion({ assertion: a, approvalHash: hash, credential: { id: cred.id, publicKey: cred.publicKey, counter: 0, kind: cred.kind }, ...exp });
  return v.ok;
}

/* ---------------- views ---------------- */

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

export function limitViews(p: Pick<Policy, LimitField>, quotes: Partial<Record<LimitField, string>> = {}, before?: Pick<Policy, LimitField> | null): PolicyLimitView[] {
  const row = (field: LimitField, label: string, fmt: (v: number) => string): PolicyLimitView => ({
    field,
    label,
    value: fmt(p[field]),
    ...(before && before[field] !== p[field] ? { before: fmt(before[field]) } : {}),
    quote: quotes[field] ?? null,
  });
  return [
    row('householdCapPer30dCents', 'Most one household can get in 30 days', formatUsd),
    row('dailyBudgetCents', 'Most the group sends in one day', formatUsd),
    row('maxRequestsPerDestinationPer30d', 'One payout account, in 30 days', times),
  ];
}

export function categoryViews(body: PolicyDraftBody, active: Policy | null, quotes: Record<string, string>): PolicyCategoryDraftView[] {
  const prev = new Map((active?.categories ?? []).map((c) => [c.key, c]));
  return body.categories.map((c) => {
    const old = prev.get(c.key);
    const changed = old && (old.maxCents !== c.maxCents || old.perHouseholdPer30dCents !== c.perHouseholdPer30dCents || !!old.requiresPhoto !== !!c.requiresPhoto || old.label.en !== c.label.en);
    return {
      key: c.key,
      label: c.label.en ?? c.key,
      labels: c.label,
      maxCents: c.maxCents,
      perHouseholdPer30dCents: c.perHouseholdPer30dCents,
      ...(c.requiresPhoto !== undefined ? { requiresPhoto: c.requiresPhoto } : {}),
      quote: quotes[c.key] ?? null,
      change: !old ? 'added' : changed ? 'changed' : 'same',
      ...(old && changed ? { before: { maxCents: old.maxCents, perHouseholdPer30dCents: old.perHouseholdPer30dCents, label: old.label.en ?? old.key } } : {}),
    };
  });
}

/** The draft as a full Policy (for pricing the queue under it, and for activation). */
export function draftPolicy(rec: Pick<DraftRecord, 'content' | 'hash' | 'createdAt'>, slug: string, approvedBy: string[] = []): Policy {
  const c = rec.content;
  return { id: `pol_${slug.replace(/-/g, '_')}_v${c.version}_${rec.hash.slice(0, 8)}`, groupId: c.groupId, version: c.version, ...c.body, createdAt: rec.createdAt, approvedBy };
}

/** Price every request waiting for approval under the draft, with the same code path intake uses. */
export async function queueImpact(ctx: Ctx, draft: Policy, active: Policy | null): Promise<QueueImpactRow[]> {
  const waiting = (await listRequests(ctx.db, { groupId: ctx.gen.group.id, status: ['awaiting_approval'] })).filter((r) => r.payoutDestination && r.policyVersionId !== draft.id);
  const orgs = await listOrganizers(ctx.db, ctx.gen.group.id);
  const rows: QueueImpactRow[] = [];
  for (const r of waiting.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const rail = await railFor(ctx, r, draft, r.payoutDestination!);
    const now = r.computed;
    const next = rail.computed;
    const block = rail.flags.find((f) => f.severity === 'block');
    const catNow = categoryLabelFor(active, now?.ruleKey ?? r.extracted?.category);
    const catDraft = next ? categoryLabelFor(draft, next.ruleKey) : null;
    const pending = (await listApprovalsForRequest(ctx.db, r.id)).filter((a) => a.status === 'pending').at(-1);
    let outcome: QueueImpactRow['outcome'];
    let note: string;
    if (block || !next) {
      outcome = 'blocked';
      note = `Would be held: ${block?.detail ?? 'no rule covers it'}.`;
    } else if (now && next.ruleKey !== now.ruleKey) {
      outcome = 'recategorized';
      note = `Moves from ${catNow} to ${catDraft}${active?.categories.some((c) => c.key === now.ruleKey) && !draft.categories.some((c) => c.key === now.ruleKey) ? ` (${catNow} is removed)` : ''}: ${formatUsd(now.amountCents)} → ${formatUsd(next.amountCents)}.`;
    } else if (now && next.amountCents !== now.amountCents) {
      outcome = next.amountCents > now.amountCents ? 'more' : 'less';
      note = `${formatUsd(now.amountCents)} → ${formatUsd(next.amountCents)} under ${catDraft}.`;
    } else {
      outcome = 'same';
      note = `Stays ${formatUsd(next.amountCents)} under ${catDraft}.`;
    }
    const meta = ctx.meta.get(r.id);
    rows.push({
      requestId: r.id,
      displayName: meta?.displayName ?? QUEUE_PEOPLE[r.id]?.displayName ?? 'Neighbor',
      lang: r.lang,
      categoryNow: catNow,
      categoryDraft: catDraft,
      currentCents: now?.amountCents ?? null,
      draftCents: next?.amountCents ?? null,
      outcome,
      note,
      approvalsToRedo: (pending?.approvers ?? []).map((a) => orgs.find((o) => o.id === a.organizerId)?.name ?? a.organizerId),
    });
  }
  return rows;
}

export async function draftStatus(db: Executor, rec: DraftRecord): Promise<{ status: PolicyDraftView['status']; activatedPolicyId?: string }> {
  const act = await activationOf(db, rec.hash);
  if (act) return { status: 'activated', activatedPolicyId: act.policyId };
  const latest = await latestDraft(db, rec.content.groupId);
  if (latest && latest.hash !== rec.hash) return { status: 'superseded' };
  const active = await getActivePolicy(db, rec.content.groupId);
  if ((active?.id ?? null) !== rec.content.basePolicyId) return { status: 'stale' };
  return { status: 'open' };
}

export async function draftView(ctx: Ctx, rec: DraftRecord): Promise<PolicyDraftView> {
  const { status, activatedPolicyId } = await draftStatus(ctx.db, rec);
  const base = rec.content.basePolicyId ? ((await ctx.db.select().from(policies).where(eq(policies.id, rec.content.basePolicyId)))[0]?.body ?? null) : null;
  const orgs = await listOrganizers(ctx.db, ctx.gen.group.id);
  const sigs: PolicySignatureView[] = [];
  for (const s of await storedSignatures(ctx.db, rec.hash)) {
    sigs.push({
      organizerId: s.organizerId,
      name: orgs.find((o) => o.id === s.organizerId)?.name ?? s.organizerId,
      kind: s.assertion.kind,
      deviceLabel: s.assertion.deviceLabel,
      at: s.at,
      counts: await signatureCounts(ctx, s, rec.hash),
    });
  }
  const body = rec.content.body;
  const draft = draftPolicy(rec, ctx.gen.group.slug);
  return {
    draftHash: rec.hash,
    groupId: rec.content.groupId,
    version: rec.content.version,
    basePolicyId: rec.content.basePolicyId,
    baseVersion: rec.baseVersion,
    sourceText: body.sourceText,
    createdAt: rec.createdAt,
    createdBy: rec.createdBy,
    categories: categoryViews(body, base, rec.quotes),
    removed: (base?.categories ?? [])
      .filter((c) => !body.categories.some((d) => d.key === c.key))
      .map((c) => ({ key: c.key, label: c.label.en ?? c.key, maxCents: c.maxCents, perHouseholdPer30dCents: c.perHouseholdPer30dCents })),
    limits: limitViews(body, rec.limitQuotes, base),
    changes: rec.changes,
    ambiguities: rec.ambiguities,
    warnings: rec.warnings,
    trace: rec.trace,
    queue: status === 'open' ? await queueImpact(ctx, draft, base) : [],
    signatures: sigs,
    required: ctx.gen.group.requiredApprovals,
    status,
    ...(activatedPolicyId ? { activatedPolicyId } : {}),
  };
}

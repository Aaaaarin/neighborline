/**
 * Rules editor: "AI drafts, humans decide" for the group's policy.
 *
 *   organizers' plain English → agents.policy.compile (schema-validated, every cap quoted from the
 *   text, one repair pass) → stored draft + code-computed diff + queue preview → two distinct
 *   organizers sign the draft hash (passkey, or the labelled demo key in DEMO_MODE) → on the second
 *   valid signature db.activatePolicy creates the new immutable version and every request still
 *   waiting is re-priced under it by code (its old, now-stale approvals are voided).
 */
import { canonicalJson, policyDraftHash, type ApproverAssertion, type Policy, type PolicyDraftContent } from '@neighborline/core';
import { activatePolicy, appendAudit, getActivePolicy, listOrganizers, listRequests, policies, updateRequest, voidOpenApprovalsForRequests } from '@neighborline/db';
import { asc, eq } from 'drizzle-orm';
import type { ApprovalChallenge, CompilePolicyOutcome, OrganizerSession, PolicyEditorView, PolicySignInput, PolicySignResult } from '../../types';
import { HttpError } from '../errors';
import { demoAssert, demoModeOn } from '../passkeys/demo-signer';
import { activePolicy, type BaseCtx as Ctx } from './context';
import { railFor } from './intake';
import { challengeOptionsFor, verifyPasskeyOver } from './passkeys';
import {
  draftPolicy,
  draftView,
  latestDraft,
  limitViews,
  loadDraft,
  signatureCounts,
  storedSignatures,
  activationOf,
  draftStatus,
  type DraftRecord,
  type StoredDraft,
} from './policy-drafts';

/** Serialize drafting, signing and activation per process (one activation per draft, ever). */
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

export async function editorView(ctx: Ctx): Promise<PolicyEditorView> {
  const active = await activePolicy(ctx);
  const orgs = await listOrganizers(ctx.db, ctx.gen.group.id);
  const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;
  const rows = await ctx.db.select().from(policies).where(eq(policies.groupId, ctx.gen.group.id)).orderBy(asc(policies.version));
  const latest = await latestDraft(ctx.db, ctx.gen.group.id);
  return {
    groupName: ctx.gen.group.name,
    demoMode: demoModeOn(ctx.env),
    aiMode: ctx.agents.providers.mode,
    active: {
      id: active.id,
      version: active.version,
      sourceText: active.sourceText,
      categories: active.categories.map((c) => ({ key: c.key, label: c.label.en ?? c.key, maxCents: c.maxCents, perHouseholdPer30dCents: c.perHouseholdPer30dCents })),
      limits: limitViews(active),
      approvedBy: active.approvedBy.map(name),
    },
    draft: latest ? await draftView(ctx, latest) : null,
    versions: rows
      .filter((r) => r.status !== 'draft')
      .map((r) => ({ id: r.id, version: r.version, status: r.status === 'active' ? 'active' : 'retired', activatedAt: r.activatedAt?.toISOString() ?? null, approvedBy: r.body.approvedBy.map(name) })),
  };
}

/** Compile the organizers' text into a stored draft. Nothing changes until two organizers sign it. */
export async function compileDraft(ctx: Ctx, input: { sourceText: string; actor: OrganizerSession | null }): Promise<CompilePolicyOutcome> {
  const text = input.sourceText.replace(/\r\n/g, '\n').trim();
  if (text.length < 20) throw new HttpError(400, 'Write the rules first: at least one category with its cap.');
  const active = await activePolicy(ctx);
  const r = await ctx.agents.policy.compile({ sourceText: text, previous: active, groupName: ctx.gen.group.name });
  const traceView = { status: r.trace.status, summary: r.trace.summary, attempts: r.trace.attempts.length };
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => ({ path: e.path, message: e.message })), trace: traceView };
  const content: PolicyDraftContent = { groupId: ctx.gen.group.id, basePolicyId: active.id, version: active.version + 1, body: r.draft };
  const { id: _i, groupId: _g, createdAt: _c, approvedBy: _a, version: _v, ...activeBody } = active;
  if (canonicalJson(activeBody) === canonicalJson(r.draft)) {
    return { ok: false, errors: [{ path: '', message: 'These rules compile to exactly the current policy. Change a rule, then draft again.' }], trace: traceView };
  }
  const hash = policyDraftHash(content);
  return serialized(async () => {
    const latest = await latestDraft(ctx.db, ctx.gen.group.id);
    if (!latest || latest.hash !== hash || (await activationOf(ctx.db, hash))) {
      const stored: StoredDraft = {
        content,
        baseVersion: active.version,
        quotes: r.quotes,
        limitQuotes: r.limitQuotes,
        changes: r.changes.map((c) => ({ kind: c.kind, path: c.path, text: c.text, ...(c.before !== undefined ? { before: c.before } : {}), ...(c.after !== undefined ? { after: c.after } : {}) })),
        ambiguities: r.ambiguities,
        warnings: r.warnings,
        trace: { ...traceView, repairedFields: r.trace.repairedFields, provider: r.trace.provider, latencyMs: r.trace.totalLatencyMs },
        createdBy: input.actor?.name ?? (demoModeOn(ctx.env) ? 'Demo visitor' : 'Organizer'),
      };
      await appendAudit(ctx.db, { actor: input.actor?.organizerId ?? 'demo-visitor', action: 'policy.drafted', entityType: 'policy_draft', entityId: hash, data: stored as unknown as Record<string, unknown> });
    }
    const rec = (await loadDraft(ctx.db, hash))!;
    return { ok: true, draft: await draftView(ctx, rec) };
  });
}

async function openDraft(ctx: Ctx, hash: string): Promise<DraftRecord> {
  const rec = await loadDraft(ctx.db, hash);
  if (!rec || rec.content.groupId !== ctx.gen.group.id) throw new HttpError(404, 'No such draft. Draft the rules again.');
  const { status } = await draftStatus(ctx.db, rec);
  if (status === 'activated') throw new HttpError(409, `This draft is already active as Policy v${rec.content.version}.`);
  if (status === 'superseded') throw new HttpError(409, 'A newer draft replaced this one. Review the newer draft and sign that.');
  if (status === 'stale') throw new HttpError(409, 'The active rules changed after this draft was made. Draft again from the current rules.');
  return rec;
}

/** WebAuthn request options whose challenge is the draft hash (the 32 bytes, base64url). */
export async function policyChallenge(ctx: Ctx, input: { draftHash: string; origin: string | null; organizerId?: string }): Promise<ApprovalChallenge> {
  const rec = await openDraft(ctx, input.draftHash);
  const optionsJSON = await challengeOptionsFor(ctx, rec.hash, input);
  return { approvalHash: rec.hash, optionsJSON: optionsJSON as unknown as ApprovalChallenge['optionsJSON'] };
}

/**
 * One organizer signs the draft. The signer is whoever owns the credential. When the signatures
 * that still verify come from `requiredApprovals` distinct organizers, the draft becomes the new
 * active version.
 */
export async function signDraft(ctx: Ctx, input: PolicySignInput & { origin: string | null }): Promise<PolicySignResult> {
  return serialized(async () => {
    const rec = await openDraft(ctx, input.draftHash);
    let signed: { organizerId: string; assertion: ApproverAssertion };
    if (input.signer.kind === 'demo_key') {
      if (!input.organizerId) throw new HttpError(400, 'Say which organizer the demo key signs for.');
      signed = { organizerId: input.organizerId, assertion: await demoAssert(ctx.db, ctx.env, { groupId: ctx.gen.group.id, organizerId: input.organizerId, approvalHash: rec.hash }) };
    } else {
      signed = await verifyPasskeyOver(ctx, input.signer.assertion, rec.hash, input.organizerId);
    }
    const prior = await storedSignatures(ctx.db, rec.hash);
    if (!prior.some((s) => s.organizerId === signed.organizerId)) {
      await appendAudit(ctx.db, {
        actor: signed.organizerId,
        action: signed.assertion.kind === 'demo_key' ? 'policy.signed_with_demo_key' : 'policy.signed_with_passkey',
        entityType: 'policy_draft',
        entityId: rec.hash,
        data: { organizerId: signed.organizerId, version: rec.content.version, assertion: signed.assertion as unknown as Record<string, unknown> },
      });
    }
    const valid: string[] = [];
    for (const s of await storedSignatures(ctx.db, rec.hash)) if (await signatureCounts(ctx, s, rec.hash)) valid.push(s.organizerId);
    const distinct = [...new Set(valid)].sort();
    let activated: PolicySignResult['activated'] = null;
    if (distinct.length >= ctx.gen.group.requiredApprovals) activated = await activate(ctx, rec, distinct, signed.organizerId);
    const fresh = (await loadDraft(ctx.db, rec.hash))!;
    return { draft: await draftView(ctx, fresh), activated };
  });
}

async function activate(ctx: Ctx, rec: DraftRecord, approvedBy: string[], actor: string): Promise<NonNullable<PolicySignResult['activated']>> {
  const policy: Policy = draftPolicy(rec, ctx.gen.group.slug, approvedBy);
  await ctx.db.transaction(async (tx) => {
    const current = await getActivePolicy(tx, ctx.gen.group.id);
    if ((current?.id ?? null) !== rec.content.basePolicyId) throw new HttpError(409, 'The active rules changed after this draft was made. Draft again from the current rules.');
    await activatePolicy(tx, policy, { actor });
    await appendAudit(tx, { actor, action: 'policy.draft_activated', entityType: 'policy_draft', entityId: rec.hash, data: { policyId: policy.id, version: policy.version, approvedBy } });
  });
  const repriced = await repriceQueue(ctx, policy, actor);
  return { policyId: policy.id, version: policy.version, repriced };
}

/**
 * Requests still waiting were priced under the old version, and the approval service refuses to pay
 * anything approved under a policy that is no longer active. So re-price each one under the new
 * version with the same code intake uses, and void approvals given for the old amounts.
 */
async function repriceQueue(ctx: Ctx, policy: Policy, actor: string): Promise<number> {
  const waiting = (await listRequests(ctx.db, { groupId: ctx.gen.group.id, status: ['awaiting_approval'] })).filter((r) => r.payoutDestination && r.policyVersionId !== policy.id);
  for (const r of waiting) {
    const rail = await railFor(ctx, r, policy, r.payoutDestination!);
    await updateRequest(ctx.db, r.id, { computed: rail.computed, railFlags: rail.flags, policyVersionId: policy.id }, { actor });
    const voided = await voidOpenApprovalsForRequests(ctx.db, [r.id], { reason: `re-priced under policy v${policy.version}`, actor });
    await appendAudit(ctx.db, {
      actor,
      action: 'request.repriced',
      entityType: 'request',
      entityId: r.id,
      data: { from: { policyVersionId: r.policyVersionId, amountCents: r.computed?.amountCents ?? null, ruleKey: r.computed?.ruleKey ?? null }, to: { policyVersionId: policy.id, amountCents: rail.computed?.amountCents ?? null, ruleKey: rail.computed?.ruleKey ?? null }, voidedApprovals: voided },
    });
    ctx.meta.ensure(r.id).breakdown = rail.breakdown;
  }
  return waiting.length;
}

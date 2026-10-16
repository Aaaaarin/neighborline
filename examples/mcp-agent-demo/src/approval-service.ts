/**
 * A stand-in for the human approval service (in Neighborline: the organizer app plus `apps/approver`).
 *
 * It records approvals of one exact batch and mints an approval token only once two *different* organizers have
 * approved it. The agent never sees the secret; it can only ask for approval and receive the token.
 */
import { batchDigest, signApprovalToken, type ApprovalPayload, readApprovalToken } from '@neighborline/paypal/approval';
import type { CreateBatchInput } from '@neighborline/paypal';

export interface ApprovalRequestRecord {
  approvalId: string;
  batch: Pick<CreateBatchInput, 'senderBatchId' | 'items'>;
  digest: string;
  approvers: string[];
}

export class DemoApprovalService {
  private readonly requests = new Map<string, ApprovalRequestRecord>();
  private seq = 0;

  constructor(
    private readonly secret: string,
    private readonly opts: { minApprovers?: number; ttlSec?: number } = {},
  ) {}

  /** The agent (or a person) submits a batch for approval. Nothing is approved yet. */
  request(batch: Pick<CreateBatchInput, 'senderBatchId' | 'items'>): ApprovalRequestRecord {
    const approvalId = `appr_${String(++this.seq).padStart(3, '0')}`;
    const rec: ApprovalRequestRecord = { approvalId, batch: structuredClone(batch), digest: batchDigest(batch), approvers: [] };
    this.requests.set(approvalId, rec);
    return rec;
  }

  /**
   * One organizer approves. Returns the token once enough distinct organizers have approved, else null.
   * Approving twice as the same person does not count twice.
   */
  approve(approvalId: string, organizerId: string): { token: string | null; approvals: number; needed: number } {
    const rec = this.requests.get(approvalId);
    if (!rec) throw new Error(`unknown approval ${approvalId}`);
    const id = organizerId.trim().toLowerCase();
    if (!rec.approvers.includes(id)) rec.approvers.push(id);
    const needed = this.opts.minApprovers ?? 2;
    if (rec.approvers.length < needed) return { token: null, approvals: rec.approvers.length, needed };
    const token = signApprovalToken(this.secret, { approvalId, batch: rec.batch, approvers: rec.approvers, ttlSec: this.opts.ttlSec ?? 600 });
    return { token, approvals: rec.approvers.length, needed };
  }

  static describe(token: string): ApprovalPayload | null {
    return readApprovalToken(token);
  }
}

import { Prisma } from '@prisma/client';
import { GATE_RESOLVED_OUTBOX_KIND } from './approval-gate';

type Db = Prisma.TransactionClient;

export type GateOutcome = 'approved' | 'rejected' | 'cancelled';

/** End outcome of an instance → state of the gates it decides. */
export function gateOutcomeOf(
  instanceOutcome: string | undefined,
): GateOutcome {
  if (instanceOutcome === 'rejected') return 'rejected';
  if (instanceOutcome === 'cancelled') return 'cancelled';
  return 'approved';
}

/**
 * Resolves the pending gates of an instance that just closed, in the SAME
 * transaction as the close: approved, rejected or cancelled together with the
 * request, never apart. Each resolved gate gets a `gate_resolved` outbox row
 * that applies the effect (void the held record, run the deferred operation)
 * and tells the requester. Returns how many gates THIS call resolved
 * (a concurrent close that lost the race resolves none).
 */
export async function resolveInstanceGates(
  tx: Db,
  instance: { id: number; store_id: number },
  outcome: GateOutcome,
  reason: string | null,
): Promise<number> {
  const gates = await tx.workflow_approval_gates.findMany({
    where: { store_id: instance.store_id, instance_id: instance.id, status: 'pending' },
    select: { id: true },
  });
  if (gates.length === 0) return 0;
  const now = new Date();
  let resolved = 0;
  for (const g of gates) {
    const updated = await tx.workflow_approval_gates.updateMany({
      where: { id: g.id, status: 'pending' },
      data: {
        status: outcome,
        resolved_at: now,
        reason: reason ? reason.slice(0, 1000) : null,
      },
    });
    if (updated.count === 0) continue;
    resolved++;
    await tx.workflow_outbox.create({
      data: {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: GATE_RESOLVED_OUTBOX_KIND,
        payload: { gate_id: g.id, outcome },
        status: 'pending',
        available_at: now,
      },
    });
  }
  return resolved;
}

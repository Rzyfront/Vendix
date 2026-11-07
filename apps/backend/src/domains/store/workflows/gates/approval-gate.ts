import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import {
  WORKFLOW_GATE_OPERATIONS,
  WorkflowDefinitionV1,
  WorkflowGateOperation,
  canonicalJson,
  gateOperationTokens,
} from '@common/workflows/contract';
import { industryAllowsKey } from '../../../../common/access/module-industries';

/** Outbox row that starts the request of a new gate (worker, actor `system`). */
export const GATE_START_OUTBOX_KIND = 'gate_start';
/** Outbox row that applies a resolved gate (void, deferred run, notice). */
export const GATE_RESOLVED_OUTBOX_KIND = 'gate_resolved';

export type GateContext = Record<string, string | number | boolean | null>;

/**
 * `request.method` of a `defer` operation the worker must NOT run for the
 * requester (a POS sale needs the customer and the cash at the counter): its
 * `args` only identify the request. Once approved, the requester repeats the
 * same operation and the approval lets it through once.
 */
export const GATE_RETRY_BY_REQUESTER = 'retry_by_requester';

/** A deferred operation: the replayer method and its JSON arguments. */
export interface GateDeferredRequest {
  method: string;
  args: unknown[];
}

export interface ApprovalGateInput {
  operation: WorkflowGateOperation;
  /** Record the operation acts on; 0 for an operation that creates one. */
  entity_id: number;
  /** Type of that record; defaults to the operation's subject. */
  entity_type?: string;
  /** Compared with `governs.min_amount` (absolute value). */
  amount: number;
  /** Flat values for the `{{event.<key>}}` tokens of the operation. */
  context: Record<string, unknown>;
  /** `defer` operations only: what runs, as the requester, once approved. */
  request?: GateDeferredRequest;
}

export interface GateRow {
  id: number;
  store_id: number;
  organization_id: number;
  definition_id: number;
  instance_id: number | null;
  operation: string;
  entity_type: string;
  entity_id: number;
  revision: number;
  amount: Prisma.Decimal | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  context: Prisma.JsonValue;
  request: Prisma.JsonValue | null;
  requested_by_user_id: number | null;
  resolved_at: Date | null;
  consumed_at: Date | null;
  created_at: Date;
}

export type GateDecision =
  | { status: 'free' }
  | { status: 'approved' | 'pending' | 'rejected'; gate: GateRow };

/** Any unscoped client: `StorePrismaService.withoutScope()` or a tx of it. */
type Db = Prisma.TransactionClient;
interface RootDb {
  withoutScope(): unknown;
}

const root = (prisma: RootDb) =>
  prisma.withoutScope() as Db & {
    $transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  };

function scalar(v: unknown): string | number | boolean | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 2000);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && typeof (v as { toFixed?: unknown }).toFixed === 'function') {
    return String(v);
  }
  return null;
}

/** The closed flat context: exactly the tokens of the operation. */
export function gateContext(
  operation: WorkflowGateOperation,
  raw: Record<string, unknown>,
): GateContext {
  const out: GateContext = {};
  for (const key of gateOperationTokens(operation)) out[key] = scalar(raw[key]);
  return out;
}

/** Same request (operation, record, requester and JSON arguments) → same hash. */
export function gateRequestHash(
  operation: string,
  entityId: number,
  userId: number | null,
  request: GateDeferredRequest | undefined,
): string {
  const args = request ? JSON.parse(JSON.stringify(request)) : null;
  return createHash('sha256')
    .update(canonicalJson({ operation, entityId, userId, args }))
    .digest('hex');
}

/**
 * The active definition that governs `operation` for `amount`, if any: the
 * one with the highest `min_amount` not above the amount (tiers such as
 * "from 2M the manager, from 20M the board"), then the lowest id.
 */
export async function findGoverningDefinition(
  db: Db,
  storeId: number,
  operation: WorkflowGateOperation,
  amount: number,
): Promise<{ id: number; organization_id: number } | null> {
  const store = await db.stores.findFirst({
    where: { id: storeId },
    select: { industries: true },
  });
  if (!store || !industryAllowsKey('flows', store.industries)) return null;
  const defs = await db.workflow_definitions.findMany({
    where: { store_id: storeId, status: 'active', published_version_id: { not: null } },
    select: { id: true, organization_id: true, published_version_id: true },
    orderBy: { id: 'asc' },
  });
  if (defs.length === 0) return null;
  const versions = await db.workflow_versions.findMany({
    where: {
      store_id: storeId,
      id: { in: defs.map((d) => d.published_version_id as number) },
    },
    select: { id: true, definition: true },
  });
  const byVersion = new Map(versions.map((v) => [v.id, v.definition]));
  let best: { id: number; organization_id: number; min: number } | null = null;
  for (const d of defs) {
    const def = byVersion.get(d.published_version_id as number) as
      | WorkflowDefinitionV1
      | undefined;
    const governs = def?.governs;
    if (!governs || governs.operation !== operation) continue;
    const min = governs.min_amount ?? 0;
    if (Math.abs(amount) < min) continue;
    if (!best || min > best.min) best = { id: d.id, organization_id: d.organization_id, min };
  }
  return best ? { id: best.id, organization_id: best.organization_id } : null;
}

/**
 * Cheap pre-check for hot paths (bulk adjustments): whether any active flow
 * of the current store governs `operation` — for `amount` when given,
 * whatever the amount otherwise.
 */
export async function operationIsGoverned(
  prisma: RootDb,
  operation: WorkflowGateOperation,
  amount: number = Number.MAX_SAFE_INTEGER,
): Promise<boolean> {
  const storeId = RequestContextService.getStoreId();
  if (!storeId) return false;
  return (await findGoverningDefinition(root(prisma), storeId, operation, amount)) !== null;
}

/** P2002 by code: with the pg adapter `meta.target` may be missing. */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Decides the gate of one operation and opens it when a flow governs it.
 *
 * - `hold` (the record exists): the latest revision of the record rules. A
 *   pending one waits; an approved one not used yet lets it through once
 *   (unless the amount grew past the approved one: then it is cancelled and
 *   a new request opens); a rejected one stays rejected; a cancelled or used
 *   one lets a new request open.
 * - `defer` (nothing exists yet): the same requester asking the same thing
 *   (same JSON) finds the same gate, so the deferred run passes once approved
 *   and a double click never opens two requests.
 *
 * The new gate and its `gate_start` outbox row commit together in their own
 * transaction, BEFORE the caller decides; a concurrent opener loses on the
 * unique (store, operation, record, revision) and reads the winner.
 */
export async function requestApproval(
  prisma: RootDb,
  input: ApprovalGateInput,
): Promise<GateDecision> {
  const ctx = RequestContextService.getContext();
  const storeId = ctx?.store_id;
  if (!storeId) return { status: 'free' };
  const db = root(prisma);
  const spec = WORKFLOW_GATE_OPERATIONS[input.operation];
  const userId = ctx?.user_id ?? null;
  const hash =
    spec.mode === 'defer'
      ? gateRequestHash(input.operation, input.entity_id, userId, input.request)
      : null;
  const amount = Math.abs(Number.isFinite(input.amount) ? input.amount : 0);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Read the top revision FIRST and derive the new revision from this same
    // read: a concurrent opener that this read missed is creating this very
    // revision, so the unique (store, operation, record, revision) makes one
    // of the two fail and re-read, never two gates for the same thing.
    const top = (await db.workflow_approval_gates.findFirst({
      where: { store_id: storeId, operation: input.operation, entity_id: input.entity_id },
      orderBy: { revision: 'desc' },
    })) as GateRow | null;
    const latest = hash
      ? ((await db.workflow_approval_gates.findFirst({
          where: {
            store_id: storeId,
            operation: input.operation,
            entity_id: input.entity_id,
            request: { path: ['hash'], equals: hash },
          },
          orderBy: { revision: 'desc' },
        })) as GateRow | null)
      : top;

    if (latest) {
      if (latest.status === 'pending') return { status: 'pending', gate: latest };
      if (latest.status === 'rejected' && spec.mode === 'hold') {
        return { status: 'rejected', gate: latest };
      }
      if (latest.status === 'approved' && !latest.consumed_at) {
        const approvedAmount = latest.amount === null ? null : Number(latest.amount);
        if (approvedAmount === null || amount <= approvedAmount) {
          return { status: 'approved', gate: latest };
        }
        await db.workflow_approval_gates.updateMany({
          where: { id: latest.id, status: 'approved', consumed_at: null },
          data: {
            status: 'cancelled',
            reason: 'El monto creció por encima del aprobado; se pidió una aprobación nueva.',
          },
        });
      }
    }

    const governing = await findGoverningDefinition(db, storeId, input.operation, amount);
    if (!governing) return { status: 'free' };

    const revision = (top?.revision ?? 0) + 1;
    try {
      const gate = await db.$transaction(async (tx) => {
        const created = (await tx.workflow_approval_gates.create({
          data: {
            organization_id: governing.organization_id,
            store_id: storeId,
            definition_id: governing.id,
            operation: input.operation,
            entity_type: input.entity_type ?? spec.subject,
            entity_id: input.entity_id,
            revision,
            amount,
            status: 'pending',
            context: gateContext(input.operation, input.context),
            request: input.request
              ? (JSON.parse(JSON.stringify({ ...input.request, hash })) as Prisma.InputJsonValue)
              : hash
                ? { hash }
                : Prisma.DbNull,
            requested_by_user_id: userId,
          },
        })) as GateRow;
        await tx.workflow_outbox.create({
          data: {
            store_id: storeId,
            instance_id: null,
            kind: GATE_START_OUTBOX_KIND,
            payload: { gate_id: created.id },
            status: 'pending',
            available_at: new Date(),
          },
        });
        return created;
      });
      return { status: 'pending', gate };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A concurrent request opened this revision first: read it again.
    }
  }
  throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
}

/** What the person reads when the operation is held. */
export async function gateMessage(prisma: RootDb, gate: GateRow): Promise<string> {
  const label = WORKFLOW_GATE_OPERATIONS[gate.operation as WorkflowGateOperation]?.label ?? gate.operation;
  if (gate.status === 'rejected') {
    return `La aprobación fue rechazada${gate.reason ? `: ${gate.reason}` : '.'}`;
  }
  const instance = gate.instance_id
    ? await root(prisma).workflow_instances.findFirst({
        where: { id: gate.instance_id, store_id: gate.store_id },
        select: { reference: true },
      })
    : null;
  return instance
    ? `Pendiente de aprobación (${label}): solicitud ${instance.reference}. Se libera cuando la aprueben.`
    : `Pendiente de aprobación (${label}): la solicitud se está creando. Se libera cuando la aprueben.`;
}

/**
 * The guard every governed operation calls before its effect. Free or
 * approved → returns the decision (pass an approved gate to
 * {@link consumeApproval} inside the domain transaction). Pending or
 * rejected → throws 409, after the gate committed.
 */
export async function enforceApproval(
  prisma: RootDb,
  input: ApprovalGateInput,
): Promise<GateDecision> {
  const decision = await requestApproval(prisma, input);
  if (decision.status === 'pending') {
    throw new VendixHttpException(
      ErrorCodes.WORKFLOW_APPROVAL_PENDING,
      await gateMessage(prisma, decision.gate),
      { gate_id: decision.gate.id, instance_id: decision.gate.instance_id },
    );
  }
  if (decision.status === 'rejected') {
    throw new VendixHttpException(
      ErrorCodes.WORKFLOW_APPROVAL_REJECTED,
      await gateMessage(prisma, decision.gate),
      { gate_id: decision.gate.id, instance_id: decision.gate.instance_id },
    );
  }
  return decision;
}

/**
 * Marks an approved gate as used, once. Call it in the same transaction as
 * the effect: if the effect rolls back, the approval stays usable; two
 * concurrent uses cannot both pass.
 */
export async function consumeApproval(
  tx: Db,
  decision: GateDecision,
): Promise<void> {
  if (decision.status !== 'approved') return;
  const used = await tx.workflow_approval_gates.updateMany({
    where: { id: decision.gate.id, status: 'approved', consumed_at: null },
    data: { consumed_at: new Date() },
  });
  if (used.count === 0) {
    throw new VendixHttpException(
      ErrorCodes.WORKFLOW_APPROVAL_PENDING,
      'Esta aprobación ya se usó; vuelve a intentar la operación para pedir otra.',
    );
  }
}

/** True while the record has a pending gate for `operation` (read-only). */
export async function hasPendingApproval(
  prisma: RootDb,
  storeId: number,
  operation: WorkflowGateOperation,
  entityId: number,
): Promise<boolean> {
  const pending = await root(prisma).workflow_approval_gates.findFirst({
    where: { store_id: storeId, operation, entity_id: entityId, status: 'pending' },
    select: { id: true },
  });
  return !!pending;
}

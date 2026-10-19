import {
  consumeAgentVerification,
  agentVerificationContractsHash,
} from './agent-verification-capability';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import {
  isHistoricalObjectiveArtifact,
  safeObjectiveArtifact,
} from './agent-artifact-safety';
import type { ActivePlaybookPin } from '../playbooks/playbook.service';
import type { AgentPlan } from '../interfaces/agent-plan.interface';
import {
  AgentEffect,
  AgentEffectStatus,
  AgentObjective,
  AgentToolResult,
  AppendToolResultInput,
  emptyObjectiveBudget,
  ObjectiveBudget,
  ObjectiveCheckpoint,
  ObjectiveLease,
  ObjectiveScope,
  ResultPage,
} from './interfaces/agent-objective.interface';

/**
 * Operational contention, not a failed business task. The HTTP filter keeps
 * only `error_code` + `message`, so both must be self-sufficient for a person.
 */
export class ObjectiveLeaseBusyException extends ConflictException {
  constructor() {
    super({
      error_code: 'AI_OBJECTIVE_LEASE_BUSY',
      code: 'AI_OBJECTIVE_LEASE_BUSY',
      message:
        'El asistente todavía está respondiendo tu mensaje anterior. Espera un momento y vuelve a intentarlo.',
    });
  }
}

/** The executor released/advanced the objective after the caller read its version. */
export class ObjectiveLeaseChangedException extends ConflictException {
  constructor() {
    super({
      error_code: 'AI_OBJECTIVE_LEASE_CHANGED',
      code: 'AI_OBJECTIVE_LEASE_CHANGED',
      message:
        'La conversación acaba de cambiar. Vuelve a enviar tu mensaje en un momento.',
    });
  }
}

/** Expired/superseded/terminal objectives need an explicit resume or a new message. */
export class ObjectiveNotExecutableException extends ConflictException {
  constructor() {
    super({
      error_code: 'AI_OBJECTIVE_REQUIRES_RESUME',
      message:
        'Ese trabajo ya no se puede continuar desde aquí. Escribe tu solicitud de nuevo o inicia una conversación nueva.',
    });
  }
}

/** Effect states that still need a person or reconciliation before a new goal. */
const UNRESOLVED_EFFECT_STATUSES = [
  'proposed',
  'approved',
  'applying',
  'unknown',
] as const;
/** Tool names that never count as an observed business read. */
const INTERNAL_RESULT_TOOLS = new Set(['agent_recovery_checkpoint']);

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 24 * 60 * 60 * 1000;
const json = (value: unknown): Prisma.Sql =>
  Prisma.sql`${JSON.stringify(value)}::jsonb`;
const scopeSql = (scope: ObjectiveScope): Prisma.Sql =>
  Prisma.sql`store_id = ${scope.store_id} AND organization_id = ${scope.organization_id} AND user_id = ${scope.user_id}`;
const leaseSql = (lease: ObjectiveLease): Prisma.Sql =>
  Prisma.sql`version = ${lease.version} AND lease_generation = ${lease.lease_generation} AND lease_until > CURRENT_TIMESTAMP`;
const objectMetadata = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** No fallback to RequestContextService.getContext(): its static fallback is unsafe for jobs. */
export function requireObjectiveScope(): ObjectiveScope {
  const context = RequestContextService.asyncLocalStorage.getStore();
  if (
    !context ||
    ![context.store_id, context.organization_id, context.user_id].every(
      (id) => Number.isSafeInteger(id) && Number(id) > 0,
    )
  )
    throw new UnauthorizedException(
      'An explicit tenant and owner context is required',
    );
  return {
    store_id: context.store_id!,
    organization_id: context.organization_id!,
    user_id: context.user_id!,
  };
}

export function addObjectiveBudget(
  current: ObjectiveBudget,
  delta: Partial<ObjectiveBudget>,
): ObjectiveBudget {
  const result = { ...current };
  for (const key of Object.keys(emptyObjectiveBudget()) as Array<
    keyof ObjectiveBudget
  >) {
    const value = delta[key];
    if (value === undefined) continue;
    if (value === null) {
      if (key === 'cost_usd') result.cost_usd = null;
      continue;
    }
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (key !== 'cost_usd' && !Number.isSafeInteger(value))
    )
      throw new BadRequestException('Invalid budget delta');
    if (key === 'cost_usd') {
      const total = current.cost_usd === null ? null : current.cost_usd + value;
      if (total !== null && !Number.isFinite(total))
        throw new BadRequestException('Budget cost overflow');
      result.cost_usd = total;
    } else {
      const sum = result[key] + value;
      if (!Number.isSafeInteger(sum))
        throw new BadRequestException('Budget counter overflow');
      result[key] = sum;
    }
  }
  // Unknown cost stays unknown. Observed amounts are stored independently in receipts/traces.
  return result;
}

@Injectable()
export class AgentObjectiveRepository {
  constructor(private readonly prisma: StorePrismaService) {}

  isEnabled(): boolean {
    return true;
  }

  private scope(): ObjectiveScope {
    const scope = requireObjectiveScope();

    return scope;
  }
  private validId(id: string): void {
    if (!UUID.test(id)) throw new NotFoundException('Objective not found');
  }
  private async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    // SQL bypasses extensions by design; EVERY query below carries immutable ALS scope.
    // Reuse the global StorePrisma singleton, never instantiate a client or use withoutScope().
    return this.prisma.$transaction(fn, { timeout: 10000, maxWait: 5000 });
  }
  private async find(
    tx: Tx,
    scope: ObjectiveScope,
    id: string,
    lock = false,
  ): Promise<AgentObjective> {
    this.validId(id);
    const rows = await tx.$queryRaw<AgentObjective[]>(
      Prisma.sql`SELECT * FROM ai_agent_objectives WHERE id = ${id}::uuid AND ${scopeSql(scope)} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    if (!rows[0]) throw new NotFoundException('Objective not found');
    return rows[0];
  }
  private async conversation(
    tx: Tx,
    scope: ObjectiveScope,
    id: number,
    lock = false,
  ): Promise<{ id: number; metadata: unknown }> {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new NotFoundException('Objective not found');
    const rows = await tx.$queryRaw<Array<{ id: number; metadata: unknown }>>(
      Prisma.sql`SELECT id, metadata FROM ai_conversations WHERE id = ${id} AND ${scopeSql(scope)} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    if (!rows[0]) throw new NotFoundException('Objective not found');
    return rows[0];
  }
  private assertLease(row: AgentObjective, lease: ObjectiveLease): void {
    if (
      row.version !== lease.version ||
      row.lease_generation !== lease.lease_generation ||
      !row.lease_until ||
      row.lease_until.getTime() <= Date.now()
    )
      throw new ConflictException('Objective executor was superseded');
  }
  private isCurrent(
    row: AgentObjective,
    lease: ObjectiveLease | null,
  ): boolean {
    return (
      !!lease &&
      row.version === lease.version &&
      row.lease_generation === lease.lease_generation &&
      !!row.lease_until &&
      row.lease_until.getTime() > Date.now() &&
      row.expires_at.getTime() > Date.now() &&
      !['superseded', 'cancelled', 'completed_verified'].includes(
        row.semantic_status,
      )
    );
  }

  async get(id: string): Promise<AgentObjective> {
    const scope = this.scope();
    const row = await this.transaction((tx) => this.find(tx, scope, id));
    return row.expires_at.getTime() <= Date.now() &&
      ![
        'cancelled',
        'superseded',
        'completed_verified',
        'unknown_effect',
      ].includes(row.semantic_status)
      ? { ...row, semantic_status: 'expired' }
      : row;
  }
  async getForConversation(
    conversationId: number,
  ): Promise<AgentObjective | null> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const conversation = await this.conversation(tx, scope, conversationId);
      const metadata = objectMetadata(conversation.metadata);
      if (typeof metadata.agent_objective_id !== 'string') {
        if (metadata.agent_objective_authority)
          throw new ConflictException('Durable authority pointer is missing');
        return null;
      }
      // A dangling pointer is an error, NEVER an invitation to import historical metadata again.
      return this.find(tx, scope, metadata.agent_objective_id);
    });
  }

  /** G first voice attachment is create-if-absent, NEVER replace/supersede. */
  async ensureForConversation(
    conversationId: number,
    agentId: string,
    goal: string,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const conversation = await this.conversation(
        tx,
        scope,
        conversationId,
        true,
      );
      const metadata = objectMetadata(conversation.metadata);
      if (typeof metadata.agent_objective_id === 'string')
        return this.find(tx, scope, metadata.agent_objective_id, true);
      if (metadata.agent_objective_authority)
        throw new ConflictException('Durable authority pointer is missing');
      return this.insert(tx, scope, conversationId, null, agentId, metadata, {
        goal: goal.slice(0, 2000),
        authority_snapshot: [
          ...(RequestContextService.asyncLocalStorage.getStore()?.permissions ??
            []),
        ],
      });
    });
  }

  private async insert(
    tx: Tx,
    scope: ObjectiveScope,
    conversationId: number,
    plan: AgentPlan | null,
    agentId: string | undefined,
    metadata: Record<string, unknown>,
    options: {
      goal?: string;
      authority_snapshot?: string[];
      lease?: ObjectiveLease;
      legacy_plan_id?: string;
    } = {},
  ): Promise<AgentObjective> {
    const id = randomUUID();
    const legacyId = plan?.id ?? options.legacy_plan_id ?? id;
    const now = new Date();
    const expiresAt = new Date(
      (plan ? Date.parse(plan.updated_at) || now.getTime() : now.getTime()) +
        TTL_MS,
    );
    // requires_revalidation is explicit: the column DEFAULT TRUE would mark every
    // new objective as owing a post-write read before anything was written.
    const rows = await tx.$queryRaw<
      AgentObjective[]
    >(Prisma.sql`INSERT INTO ai_agent_objectives (id,store_id,organization_id,user_id,conversation_id,agent_id,legacy_plan_id,goal,plan,step_hashes,semantic_status,budget,authority_snapshot,requires_revalidation,expires_at)
      VALUES (${id}::uuid,${scope.store_id},${scope.organization_id},${scope.user_id},${conversationId},${agentId ?? null},${legacyId},${plan?.goal ?? options.goal ?? ''},${json(plan)},${json(metadata.agent_plan_step_hashes ?? null)},${expiresAt.getTime() <= now.getTime() ? 'expired' : plan?.status === 'paused' ? 'paused' : plan?.status === 'superseded' ? 'superseded' : plan?.status === 'abandoned' ? 'cancelled' : plan?.status === 'done' ? 'partial' : 'active'},${json(emptyObjectiveBudget())},${json(options.authority_snapshot ?? [...(RequestContextService.asyncLocalStorage.getStore()?.permissions ?? [])])},${false},${expiresAt})
      ON CONFLICT (store_id, organization_id, user_id, conversation_id, legacy_plan_id) DO NOTHING RETURNING *`);
    let row = rows[0];
    if (!row) {
      const existing = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`SELECT * FROM ai_agent_objectives WHERE ${scopeSql(scope)} AND conversation_id=${conversationId} AND legacy_plan_id=${legacyId}`,
      );
      row = existing[0];
      if (!row) throw new ConflictException('Objective import conflict');
    }
    // Tombstone agent_plan to prevent flag-OFF/old lifecycle from resurrecting stale work.
    // Keep immutable migration history + hash snapshot + proposals and unrelated metadata.
    const nextMetadata = {
      ...metadata,
      ...(metadata.agent_plan
        ? { agent_plan_legacy_history: metadata.agent_plan }
        : {}),
      agent_plan: null,
      agent_objective_id: row.id,
      agent_objective_authority: 'durable-v1',
    };
    await tx.$executeRaw(
      Prisma.sql`UPDATE ai_conversations SET metadata=${json(nextMetadata)},updated_at=CURRENT_TIMESTAMP WHERE id=${conversationId} AND ${scopeSql(scope)}`,
    );
    return row;
  }

  async importLegacy(
    conversationId: number,
    agentId?: string,
    goal?: string,
  ): Promise<AgentObjective | null> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const conversation = await this.conversation(
        tx,
        scope,
        conversationId,
        true,
      );
      const metadata = objectMetadata(conversation.metadata);
      if (typeof metadata.agent_objective_id === 'string')
        return this.find(tx, scope, metadata.agent_objective_id);
      if (metadata.agent_objective_authority)
        throw new ConflictException('Durable authority pointer is missing');
      const plan = objectMetadata(metadata.agent_plan);
      if (
        typeof plan.id !== 'string' ||
        typeof plan.goal !== 'string' ||
        !Array.isArray(plan.steps) ||
        !Array.isArray(plan.deliverables)
      )
        return null;
      const authority_snapshot = [
        ...(RequestContextService.asyncLocalStorage.getStore()?.permissions ??
          []),
      ];
      // A finished/abandoned/replaced legacy plan is history, not live work:
      // the objective starts without it (the tombstone keeps the full record).
      if (['done', 'abandoned', 'superseded'].includes(String(plan.status)))
        return this.insert(tx, scope, conversationId, null, agentId, metadata, {
          goal: (goal ?? '').slice(0, 2000),
          authority_snapshot,
          legacy_plan_id: plan.id,
        });
      return this.insert(
        tx,
        scope,
        conversationId,
        plan as unknown as AgentPlan,
        agentId,
        metadata,
        { authority_snapshot },
      );
    });
  }

  async createOrReplace(
    conversationId: number,
    plan: AgentPlan | null,
    agentId?: string,
    options: {
      goal?: string;
      authority_snapshot?: string[];
      lease?: ObjectiveLease;
      completed_objective_id?: string;
    } = {},
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const conversation = await this.conversation(
        tx,
        scope,
        conversationId,
        true,
      );
      const metadata = objectMetadata(conversation.metadata);
      if (
        options.completed_objective_id &&
        metadata.agent_objective_id !== options.completed_objective_id
      )
        throw new ConflictException('Conversation objective changed');
      if (typeof metadata.agent_objective_id === 'string') {
        const previous = await this.find(
          tx,
          scope,
          metadata.agent_objective_id,
          true,
        );
        if (
          options.completed_objective_id &&
          previous.semantic_status !== 'completed_verified'
        )
          throw new ConflictException('Objective is not completed');
        if (plan && previous.plan?.id === plan.id) return previous;
        if (options.lease) this.assertLease(previous, options.lease);
        else if (
          previous.lease_until &&
          previous.lease_until.getTime() > Date.now()
        )
          throw new ObjectiveLeaseBusyException();
        await this.assertNoUnresolvedEffect(tx, scope, previous.id);
        if (previous.semantic_status !== 'completed_verified')
          await tx.$executeRaw(
            Prisma.sql`UPDATE ai_agent_objectives SET semantic_status='superseded',lease_generation=lease_generation+1,version=version+1,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${previous.id}::uuid AND ${scopeSql(scope)} AND version=${previous.version}`,
          );
      }
      return this.insert(
        tx,
        scope,
        conversationId,
        plan,
        agentId,
        metadata,
        options,
      );
    });
  }

  async acquireLease(
    id: string,
    expectedVersion: number,
    ttlMs = 90000,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    this.validId(id);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 700000)
      throw new BadRequestException('Invalid lease TTL');
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      await this.assertNoUnresolvedEffect(tx, scope, id);
      const rows = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET version=version+1,lease_generation=lease_generation+1,lease_until=CURRENT_TIMESTAMP+${ttlMs}*INTERVAL '1 millisecond',updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${expectedVersion} AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP) AND expires_at>CURRENT_TIMESTAMP AND semantic_status NOT IN ('superseded','cancelled','completed_verified','unknown_effect') RETURNING *`,
      );
      if (!rows[0]) {
        const current = await this.find(tx, scope, id);
        if (
          current.expires_at.getTime() > Date.now() &&
          ['active', 'partial', 'awaiting_input'].includes(
            current.semantic_status,
          )
        ) {
          // An effect may have appeared since the first check. Functional
          // reconciliation blocks must never become an operational retry.
          await this.assertNoUnresolvedEffect(tx, scope, id);
          if (current.lease_until && current.lease_until.getTime() > Date.now())
            throw new ObjectiveLeaseBusyException();
          if (current.version > expectedVersion)
            throw new ObjectiveLeaseChangedException();
        }
        throw new ObjectiveNotExecutableException();
      }
      return rows[0];
    });
  }

  async assertCurrent(
    id: string,
    lease: ObjectiveLease,
  ): Promise<AgentObjective> {
    const row = await this.get(id);
    this.assertLease(row, lease);
    if (
      row.expires_at.getTime() <= Date.now() ||
      ['superseded', 'cancelled', 'completed_verified'].includes(
        row.semantic_status,
      )
    )
      throw new ConflictException('Objective is not executable');
    return row;
  }

  async checkpoint(
    id: string,
    lease: ObjectiveLease,
    patch: ObjectiveCheckpoint,
  ): Promise<AgentObjective | null> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (!this.isCurrent(row, lease)) return null;
      return this.patch(tx, scope, row, patch, true);
    });
  }
  private async patch(
    tx: Tx,
    scope: ObjectiveScope,
    row: AgentObjective,
    patch: ObjectiveCheckpoint,
    keepLease: boolean,
  ): Promise<AgentObjective> {
    if (
      (patch as { semantic_status?: string }).semantic_status ===
      'completed_verified'
    )
      throw new BadRequestException('Independent verification is required');
    if (
      patch.entities?.some(
        (entity) =>
          entity.store_id !== scope.store_id ||
          !entity.source_call_id ||
          !entity.type ||
          !entity.observed_at,
      )
    )
      throw new BadRequestException('Invalid entity provenance');
    if (patch.entities) {
      if (patch.entities.length > 200)
        throw new BadRequestException('Entity checkpoint limit exceeded');
      const calls = [
        ...new Set(patch.entities.map((entity) => entity.source_call_id)),
      ];
      const sources = calls.length
        ? await tx.$queryRaw<AgentToolResult[]>(
            Prisma.sql`SELECT tool_call_id,receipt,freshness,stale_lease,resource_ids FROM ai_agent_tool_results WHERE objective_id=${row.id}::uuid AND ${scopeSql(scope)} AND tool_call_id IN (${Prisma.join(calls)})`,
          )
        : [];
      for (const entity of patch.entities) {
        const source = sources.find(
          (result) => result.tool_call_id === entity.source_call_id,
        );
        if (
          !source ||
          source.stale_lease ||
          source.receipt.status !== 'ok' ||
          source.freshness !== 'observed' ||
          source.resource_ids[entity.type] !== entity.id
        )
          throw new BadRequestException('Entity provenance is not observed');
      }
    }
    const rows = await tx.$queryRaw<AgentObjective[]>(
      Prisma.sql`UPDATE ai_agent_objectives SET plan=${json(patch.plan !== undefined ? patch.plan : row.plan)},expires_at=${patch.plan ? new Date(Date.now() + TTL_MS) : row.expires_at},goal=${patch.plan?.goal ?? row.goal},entities=${json(safeObjectiveArtifact(patch.entities ?? row.entities))},next_step=${patch.next_step !== undefined ? patch.next_step : row.next_step},semantic_status=${patch.semantic_status ?? row.semantic_status},requires_revalidation=${patch.requires_revalidation ?? row.requires_revalidation},version=version+1,lease_generation=lease_generation+${keepLease ? 0 : 1},lease_until=${keepLease ? row.lease_until : null},updated_at=CURRENT_TIMESTAMP WHERE id=${row.id}::uuid AND ${scopeSql(scope)} AND version=${row.version} AND lease_generation=${row.lease_generation} ${keepLease ? Prisma.sql`AND lease_until>CURRENT_TIMESTAMP AND expires_at>CURRENT_TIMESTAMP` : Prisma.empty} RETURNING *`,
    );
    if (!rows[0]) throw new ConflictException('Objective changed');
    return rows[0];
  }

  /** The ONLY completed_verified transition. A JSON boolean/reference cannot authorize it. */
  async commitVerified(
    id: string,
    lease: ObjectiveLease,
    capability: unknown,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      this.assertLease(row, lease);
      if (
        !row.plan ||
        !row.plan.deliverables.length ||
        !row.plan.deliverables.every((d) => d.verification) ||
        !row.plan.steps.every((s) => s.status === 'done') ||
        [
          'blocked',
          'unknown_effect',
          'awaiting_approval',
          'cancelled',
          'superseded',
        ].includes(row.semantic_status)
      )
        throw new BadRequestException(
          'All postconditions and steps must be satisfied',
        );
      const proof = consumeAgentVerification(capability, {
        ...scope,
        objective_id: id,
        step_id: 'objective',
        ...lease,
      });
      if (
        !proof ||
        !proof.evidence_refs.length ||
        proof.contracts_hash !==
          agentVerificationContractsHash(
            row.plan.deliverables.map((d) => d.verification!),
          ) ||
        JSON.stringify([...proof.workflows].sort()) !==
          JSON.stringify(
            row.plan.deliverables
              .map((d) => d.verification!.workflow_key)
              .sort(),
          )
      )
        throw new BadRequestException(
          'Independent verification capability required',
        );
      // Recheck pending/uncertain effects inside the same owner-scoped transaction.
      const effects = await tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`SELECT * FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)}`,
      );
      if (
        effects.some((effect) =>
          ['proposed', 'approved', 'applying', 'unknown'].includes(
            effect.status,
          ),
        )
      )
        throw new ConflictException(
          'Effects still require approval or reconciliation',
        );
      for (const reference of proof.evidence_refs) {
        const match = /^agent-result:([a-f0-9-]{36})$/i.exec(reference);
        if (!match) throw new BadRequestException('Invalid evidence reference');
        const found = await tx.$queryRaw<AgentToolResult[]>(
          Prisma.sql`SELECT * FROM ai_agent_tool_results WHERE id=${match[1]}::uuid AND objective_id=${id}::uuid AND ${scopeSql(scope)}`,
        );
        if (
          !found[0] ||
          found[0].stale_lease ||
          found[0].receipt.status !== 'ok' ||
          found[0].freshness !== 'observed'
        )
          throw new BadRequestException('Evidence no longer current');
      }
      const plan: AgentPlan = {
        ...row.plan,
        status: 'done',
        updated_at: new Date().toISOString(),
        deliverables: row.plan.deliverables.map((d) => ({
          ...d,
          verified: true,
          evidence_refs: proof.evidence_refs,
          evidence: proof.evidence_refs.join(', '),
        })),
      };
      const rows = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET plan=${json(plan)},semantic_status='completed_verified',requires_revalidation=false,next_step=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND ${leaseSql(lease)} AND expires_at>CURRENT_TIMESTAMP RETURNING *`,
      );
      if (!rows[0]) throw new ConflictException('Objective changed');
      return rows[0];
    });
  }

  async savePlan(
    id: string,
    expectedVersion: number,
    plan: AgentPlan,
    lease?: ObjectiveLease,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (row.expires_at.getTime() <= Date.now())
        throw new ConflictException(
          'Explicit expired objective selection is required',
        );
      if (row.version !== expectedVersion)
        throw new ConflictException('Objective changed');
      if (lease) this.assertLease(row, lease);
      else if (row.lease_until && row.lease_until.getTime() > Date.now())
        throw new ConflictException('Objective executor is active');
      return this.patch(
        tx,
        scope,
        row,
        {
          plan,
          semantic_status:
            plan.status === 'paused'
              ? 'paused'
              : plan.status === 'done'
                ? 'partial'
                : plan.status === 'superseded'
                  ? 'superseded'
                  : plan.status === 'abandoned'
                    ? 'cancelled'
                    : 'active',
        },
        !!lease,
      );
    });
  }

  async updateHashes(
    id: string,
    expectedVersion: number,
    hashes: Record<string, unknown> | null,
    lease?: ObjectiveLease,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (row.version !== expectedVersion)
        throw new ConflictException('Objective changed');
      if (lease) this.assertLease(row, lease);
      else if (row.lease_until && row.lease_until.getTime() > Date.now())
        throw new ConflictException('Objective executor is active');
      const rows = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET step_hashes=${json(hashes)},version=version+1,lease_generation=lease_generation+${lease ? 0 : 1},updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${row.version} AND lease_generation=${row.lease_generation} ${lease ? Prisma.sql`AND lease_until>CURRENT_TIMESTAMP AND expires_at>CURRENT_TIMESTAMP` : Prisma.empty} RETURNING *`,
      );
      if (!rows[0]) throw new ConflictException('Objective changed');
      return rows[0];
    });
  }

  async releaseLease(id: string, lease: ObjectiveLease): Promise<boolean> {
    const scope = this.scope();
    this.validId(id);
    return this.transaction(
      async (tx) =>
        (await tx.$executeRaw(
          Prisma.sql`UPDATE ai_agent_objectives SET lease_until=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${lease.version} AND lease_generation=${lease.lease_generation}`,
        )) === 1,
    );
  }

  /**
   * Narrow D1 crash recovery, not a domain verifier/retry: a durable known applied
   * receipt may have committed before its tool-result checkpoint. Recover only
   * the waiting lifecycle; never replay a write or assert completed_verified.
   */
  async recoverAppliedReceipt(
    id: string,
    expectedVersion: number,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (row.version !== expectedVersion)
        throw new ConflictException('Objective changed');
      if (
        row.semantic_status !== 'awaiting_approval' ||
        (row.lease_until && row.lease_until.getTime() > Date.now())
      )
        return row;
      const receipts = await tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`SELECT * FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND status='applied' ORDER BY updated_at DESC,id DESC LIMIT 1`,
      );
      const applied = receipts[0];
      const ids = applied?.domain_receipt?.resource_ids;
      if (
        !applied?.domain_reference ||
        applied.domain_receipt?.status !== 'ok' ||
        !ids ||
        typeof ids !== 'object' ||
        Array.isArray(ids) ||
        !Object.keys(ids).length ||
        isHistoricalObjectiveArtifact(applied.domain_receipt)
      )
        return row;
      const values = Object.values(ids);
      if (
        !values.every(
          (value) =>
            (typeof value === 'string' && value.length > 0) ||
            (typeof value === 'number' && Number.isFinite(value)),
        ) ||
        !values.some((value) => String(value) === applied.domain_reference)
      )
        return row;
      // Equal timestamps are ambiguous, so conservatively preserve the pending
      // choice. A later proposal/approval must never be bypassed by an old receipt.
      const pending = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND status IN ('proposed','approved','applying','unknown') AND (created_at>=${applied.created_at} OR updated_at>=${applied.updated_at}) LIMIT 1`,
      );
      if (pending.length) return row;
      const updated = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET semantic_status='partial',requires_revalidation=true,next_step='Recuperar el recibo aplicado y consultar el estado actual sin repetir la operación.',version=version+1,lease_generation=lease_generation+1,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${row.version} AND lease_generation=${row.lease_generation} AND semantic_status='awaiting_approval' AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP) RETURNING *`,
      );
      if (!updated[0]) throw new ConflictException('Objective changed');
      return updated[0];
    });
  }

  async resume(
    id: string,
    options: { allow_expired: boolean; expected_version: number },
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (
        row.version !== options.expected_version ||
        (row.lease_until && row.lease_until.getTime() > Date.now()) ||
        [
          'superseded',
          'cancelled',
          'completed_verified',
          'unknown_effect',
          'awaiting_approval',
        ].includes(row.semantic_status)
      )
        throw new ConflictException('Objective cannot be resumed');
      await this.assertNoUnresolvedEffect(tx, scope, id);
      const expired = row.expires_at.getTime() <= Date.now();
      if (expired && !options.allow_expired)
        throw new ConflictException(
          'Explicit expired objective selection is required',
        );
      const rows = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET semantic_status='active',plan=${json(row.plan?.status === 'paused' ? { ...row.plan, status: 'active', updated_at: new Date().toISOString() } : row.plan)},requires_revalidation=true,expires_at=${expired ? new Date(Date.now() + TTL_MS) : row.expires_at},version=version+1,lease_generation=lease_generation+1,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${row.version} AND lease_generation=${row.lease_generation} RETURNING *`,
      );
      if (!rows[0]) throw new ConflictException('Objective changed');
      return rows[0];
    });
  }

  async rejectProposal(
    id: string,
    expectedVersion: number,
  ): Promise<AgentObjective> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (
        row.version !== expectedVersion ||
        row.semantic_status !== 'awaiting_approval' ||
        (row.lease_until && row.lease_until.getTime() > Date.now())
      )
        throw new ConflictException('Objective proposal cannot be rejected');
      await this.assertNoUnresolvedEffect(tx, scope, id);
      await tx.$executeRaw(
        Prisma.sql`UPDATE ai_agent_effects SET status='failed',history=history||${json([{ status: 'failed', reason: 'user_rejected', at: new Date().toISOString() }])},updated_at=CURRENT_TIMESTAMP WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND status IN ('proposed','approved')`,
      );
      const rows = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET semantic_status='active',requires_revalidation=true,version=version+1,lease_generation=lease_generation+1,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${row.version} AND lease_generation=${row.lease_generation} RETURNING *`,
      );
      if (!rows[0]) throw new ConflictException('Objective changed');
      return rows[0];
    });
  }

  /**
   * Audit only actual provider usage, including a response from an old executor.
   * This never adopts the current fence or grants authority to continue work.
   * Attempts are reserved separately by fenced addBudget BEFORE dispatch.
   */
  async auditBudget(
    id: string,
    originGeneration: number,
    delta: Partial<ObjectiveBudget>,
  ): Promise<void> {
    const scope = this.scope();
    if (!Number.isSafeInteger(originGeneration) || originGeneration <= 0)
      throw new BadRequestException(
        'An observed positive lease generation is required',
      );
    const allowed = new Set(['prompt_tokens', 'completion_tokens', 'cost_usd']);
    if (
      Object.keys(delta).some((key) => !allowed.has(key)) ||
      Object.entries(delta).some(
        ([key, value]) => key !== 'cost_usd' && value === null,
      )
    )
      throw new BadRequestException(
        'Only observed provider tokens and cost may be audited',
      );
    await this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (originGeneration > row.lease_generation)
        throw new ConflictException('Unknown future objective generation');
      if (!Object.keys(delta).length) return;
      const budget = addObjectiveBudget(row.budget, delta);
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE ai_agent_objectives SET budget=${json(budget)} WHERE id=${id}::uuid AND ${scopeSql(scope)} AND lease_generation>=${originGeneration}`,
      );
      if (affected !== 1)
        throw new ConflictException('Objective usage could not be audited');
    });
  }

  async addBudget(
    id: string,
    lease: ObjectiveLease,
    delta: Partial<ObjectiveBudget>,
  ): Promise<AgentObjective | null> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (!this.isCurrent(row, lease)) return null;
      const budget = addObjectiveBudget(row.budget, delta);
      const rows = await tx.$queryRaw<AgentObjective[]>(
        Prisma.sql`UPDATE ai_agent_objectives SET budget=${json(budget)},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=${id}::uuid AND ${scopeSql(scope)} AND ${leaseSql(lease)} RETURNING *`,
      );
      return rows[0] ?? null;
    });
  }

  async appendToolResult(
    id: string,
    lease: ObjectiveLease | null,
    input: AppendToolResultInput,
  ): Promise<{
    result: AgentToolResult;
    objective: AgentObjective;
    advanced: boolean;
  }> {
    const scope = this.scope();
    if (
      !input.tool_call_id ||
      input.tool_call_id.length > 200 ||
      !input.tool_name ||
      !/^[a-f0-9]{64}$/i.test(input.args_hash)
    )
      throw new BadRequestException('Invalid call identity');
    const data = safeObjectiveArtifact(input.data);
    const receipt = {
      ...(safeObjectiveArtifact(input.receipt) as typeof input.receipt),
      ...(isHistoricalObjectiveArtifact(data)
        ? { freshness: 'unknown' as const }
        : {}),
    };
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 2_000_000)
      throw new BadRequestException(
        'Result artifact exceeds 2 MB; use a bounded upstream page',
      );
    return this.transaction(async (tx) => {
      let row = await this.find(tx, scope, id, true);
      if (input.task_id) {
        const tasks = await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT id FROM ai_agent_tasks WHERE id=${input.task_id} AND objective_id=${id}::uuid AND ${scopeSql(scope)}`,
        );
        if (!tasks[0]) throw new NotFoundException('Objective not found');
      }
      const current = this.isCurrent(row, lease);
      const rows = await tx.$queryRaw<
        AgentToolResult[]
      >(Prisma.sql`INSERT INTO ai_agent_tool_results (id,store_id,organization_id,user_id,objective_id,task_id,tool_call_id,tool_name,tool_version,args_hash,receipt,data,pagination,freshness,resource_ids,evidence_refs,lease_generation,stale_lease)
        VALUES (${randomUUID()}::uuid,${scope.store_id},${scope.organization_id},${scope.user_id},${id}::uuid,${input.task_id ?? null},${input.tool_call_id},${input.tool_name},${input.tool_version ?? '1'},${input.args_hash},${json(receipt)},${json(data ?? null)},${json(receipt.pagination)},${receipt.freshness},${json(receipt.resource_ids)},${json(receipt.evidence_refs)},${lease?.lease_generation ?? null},${!current})
        ON CONFLICT (objective_id,tool_call_id) DO NOTHING RETURNING *`);
      let result = rows[0];
      if (!result) {
        const existing = await tx.$queryRaw<AgentToolResult[]>(
          Prisma.sql`SELECT * FROM ai_agent_tool_results WHERE objective_id=${id}::uuid AND tool_call_id=${input.tool_call_id} AND ${scopeSql(scope)}`,
        );
        result = existing[0];
        if (
          !result ||
          result.args_hash !== input.args_hash ||
          result.tool_name !== input.tool_name ||
          result.tool_version !== (input.tool_version ?? '1')
        )
          throw new ConflictException('Call identity conflict');
        return { result, objective: row, advanced: false };
      }
      // Account actual work even from a fenced executor, without advancing its plan,
      // version, lease or entities. Row lock serializes accumulation with live work.
      if (input.budget_delta) {
        const budget = addObjectiveBudget(row.budget, input.budget_delta);
        await tx.$executeRaw(
          Prisma.sql`UPDATE ai_agent_objectives SET budget=${json(budget)} WHERE id=${id}::uuid AND ${scopeSql(scope)}`,
        );
        row = { ...row, budget };
      }
      if (current) {
        const resolved = Object.entries(receipt.resource_ids)
          .filter(
            ([, value]) =>
              typeof value === 'string' || typeof value === 'number',
          )
          .map(([type, entityId]) => ({
            store_id: scope.store_id,
            type,
            id: entityId,
            source_call_id: input.tool_call_id,
            observed_at: result.created_at.toISOString(),
            volatile: /stock|price|balance|fiscal|inventory|saldo|precio/i.test(
              type,
            ),
          }));
        const entities = new Map(
          row.entities.map((entity) => [`${entity.type}:${entity.id}`, entity]),
        );
        // Only explicit observed receipt IDs become facts; prose/data never supply identities.
        if (receipt.status === 'ok' && receipt.freshness === 'observed')
          for (const entity of resolved)
            entities.set(`${entity.type}:${entity.id}`, entity);
        // A checkpoint may only CLEAR requires_revalidation with an observed,
        // successful business read while no dispatch is in flight/uncertain.
        // The read is created now, so it is necessarily after the last apply.
        let checkpoint = input.checkpoint;
        if (
          checkpoint?.requires_revalidation === false &&
          row.requires_revalidation &&
          !(
            receipt.status === 'ok' &&
            receipt.freshness === 'observed' &&
            receipt.effect_status === 'not_applicable' &&
            !INTERNAL_RESULT_TOOLS.has(input.tool_name) &&
            !(await this.hasUncertainEffect(tx, scope, id))
          )
        )
          checkpoint = { ...checkpoint, requires_revalidation: undefined };
        if (checkpoint || resolved.length) {
          try {
            row = await this.patch(
              tx,
              scope,
              row,
              {
                ...checkpoint,
                entities:
                  checkpoint?.entities ?? [...entities.values()].slice(-200),
              },
              true,
            );
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            await tx.$executeRaw(
              Prisma.sql`UPDATE ai_agent_tool_results SET stale_lease=true WHERE id=${result.id}::uuid AND objective_id=${id}::uuid AND ${scopeSql(scope)}`,
            );
            return {
              result: { ...result, stale_lease: true },
              objective: row,
              advanced: false,
            };
          }
        }
      }
      return { result, objective: row, advanced: current };
    });
  }

  /** Server-owned runtime checkpoints, never supplied by a model/tool payload. */
  async latestInternalResult(
    id: string,
    toolName: 'agent_recovery_checkpoint',
  ): Promise<AgentToolResult | null> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      const rows = await tx.$queryRaw<AgentToolResult[]>(
        Prisma.sql`SELECT * FROM ai_agent_tool_results WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND tool_name=${toolName} AND stale_lease=false ORDER BY (data->>'checkpoint_version')::bigint DESC,created_at DESC,id DESC LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  async listResults(
    id: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<ResultPage> {
    const scope = this.scope();
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
    if (!Number.isFinite(limit))
      throw new BadRequestException('Invalid page limit');
    if (options.cursor && !UUID.test(options.cursor))
      throw new BadRequestException('Invalid cursor');
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      const cursor = options.cursor
        ? await tx.$queryRaw<AgentToolResult[]>(
            Prisma.sql`SELECT * FROM ai_agent_tool_results WHERE id=${options.cursor}::uuid AND objective_id=${id}::uuid AND ${scopeSql(scope)}`,
          )
        : [];
      if (options.cursor && !cursor[0])
        throw new NotFoundException('Objective not found');
      const after = cursor[0]
        ? Prisma.sql`AND (created_at,id)>(${cursor[0].created_at},${cursor[0].id}::uuid)`
        : Prisma.empty;
      const rows = await tx.$queryRaw<AgentToolResult[]>(
        Prisma.sql`SELECT id,store_id,organization_id,user_id,objective_id,task_id,tool_call_id,tool_name,tool_version,args_hash,receipt,CASE WHEN octet_length(data::text)<=1500 THEN data ELSE NULL END AS data,pagination,freshness,resource_ids,evidence_refs,lease_generation,stale_lease,created_at,(octet_length(data::text)>1500) AS data_omitted FROM ai_agent_tool_results WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND tool_name <> 'agent_recovery_checkpoint' ${after} ORDER BY created_at,id LIMIT ${limit + 1}`,
      );
      const items = rows.slice(0, limit);
      return {
        items,
        has_more: rows.length > limit,
        next_cursor: rows.length > limit ? items[items.length - 1].id : null,
      };
    });
  }

  /** Latest two distinct release identities, not historical bodies/authority. */
  async listPlaybookPins(id: string): Promise<ActivePlaybookPin[]> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      const rows = await tx.$queryRaw<ActivePlaybookPin[]>(Prisma.sql`
        SELECT id,version,hash,section FROM (
          SELECT DISTINCT ON (data->>'id') data->>'id' AS id,
            data->>'version' AS version, data->>'hash' AS hash,
            data#>>'{section,id}' AS section,created_at,tool_call_id
          FROM ai_agent_tool_results WHERE objective_id=${id}::uuid AND ${scopeSql(scope)}
            AND tool_name='load_playbook' AND receipt->>'status'='ok'
            AND stale_lease=false AND freshness='observed'
            AND jsonb_typeof(data)='object' AND data->>'id' IS NOT NULL
          ORDER BY data->>'id',created_at DESC,tool_call_id DESC
        ) pins ORDER BY created_at DESC,tool_call_id DESC LIMIT 2`);
      // A bad/old result is not adopted as executable metadata.
      return rows
        .filter(
          (pin) =>
            typeof pin.id === 'string' &&
            /^[a-z][a-z0-9-]{0,63}$/.test(pin.id) &&
            typeof pin.version === 'string' &&
            /^\d+(?:\.\d+){0,2}$/.test(pin.version) &&
            typeof pin.hash === 'string' &&
            /^[a-f0-9]{64}$/.test(pin.hash) &&
            (pin.section == null || /^[a-z][a-z0-9-]{0,99}$/.test(pin.section)),
        )
        .slice(0, 2)
        .map((pin) => ({
          id: pin.id,
          version: pin.version,
          hash: pin.hash,
          ...(pin.section ? { section: pin.section } : {}),
        }));
    });
  }

  async getResult(id: string, resultId: string): Promise<AgentToolResult> {
    const scope = this.scope();
    this.validId(resultId);
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      const rows = await tx.$queryRaw<AgentToolResult[]>(
        Prisma.sql`SELECT * FROM ai_agent_tool_results WHERE id=${resultId}::uuid AND objective_id=${id}::uuid AND ${scopeSql(scope)}`,
      );
      if (!rows[0]) throw new NotFoundException('Objective not found');
      return rows[0];
    });
  }

  async proposeEffect(
    id: string,
    input: { operation_id: string; proposal_hash: string; step_id: string },
    lease?: ObjectiveLease,
  ): Promise<AgentEffect> {
    const scope = this.scope();
    if (
      !input.operation_id ||
      input.operation_id.length > 200 ||
      !input.step_id ||
      input.step_id.length > 200 ||
      !/^[a-f0-9]{64}$/i.test(input.proposal_hash)
    )
      throw new BadRequestException('Invalid effect identity');
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (lease) this.assertLease(row, lease);
      if (
        row.expires_at.getTime() <= Date.now() ||
        ['superseded', 'cancelled', 'completed_verified'].includes(
          row.semantic_status,
        )
      )
        throw new ConflictException('Objective is not executable');
      await this.assertNoUnresolvedEffect(tx, scope, id);
      const rows = await tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`INSERT INTO ai_agent_effects (id,store_id,organization_id,user_id,objective_id,operation_id,proposal_hash,step_id,status,history) VALUES (${randomUUID()}::uuid,${scope.store_id},${scope.organization_id},${scope.user_id},${id}::uuid,${input.operation_id},${input.proposal_hash},${input.step_id},'proposed',${json([{ status: 'proposed', at: new Date().toISOString() }])}) ON CONFLICT DO NOTHING RETURNING *`,
      );
      if (rows[0]) return rows[0];
      const existing = await tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`SELECT * FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND step_id=${input.step_id} AND proposal_hash=${input.proposal_hash}`,
      );
      if (!existing[0]) throw new ConflictException('Effect identity conflict');
      return existing[0];
    });
  }

  private async hasUncertainEffect(
    tx: Tx,
    scope: ObjectiveScope,
    id: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND status IN ('applying','unknown') LIMIT 1`,
    );
    return rows.length > 0;
  }

  private async assertNoUnresolvedEffect(
    tx: Tx,
    scope: ObjectiveScope,
    id: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND status IN ('applying','unknown') LIMIT 1`,
    );
    if (rows.length)
      throw new ConflictException(
        'An uncertain effect requires reconciliation before continuing',
      );
  }

  /**
   * True while the objective still owes something before a NEW human goal can
   * replace it: a proposal awaiting a decision, a dispatch in flight, an
   * uncertain effect, or an applied write not yet followed by an observed read
   * (`requires_revalidation`, which is set by the apply and cleared by that read).
   */
  async hasPendingEffects(id: string): Promise<boolean> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const row = await this.find(tx, scope, id);
      const effects = await tx.$queryRaw<Array<{ id: string; status: string }>>(
        Prisma.sql`SELECT id,status FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} AND status IN ('proposed','approved','applying','unknown','applied') LIMIT 100`,
      );
      return effects.some(
        (effect) =>
          (UNRESOLVED_EFFECT_STATUSES as readonly string[]).includes(
            effect.status,
          ) ||
          (effect.status === 'applied' && row.requires_revalidation),
      );
    });
  }

  async listEffects(id: string, limit = 50): Promise<AgentEffect[]> {
    const scope = this.scope();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Invalid effect page limit');
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      return tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`SELECT id,store_id,organization_id,user_id,objective_id,operation_id,proposal_hash,step_id,status,CASE WHEN octet_length(domain_receipt::text)<=2000 THEN domain_receipt ELSE NULL END AS domain_receipt,domain_reference,evidence_result_id,created_at,updated_at FROM ai_agent_effects WHERE objective_id=${id}::uuid AND ${scopeSql(scope)} ORDER BY created_at DESC,id DESC LIMIT ${limit}`,
      );
    });
  }

  async getEffect(id: string, operationId: string): Promise<AgentEffect> {
    const scope = this.scope();
    return this.transaction(async (tx) => {
      await this.find(tx, scope, id);
      const rows = await tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`SELECT * FROM ai_agent_effects WHERE objective_id=${id}::uuid AND operation_id=${operationId} AND ${scopeSql(scope)}`,
      );
      if (!rows[0]) throw new NotFoundException('Objective not found');
      return rows[0];
    });
  }

  async transitionEffect(
    id: string,
    operationId: string,
    expectedStatus: AgentEffectStatus,
    nextStatus: AgentEffectStatus,
    details: {
      domain_receipt?: Record<string, unknown>;
      domain_reference?: string;
      evidence_result_id?: string;
    } = {},
    lease?: ObjectiveLease,
  ): Promise<AgentEffect> {
    const transitions: Record<AgentEffectStatus, AgentEffectStatus[]> = {
      proposed: ['approved', 'failed'],
      approved: ['applying', 'failed'],
      applying: ['applied', 'unknown', 'failed'],
      applied: ['verified', 'unknown'],
      verified: [],
      unknown: ['applied', 'failed'],
      failed: [],
    };
    if (!transitions[expectedStatus]?.includes(nextStatus))
      throw new ConflictException('Invalid effect transition');
    const scope = this.scope();
    return this.transaction(async (tx) => {
      const objective = await this.find(tx, scope, id, true);
      // An old executor may append the dispatch receipt, but may NOT start another write.
      if (nextStatus === 'applying') {
        if (!lease)
          throw new ConflictException(
            'An execution lease is required before dispatch',
          );
        this.assertLease(objective, lease);
        if (!this.isCurrent(objective, lease))
          throw new ConflictException('Objective is not executable');
      }
      if (nextStatus === 'verified') {
        // This stores explicitly observed independent domain evidence; D1 never runs a verifier.
        if (
          !details.evidence_result_id ||
          !UUID.test(details.evidence_result_id)
        )
          throw new BadRequestException(
            'Independent observed evidence is required',
          );
        const previous = await tx.$queryRaw<AgentEffect[]>(
          Prisma.sql`SELECT * FROM ai_agent_effects WHERE objective_id=${id}::uuid AND operation_id=${operationId} AND ${scopeSql(scope)}`,
        );
        const effect = previous[0];
        const expectedIds = effect?.domain_receipt?.resource_ids;
        if (
          !effect?.domain_reference ||
          !expectedIds ||
          typeof expectedIds !== 'object' ||
          Array.isArray(expectedIds) ||
          !Object.keys(expectedIds).length
        )
          throw new BadRequestException(
            'Typed domain identity is required for verification',
          );
        const receipts = await tx.$queryRaw<AgentToolResult[]>(
          Prisma.sql`SELECT * FROM ai_agent_tool_results WHERE id=${details.evidence_result_id}::uuid AND objective_id=${id}::uuid AND ${scopeSql(scope)}`,
        );
        const evidence = receipts[0];
        if (
          !evidence ||
          isHistoricalObjectiveArtifact(evidence.data) ||
          evidence.receipt.status !== 'ok' ||
          evidence.freshness !== 'observed' ||
          evidence.stale_lease ||
          evidence.receipt.effect_status !== 'not_applicable' ||
          !Object.keys(evidence.resource_ids).length ||
          !Object.entries(expectedIds).every(
            ([key, value]) => evidence.resource_ids[key] === value,
          ) ||
          !Object.values(evidence.resource_ids).some(
            (value) => String(value) === effect.domain_reference,
          ) ||
          evidence.created_at.getTime() < effect.updated_at.getTime()
        )
          throw new BadRequestException(
            'Independent observed evidence is required',
          );
      }
      const event = {
        status: nextStatus,
        at: new Date().toISOString(),
        lease_generation: lease?.lease_generation ?? null,
        stale_lease: lease ? !this.isCurrent(objective, lease) : null,
      };
      const rows = await tx.$queryRaw<AgentEffect[]>(
        Prisma.sql`UPDATE ai_agent_effects SET status=${nextStatus},domain_receipt=${details.domain_receipt === undefined ? Prisma.sql`domain_receipt` : json(details.domain_receipt)},domain_reference=COALESCE(${details.domain_reference ?? null},domain_reference),evidence_result_id=COALESCE(${details.evidence_result_id ?? null}::uuid,evidence_result_id),history=history||${json([event])},updated_at=CURRENT_TIMESTAMP WHERE objective_id=${id}::uuid AND operation_id=${operationId} AND ${scopeSql(scope)} AND status=${expectedStatus} RETURNING *`,
      );
      if (!rows[0])
        throw new ConflictException('Effect changed or is unavailable');
      if (nextStatus === 'unknown' && lease && this.isCurrent(objective, lease))
        await tx.$executeRaw(
          Prisma.sql`UPDATE ai_agent_objectives SET semantic_status='unknown_effect',requires_revalidation=true WHERE id=${id}::uuid AND ${scopeSql(scope)} AND version=${lease.version} AND lease_generation=${lease.lease_generation}`,
        );
      return rows[0];
    });
  }
}

/** Stable server identity; never persist raw approval tokens or tool arguments. */
export function objectiveOperationId(
  objectiveId: string,
  stepId: string,
  proposalHash: string,
): string {
  return createHash('sha256')
    .update(`${objectiveId}:${stepId}:${proposalHash}`)
    .digest('hex');
}

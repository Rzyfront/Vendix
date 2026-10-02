import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from '../../../../ai-engine/tools/bridge/capability-registry.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VexiPlanStateService } from '../../vexi/vexi-plan-state.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/** One approval covers the whole plan; 15 minutes to run it before re-asking. */
export const PLAN_TOKEN_TTL_SECONDS = 900;

export type PlanRedeemOutcome =
  | 'ok'
  | 'missing'
  | 'mismatch'
  | 'unknown_step'
  | 'replayed'
  | 'irreversible';

/** Plan antiguo que supera esto ya no se aprueba: hay que volver a proponerlo. */
export const PLAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type VexPlanStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'partially_applied';
export type VexPlanStepStatus = 'pending' | 'applied' | 'failed' | 'cancelled';

/** Un paso de `ai_messages.metadata.plan.steps` (contrato con el frontend). */
export interface VexPlanStepRecord {
  step_id: string;
  order: number;
  tool: string;
  arguments: Record<string, any>;
  preview?: unknown;
  irreversible: boolean;
  status: VexPlanStepStatus;
  error?: string;
}

/** `ai_messages.metadata.plan`. */
export interface VexPlanRecord {
  plan_id: string;
  status: VexPlanStatus;
  steps: VexPlanStepRecord[];
}

interface LoadedPlan {
  message_id: number;
  metadata: Record<string, any>;
  plan: VexPlanRecord;
}

const TERMINAL_STEP_STATUSES: VexPlanStepStatus[] = [
  'applied',
  'failed',
  'cancelled',
];

export interface PlanApprovalStep {
  order: number;
  tool: string;
  args: Record<string, any>;
}

export interface ClassifiedPlanSteps {
  covered: PlanApprovalStep[];
  reconfirm: PlanApprovalStep[];
}

export interface ApprovePlanInput {
  planId: string;
  conversationId: number;
  userId: number | undefined;
  /**
   * Client-declared steps (the card's selection). Used ONLY as a subset
   * selector: each entry's content is verified against the server hashes the
   * proposing turn persisted, and anything unverifiable is ignored.
   */
  clientSteps: PlanApprovalStep[];
}

export interface ApprovePlanResult {
  plan_token: string;
  covered_steps: number[];
  reconfirm_steps: number[];
  /** Client orders that matched no server hash (altered, invented, or stale). */
  ignored_steps: number[];
}

/**
 * Compare-and-consume one step in a single round trip.
 *
 *  1 → consumed, the step may run exactly once
 *  0 → no such token (never issued, or expired)
 * -1 → token exists but the user/plan/step-list fingerprint does not match
 * -2 → the step hash is not part of this plan (arguments were altered)
 * -3 → the step is irreversible: the plan approval never covers it
 * -4 → the step already ran under this token
 */
const REDEEM_STEP_SCRIPT = `
local fp = redis.call('HGET', KEYS[1], 'fp')
if not fp then return 0 end
if fp ~= ARGV[1] then return -1 end
local v = redis.call('HGET', KEYS[1], ARGV[2])
if not v then return -2 end
if v == 'I' then return -3 end
if v == '1' then return -4 end
redis.call('HSET', KEYS[1], ARGV[2], '1')
return 1
`;

/**
 * Domain segments whose writes always re-confirm, even inside an approved plan.
 *
 * Single-sourced from `IRREVERSIBLE_DOMAINS` in
 * `ai-engine/tools/bridge/capability-registry.service.ts` (imported above):
 * the local mirror drifted once (`cash-register` vs `cash-registers`) and let
 * irreversible writes slip through whole-plan approval. Membership is pinned
 * by the spec; the matching logic below is unchanged.
 */

/**
 * Deterministic JSON: object keys sorted at every depth, arrays kept in order.
 * Same function as `VexiConfirmationService` — duplicated rather than imported
 * because that module keeps it private, and the two fingerprints must hash
 * identically for the same arguments.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Whole-plan approval for Vex: one click authorizes every reversible step.
 *
 * The token binds (user, plan, ORDERED step hashes). Order matters because a
 * plan is a sequence — "crear y luego enviar" is not the same approval as
 * "enviar y luego crear" — so the fingerprint hashes the ordered list, while
 * each step redeems independently (a retry of step 2 must not re-run step 1,
 * and must not be blocked by step 3 already consumed).
 *
 * Irreversible steps are fingerprinted but never consumable: redeeming one
 * answers `irreversible` so the caller routes it to its own confirmation card.
 * The token authorizes nothing by itself — each step still executes through
 * `executeTool()`, which re-checks permissions on the way through.
 */
@Injectable()
export class PlanApprovalService {
  private readonly logger = new Logger(PlanApprovalService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly toolRegistry: AIToolRegistry,
    private readonly planState: VexiPlanStateService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * Approves a whole plan with one click and mints its single-use token.
   *
   * Three gates, in order:
   *
   * 1. Ownership — the approver must own the thread. A foreign id answers 403
   *    even when the row exists, and a missing row answers the same, so a
   *    cross-store id reveals nothing.
   * 2. Server verification — each client step is checked against the hashes
   *    the proposing turn persisted (`VexiPlanStateService`, written by the
   *    loop, never by the client). The client steps only SELECT the subset
   *    (unchecking a step is allowed); their content is proved, not trusted —
   *    altered, invented or stale entries land in `ignored_steps` and never
   *    reach the token. Nothing verifiable → 409: re-ask Vex to propose.
   * 3. Classification — the VERIFIED subset splits into covered (reversibles,
   *    which later execute with no further confirmation) vs reconfirm
   *    (irreversibles, which always get their own confirmation card).
   *
   * The token binds (user, plan, ORDERED verified hashes) with a 15-minute
   * TTL; each step redeems independently through `redeemPlanStep`.
   */
  async approvePlan(input: ApprovePlanInput): Promise<ApprovePlanResult> {
    const { planId, conversationId, userId, clientSteps } = input;

    // Propiedad ANTES de leer nada del hilo: un 404 por "sin hashes" para quien
    // no es dueño filtraría la existencia del plan frente al 403.
    await this.assertConversationOwner(conversationId, userId);

    // Un plan cancelado (o ya aplicado) no se aprueba: el estado persistido
    // manda sobre cualquier hash que haya sobrevivido.
    const loaded = await this.loadPlan(conversationId, planId);
    if (loaded && loaded.plan.status !== 'proposed') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        loaded.plan.status === 'rejected'
          ? 'Ese plan fue cancelado. Pídele a Vex que lo proponga de nuevo.'
          : 'Ese plan ya fue resuelto y no admite una nueva aprobación.',
        { reason: 'plan_not_proposed', plan_status: loaded.plan.status },
      );
    }

    const record = await this.planState.getStepHashRecord(conversationId);
    const server = record.steps;
    if (server.length > 0) {
      if (record.plan_id !== planId) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ese plan ya no es el vigente en esta conversación. Vuelve a pedirle a Vex que lo proponga.',
          { reason: 'plan_mismatch' },
        );
      }
      const createdAt = record.created_at
        ? new Date(record.created_at).getTime()
        : NaN;
      if (!Number.isFinite(createdAt) || Date.now() - createdAt >= PLAN_MAX_AGE_MS) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Este plan venció. Vuelve a pedirle a Vex que lo proponga.',
          { reason: 'plan_expired' },
        );
      }
    }

    const byOrder = new Map(server.map((h) => [h.order, h]));
    const verified: PlanApprovalStep[] = [];
    const ignored: number[] = [];
    for (const step of clientSteps) {
      const hash = byOrder.get(step.order);
      if (
        hash &&
        hash.tool === step.tool &&
        hash.args_hash === this.stepHash(step.tool, step.args)
      ) {
        verified.push(step);
      } else {
        ignored.push(step.order);
      }
    }
    if (verified.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        server.length === 0
          ? 'Este plan venció o se propuso antes de poder verificarse. Vuelve a pedirle a Vex que lo proponga.'
          : 'Los pasos del plan cambiaron después de la propuesta. Vuelve a pedirle a Vex que lo proponga.',
        { ignored_steps: ignored },
      );
    }

    const { covered, reconfirm } = this.classifySteps(verified);
    const token = await this.issuePlanToken(planId, userId, verified);
    if (loaded) {
      await this.savePlan(conversationId, loaded, {
        ...loaded.plan,
        status: 'approved',
      });
    }
    return {
      plan_token: token,
      covered_steps: covered.map((s) => s.order),
      reconfirm_steps: reconfirm.map((s) => s.order),
      ignored_steps: ignored,
    };
  }

  // ── ciclo de vida persistido (`ai_messages.metadata.plan`) ────────────

  /** 403 si la conversación no existe en la tienda o no es del usuario. */
  async assertConversationOwner(
    conversationId: number,
    userId: number | undefined,
  ): Promise<void> {
    // `user_id: undefined` lo ignora Prisma: sin usuario no hay dueño posible.
    const conversation =
      userId === undefined || userId === null
        ? null
        : await this.prisma.ai_conversations.findFirst({
            where: { id: conversationId },
            select: { user_id: true },
          });
    if (!conversation || conversation.user_id !== userId) {
      throw new VendixHttpException(
        ErrorCodes.AUTH_PERM_001,
        'Este plan pertenece a otra conversación.',
      );
    }
  }

  /**
   * Rechaza el plan en el servidor: pasos `pending` → `cancelled`, estado
   * `rejected` y hashes borrados (un plan cancelado deja de ser aprobable).
   * 403 si no es dueño; 409 si ya quedó `applied`, `partially_applied` o
   * `rejected`. Un plan aprobado sin aplicar sí se puede cancelar: los pasos
   * ya aplicados conservan su estado.
   */
  async rejectPlan(input: {
    planId: string;
    conversationId: number;
    userId: number | undefined;
  }): Promise<{ plan_id: string; status: 'rejected' }> {
    const { planId, conversationId, userId } = input;
    await this.assertConversationOwner(conversationId, userId);

    const loaded = await this.loadPlan(conversationId, planId);
    if (!loaded) {
      // El plan nunca persistió su tarjeta (turno anterior al ciclo de vida):
      // solo se puede cancelar si los hashes vigentes son los suyos.
      const record = await this.planState.getStepHashRecord(conversationId);
      if (record.plan_id !== planId) {
        throw new VendixHttpException(
          ErrorCodes.SYS_NOT_FOUND_001,
          'Ese plan ya no está activo en esta conversación.',
        );
      }
      await this.planState.clearStepHashes(conversationId);
      return { plan_id: planId, status: 'rejected' };
    }
    if (loaded.plan.status === 'applied' || loaded.plan.status === 'partially_applied' || loaded.plan.status === 'rejected') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        loaded.plan.status === 'rejected'
          ? 'Ese plan ya estaba cancelado.'
          : 'Ese plan ya se aplicó y no se puede cancelar.',
        { reason: 'plan_not_open', plan_status: loaded.plan.status },
      );
    }
    await this.savePlan(conversationId, loaded, {
      ...loaded.plan,
      status: 'rejected',
      steps: loaded.plan.steps.map((step) =>
        step.status === 'pending'
          ? { ...step, status: 'cancelled' as const }
          : step,
      ),
    });
    await this.planState.clearStepHashes(conversationId);
    return { plan_id: planId, status: 'rejected' };
  }

  /**
   * Valida que un paso pueda recibir su tarjeta de confirmación individual:
   * dueño, plan `approved`, paso irreversible y `pending`. Devuelve el paso
   * tal como lo persistió el servidor (tool + argumentos): el token se acuña
   * sobre eso, nunca sobre lo que diga el cliente.
   */
  async resolveStepForConfirmation(input: {
    planId: string;
    stepId: string;
    conversationId: number;
    userId: number | undefined;
  }): Promise<VexPlanStepRecord> {
    const step = await this.resolveOpenStep(input);
    if (!step.irreversible) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Ese paso está cubierto por la aprobación del plan y no necesita confirmación aparte.',
        { reason: 'step_not_irreversible' },
      );
    }
    return step;
  }

  /**
   * Valida que un paso pueda aplicarse: dueño, plan `approved` y paso
   * `pending`. Devuelve el paso persistido (tool + argumentos del servidor).
   */
  async resolveStepForApply(input: {
    planId: string;
    stepId: string;
    conversationId: number;
    userId: number | undefined;
  }): Promise<VexPlanStepRecord> {
    return this.resolveOpenStep(input);
  }

  /**
   * Guarda el resultado de un paso y recalcula el estado del plan: con todos
   * los pasos terminales es `applied` si ninguno falló y `partially_applied`
   * si alguno falló; mientras queden pendientes sigue `approved`.
   *
   * `stepId` se omite en el camino antiguo (el cliente solo manda tool +
   * argumentos): el paso se localiza por su hash de contenido.
   */
  async recordStepResult(input: {
    planId: string;
    conversationId: number;
    stepId?: string;
    tool?: string;
    args?: Record<string, any>;
    outcome: 'applied' | 'failed';
    error?: string;
  }): Promise<{
    step_status: VexPlanStepStatus;
    plan_status: VexPlanStatus;
  } | null> {
    const loaded = await this.loadPlan(input.conversationId, input.planId);
    if (!loaded) return null;
    const hash =
      input.tool !== undefined
        ? this.stepHash(input.tool, input.args ?? {})
        : null;
    const target = loaded.plan.steps.find((step) =>
      input.stepId !== undefined
        ? step.step_id === input.stepId
        : step.status === 'pending' &&
          step.tool === input.tool &&
          this.stepHash(step.tool, step.arguments) === hash,
    );
    if (!target) return null;
    const steps = loaded.plan.steps.map((step) =>
      step === target
        ? {
            ...step,
            status: input.outcome,
            ...(input.outcome === 'failed' && input.error
              ? { error: input.error.slice(0, 500) }
              : {}),
          }
        : step,
    );
    const allTerminal = steps.every((step) =>
      TERMINAL_STEP_STATUSES.includes(step.status),
    );
    const status: VexPlanStatus = allTerminal
      ? steps.some((step) => step.status === 'failed')
        ? 'partially_applied'
        : 'applied'
      : loaded.plan.status;
    await this.savePlan(input.conversationId, loaded, {
      ...loaded.plan,
      status,
      steps,
    });
    const saved = steps.find((step) => step.step_id === target.step_id)!;
    return { step_status: saved.status, plan_status: status };
  }

  /** Estado persistido del plan, o `null` si ningún mensaje lo propuso. */
  async getPlan(
    conversationId: number,
    planId: string,
  ): Promise<VexPlanRecord | null> {
    return (await this.loadPlan(conversationId, planId))?.plan ?? null;
  }

  private async resolveOpenStep(input: {
    planId: string;
    stepId: string;
    conversationId: number;
    userId: number | undefined;
  }): Promise<VexPlanStepRecord> {
    await this.assertConversationOwner(input.conversationId, input.userId);
    const loaded = await this.loadPlan(input.conversationId, input.planId);
    if (!loaded) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Ese plan ya no está activo en esta conversación.',
      );
    }
    if (loaded.plan.status !== 'approved') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'El plan no está aprobado: aprueba el plan antes de aplicar o confirmar sus pasos.',
        { reason: 'plan_not_approved', plan_status: loaded.plan.status },
      );
    }
    const step = loaded.plan.steps.find((s) => s.step_id === input.stepId);
    if (!step) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Ese paso no existe en el plan.',
      );
    }
    if (step.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Ese paso ya se resolvió.',
        { reason: 'step_not_pending', step_status: step.status },
      );
    }
    return step;
  }

  /**
   * Plan persistido más reciente con ese `plan_id` en la conversación. Lee
   * mensajes antiguos sin `status` de plan ni de paso (→ `proposed` /
   * `pending`), de modo que recargar un hilo viejo sigue funcionando.
   */
  private async loadPlan(
    conversationId: number,
    planId: string,
  ): Promise<LoadedPlan | null> {
    const messages = await this.prisma.ai_messages.findMany({
      where: { conversation_id: conversationId, role: 'assistant' },
      orderBy: { id: 'desc' },
      take: 100,
      select: { id: true, metadata: true },
    });
    for (const message of messages) {
      const metadata =
        message.metadata &&
        typeof message.metadata === 'object' &&
        !Array.isArray(message.metadata)
          ? { ...(message.metadata as Record<string, any>) }
          : null;
      const raw = metadata?.plan;
      if (!raw || raw.plan_id !== planId || !Array.isArray(raw.steps)) continue;
      return {
        message_id: message.id,
        metadata: metadata!,
        plan: {
          plan_id: planId,
          status: this.normalizePlanStatus(raw.status),
          steps: raw.steps.map((step: Record<string, any>, index: number) => ({
            ...step,
            step_id:
              typeof step.step_id === 'string' ? step.step_id : `s${index + 1}`,
            order: typeof step.order === 'number' ? step.order : index + 1,
            arguments: step.arguments ?? step.args ?? {},
            irreversible: step.irreversible === true,
            status: this.normalizeStepStatus(step.status),
          })) as VexPlanStepRecord[],
        },
      };
    }
    return null;
  }

  private async savePlan(
    conversationId: number,
    loaded: LoadedPlan,
    plan: VexPlanRecord,
  ): Promise<void> {
    // `updateMany` y no `update`: `ai_messages` es relational-scoped y la
    // extensión funde `conversation: {...}` en el `where`, lo que rompe el
    // `WhereUniqueInput` de `update`.
    await this.prisma.ai_messages.updateMany({
      where: { id: loaded.message_id, conversation_id: conversationId },
      data: { metadata: { ...loaded.metadata, plan } as any },
    });
  }

  private normalizePlanStatus(raw: unknown): VexPlanStatus {
    return raw === 'approved' ||
      raw === 'rejected' ||
      raw === 'applied' ||
      raw === 'partially_applied'
      ? raw
      : 'proposed';
  }

  private normalizeStepStatus(raw: unknown): VexPlanStepStatus {
    return raw === 'applied' || raw === 'failed' || raw === 'cancelled'
      ? raw
      : 'pending';
  }

  /**
   * Splits the approved steps into those the plan token covers and those that
   * always need their own confirmation. Called at approve time so the plan
   * card can label each step honestly before the person clicks.
   */
  classifySteps(steps: PlanApprovalStep[]): ClassifiedPlanSteps {
    const covered: PlanApprovalStep[] = [];
    const reconfirm: PlanApprovalStep[] = [];
    for (const step of steps) {
      if (this.isIrreversibleStep(step.tool, step.args)) {
        reconfirm.push(step);
      } else {
        covered.push(step);
      }
    }
    return { covered, reconfirm };
  }

  /**
   * Mints the single-use plan token. Every step — including the irreversible
   * ones — is part of the fingerprint, so adding, dropping or reordering a
   * step after approval invalidates the whole token instead of silently
   * narrowing it. The approved list itself is stored server-side in the same
   * hash, so the apply path never trusts a client re-declaration of it.
   */
  async issuePlanToken(
    planId: string,
    userId: number | undefined,
    steps: PlanApprovalStep[],
  ): Promise<string> {
    const ordered = [...steps].sort((a, b) => a.order - b.order);
    const hashes = ordered.map((s) => this.stepHash(s.tool, s.args));
    const token = randomUUID();
    const fields: Record<string, string> = {
      fp: this.planFingerprint(planId, userId, hashes),
      steps: JSON.stringify(
        ordered.map((s) => ({ order: s.order, tool: s.tool, args: s.args })),
      ),
    };
    for (let i = 0; i < ordered.length; i++) {
      const step = ordered[i];
      fields[`s:${hashes[i]}`] = this.isIrreversibleStep(step.tool, step.args)
        ? 'I'
        : '0';
    }
    await this.redis.hset(this.key(token), fields);
    await this.redis.expire(this.key(token), PLAN_TOKEN_TTL_SECONDS);
    return token;
  }

  /**
   * Consumes one step of an approved plan. Returns whether the step may run;
   * only `ok` authorizes execution, and each step returns `ok` at most once.
   *
   * The fingerprint is recomputed from the SERVER-stored step list, then the
   * Lua script re-verifies it and consumes the step atomically — the read and
   * the consume are two round trips, but nothing between them is attacker
   * controlled (stored steps, server context), and the consume itself is one
   * script, so a double-clicked approval still applies each step once.
   */
  async redeemPlanStep(
    token: string,
    planId: string,
    userId: number | undefined,
    tool: string,
    args: Record<string, any>,
  ): Promise<PlanRedeemOutcome> {
    const stored = await this.redis.hgetall(this.key(token));
    if (!stored || !stored.fp || !stored.steps) return 'missing';
    let steps: PlanApprovalStep[];
    try {
      const parsed: unknown = JSON.parse(stored.steps);
      if (!Array.isArray(parsed)) return 'mismatch';
      steps = parsed as PlanApprovalStep[];
    } catch {
      return 'mismatch';
    }
    const ordered = [...steps].sort((a, b) => a.order - b.order);
    const hashes = ordered.map((s) => this.stepHash(s.tool, s.args));
    const result = (await this.redis.eval(
      REDEEM_STEP_SCRIPT,
      1,
      this.key(token),
      this.planFingerprint(planId, userId, hashes),
      `s:${this.stepHash(tool, args)}`,
    )) as number;

    if (result === 1) return 'ok';
    if (result === -1) {
      this.logger.warn(
        `Plan token replayed for a different user/plan/step-list (plan "${planId}")`,
      );
      return 'mismatch';
    }
    if (result === -2) {
      this.logger.warn(
        `Plan token replayed against altered arguments for tool "${tool}" (plan "${planId}")`,
      );
      return 'unknown_step';
    }
    if (result === -3) return 'irreversible';
    if (result === -4) {
      this.logger.warn(
        `Plan step "${tool}" replayed after running once (plan "${planId}")`,
      );
      return 'replayed';
    }
    return 'missing';
  }

  private key(token: string): string {
    return `vex:plan:${token}`;
  }

  private stepHash(tool: string, args: Record<string, any>): string {
    return createHash('sha256')
      .update(`${tool}|${canonicalJson(args ?? {})}`)
      .digest('hex');
  }

  private planFingerprint(
    planId: string,
    userId: number | undefined,
    orderedHashes: string[],
  ): string {
    return createHash('sha256')
      .update(`${userId ?? 'anon'}|${planId}|${orderedHashes.join(',')}`)
      .digest('hex');
  }

  /**
   * Whether a step always re-confirms on its own card.
   *
   * Three sources, in order: the explicit `irreversible` mark on the tool
   * (typed tools), the tool's domain landing on an irreversible segment, and —
   * for `write_endpoint`, which has no domain of its own — the path segments
   * and verb of the call it carries. Unknown tools fail closed: forcing the
   * per-step path surfaces the real "tool does not exist" error instead of
   * smuggling an unrecognized write through a bundle approval.
   */
  private isIrreversibleStep(
    toolName: string,
    args: Record<string, any>,
  ): boolean {
    const tool = this.toolRegistry.get(toolName) as
      | { domain?: string; irreversible?: boolean }
      | undefined;
    if (!tool) return true;
    if (tool.irreversible === true) return true;
    if (tool.domain && IRREVERSIBLE_DOMAIN_SEGMENTS.has(tool.domain)) {
      return true;
    }
    if (toolName === 'write_endpoint') {
      const segments = String(args?.path ?? '')
        .split('/')
        .filter(Boolean);
      if (segments.some((s) => IRREVERSIBLE_DOMAIN_SEGMENTS.has(s))) {
        return true;
      }
      if (String(args?.method ?? '').toUpperCase() === 'DELETE') return true;
    }
    return false;
  }
}

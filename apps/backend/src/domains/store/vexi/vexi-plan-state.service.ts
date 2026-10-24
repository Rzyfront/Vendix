import { maximumRecoveryReplans } from '../../../ai-engine/tasks/agent-recovery-limits';
import { USER_NOTICES } from '../../../ai-engine/agent-execution.contract';
import {
  AgentVerifierService,
  AgentVerificationOptions,
} from '../../../ai-engine/tasks/agent-verifier.service';
import { AgentDurableSession } from '../../../ai-engine/tasks/agent-durable-session.service';
import {
  AgentDeadline,
  agentDeadlineContext,
} from '../../../ai-engine/tasks/agent-deadline';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AgentObjectiveRepository,
  requireObjectiveScope,
  objectiveOperationId,
} from '../../../ai-engine/tasks/agent-objective.repository';
import type {
  AgentObjective,
  ObjectiveLease,
} from '../../../ai-engine/tasks/interfaces/agent-objective.interface';

import { createHash, randomUUID } from 'crypto';
import { RequestContextService } from '../../../common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { canonicalJson } from './vexi-confirmation.service';
import {
  AgentPlan,
  AgentPlanDeliverable,
  AgentPlanHook,
  AgentPlanStep,
  AgentPlanStepStatus,
  AgentPlanStatus,
  AgentPlanToolName,
  AgentPlanToolOutcome,
} from '../../../ai-engine/interfaces/agent-plan.interface';
import {
  normalizeToolException,
  normalizeToolResult,
  toolReceipt,
} from '../../../ai-engine/tools/tool-result.normalizer';
import type { ToolExecutionResult } from '../../../ai-engine/tools/interfaces/tool.interface';
import { MAX_PLAN_STEPS } from '../../../ai-engine/tools/domains/planning.tools';
import {
  ArtifactAggregate,
  ArtifactPage,
  readArtifactPage,
} from '../../../ai-engine/context/tool-result-compaction';

/** Un plan sin movimiento en este lapso se da por abandonado. */
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

/** Mutable cursor shared by plan changes and result checkpoints in one turn. */
export interface DurablePlanSession {
  objective: AgentObjective;
  lease: ObjectiveLease;
  /** Automated plan_continue cannot mint a fresh budget by replacing its goal. */
  automaticContinuation?: boolean;
}

/**
 * Canonical hash of one approved-plan step: `sha256(tool|canonicalJson(args))`.
 *
 * Same shape `PlanApprovalService` redeems against, so the hashes persisted
 * next to the plan and the hashes inside the plan token are computed by one
 * rule: if the model alters arguments after approval, the hash stops matching
 * and the step re-confirms on its own card.
 */
export function canonicalStepHash(
  tool: string,
  args: Record<string, any>,
): string {
  return createHash('sha256')
    .update(`${tool}|${canonicalJson(args ?? {})}`)
    .digest('hex');
}

export interface PlanStepHash {
  order: number;
  tool: string;
  args_hash: string;
}

export interface PlanStepHashRecord {
  /** Plan al que pertenecen los hashes; `null` en registros antiguos. */
  plan_id: string | null;
  /** ISO; `null` en registros antiguos (sin expiración comprobable). */
  created_at: string | null;
  steps: PlanStepHash[];
}

const DONE_LIKE: AgentPlanStepStatus[] = ['done', 'skipped', 'rejected'];

function reject(error: string): AgentPlanToolOutcome {
  return { result: JSON.stringify({ ok: false, error }) };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function summarize(plan: AgentPlan) {
  const open = (s: AgentPlanStepStatus) =>
    plan.steps
      .filter((x) => x.status === s)
      .map((x) => ({ order: x.order, title: x.title, kind: x.kind }));
  return {
    plan_status: plan.status,
    in_progress: open('in_progress'),
    pending: open('pending'),
    waiting_user: plan.steps
      .filter((x) => x.status === 'waiting_user')
      .map((x) => ({ order: x.order, title: x.title, question: x.question })),
    unverified_deliverables: plan.deliverables
      .filter((d) => !d.verified)
      .map((d) => ({ id: d.id, description: d.description })),
  };
}

function ok(plan: AgentPlan, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ok: true, ...extra, estado: summarize(plan) });
}

/**
 * Bloque de texto para inyectar como mensaje system en cada turno. Es la guía
 * interna del agente: nunca se muestra a la persona.
 */
export function renderPlanForModel(plan: AgentPlan): string {
  const lines: string[] = [];
  lines.push(`LISTA INTERNA DE TAREAS (${plan.status})`);
  lines.push(`Objetivo: ${plan.goal}`);
  lines.push('Entregables:');
  for (const d of plan.deliverables) {
    lines.push(
      `- ${d.id}: ${d.description} — ${d.verified ? `✓${d.evidence ? ` (${d.evidence})` : ''}` : 'pendiente'}`,
    );
  }
  lines.push('Pasos:');
  for (const s of plan.steps) {
    const extra = s.evidence ? ` [evidencia: ${s.evidence}]` : '';
    lines.push(
      `${s.order}. [${s.status}] (${s.kind}) ${s.title} — listo cuando: ${s.done_when}${extra}`,
    );
  }
  const waiting = plan.steps.find(
    (s) => s.status === 'waiting_user' && s.question,
  );
  if (waiting) {
    lines.push(`Pregunta pendiente a la persona: ${waiting.question}`);
  }
  lines.push(
    'Esto es tu guía interna; nunca la menciones a la persona (ni plan, ni pasos, ni tareas, ni entregables). Encadena lecturas y verificaciones sin detenerte; detente solo ante una escritura o con ask_user.',
  );
  return lines.join('\n');
}

/**
 * Estado del task list interno en el repositorio de objetivos durables.
 * La metadata histórica se importa una sola vez y nunca vuelve a ser autoridad.
 */
@Injectable()
export class VexiPlanStateService {
  private readonly durableStates = new WeakMap<
    object,
    { objective: AgentObjective; session?: DurablePlanSession }
  >();

  constructor(
    private readonly prisma: StorePrismaService,
    @Optional() private readonly objectives?: AgentObjectiveRepository,
    @Optional() private readonly verifier?: AgentVerifierService,
  ) {}

  private durableRepository(): AgentObjectiveRepository {
    if (!this.objectives)
      throw new ConflictException(
        'El almacenamiento durable no está disponible. El objetivo permanece pausado.',
      );
    return this.objectives;
  }

  private objectiveApiRepository(): AgentObjectiveRepository {
    if (!this.objectives) throw new NotFoundException('Objective not found');
    return this.objectives;
  }

  private progress(objective: AgentObjective) {
    return {
      id: objective.id,
      conversation_id: objective.conversation_id,
      goal: objective.goal,
      semantic_status:
        objective.expires_at.getTime() <= Date.now()
          ? 'expired'
          : objective.semantic_status,
      version: objective.version,
      expires_at: objective.expires_at.toISOString(),
      next_step: objective.next_step,
      budget: objective.budget,
      requires_revalidation: objective.requires_revalidation,
    };
  }

  async getObjectiveProgress(id: string) {
    return this.progress(await this.objectiveApiRepository().get(id));
  }

  async resumeObjective(
    id: string,
    options: { expected_version: number; allow_expired: boolean },
  ) {
    return this.progress(
      await this.objectiveApiRepository().resume(id, options),
    );
  }

  async rejectObjectiveProposal(id: string, expectedVersion: number) {
    return this.progress(
      await this.objectiveApiRepository().rejectProposal(id, expectedVersion),
    );
  }

  /** Explicit rejection intent from an already authenticated conversation turn. */
  async rejectPendingObjective(conversationId: number) {
    const repository = this.durableRepository();
    const objective = await repository.importLegacy(conversationId);
    if (!objective || objective.semantic_status !== 'awaiting_approval')
      return null;
    return this.progress(
      await repository.rejectProposal(objective.id, objective.version),
    );
  }

  async listObjectiveResults(
    id: string,
    query: { cursor?: string; limit?: number },
  ) {
    const page = await this.objectiveApiRepository().listResults(id, query);
    return {
      ...page,
      items: page.items.map(({ data: _data, ...result }) => result),
    };
  }

  async getObjectiveArtifact(
    id: string,
    resultId: string,
    query: {
      offset?: number;
      limit?: number;
      artifact_cursor?: string;
      text_offset?: number;
      text_limit?: number;
      columns?: string[];
      aggregate_field?: string;
      aggregate_function?: ArtifactAggregate['function'];
    },
  ) {
    const result = await this.objectiveApiRepository().getResult(id, resultId);
    {
      // getResult enforces explicit ALS store/org/user+objective ownership BEFORE paging.
      // Historical snapshots never become fresh write evidence through this reader.
      const { data: value, ...metadata } = result;
      const aggregate =
        query.aggregate_field && query.aggregate_function
          ? { field: query.aggregate_field, function: query.aggregate_function }
          : undefined;
      if (!!query.aggregate_field !== !!query.aggregate_function)
        throw new BadRequestException(
          'Both aggregate_field and aggregate_function are required',
        );
      const envelope = (page: ArtifactPage) => ({
        ...metadata,
        ...page,
        data: page.data ?? null,
        source_freshness: result.freshness,
        freshness: page.complete ? result.freshness : 'truncated',
        observed_at: result.created_at,
        artifact_pagination: {
          offset: page.offset,
          limit: page.returned,
          total: page.total,
          has_more: page.has_more,
          complete: page.complete,
          next_offset: page.next_offset,
          cursor: page.cursor,
        },
        next_query: page.cursor
          ? {
              artifact_cursor: page.cursor,
              ...(query.columns ? { columns: query.columns } : {}),
            }
          : null,
      });
      try {
        return envelope(
          readArtifactPage(value, {
            ...query,
            cursor: query.artifact_cursor,
            aggregate,
            // Leave room for ResponseService's outer API envelope and bridge fields.
            max_json_chars: 4200,
            envelope,
          }),
        );
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
    }
  }

  async get(conversationId: number): Promise<AgentPlan | null> {
    const { plan } = await this.load(conversationId);
    return plan;
  }

  async getActive(conversationId: number): Promise<AgentPlan | null> {
    const plan = await this.get(conversationId);
    return plan && plan.status === 'active' ? plan : null;
  }

  async setStatus(
    conversationId: number,
    status: AgentPlanStatus,
  ): Promise<AgentPlan | null> {
    const { plan, metadata } = await this.load(conversationId);
    if (!plan) return null;
    plan.status = status;
    await this.save(conversationId, metadata, plan);
    return plan;
  }

  async markCurrentChangeStep(
    conversationId: number,
    status: 'done' | 'rejected',
    evidence?: string,
  ): Promise<AgentPlan | null> {
    const { plan, metadata } = await this.load(conversationId);
    if (!plan) return null;
    const step =
      plan.steps.find(
        (s) => s.kind === 'cambio' && s.status === 'in_progress',
      ) ??
      plan.steps.find((s) => s.kind === 'cambio' && s.status === 'pending');
    if (!step) return plan;
    step.status = status;
    if (evidence) step.evidence = evidence;
    delete step.question;
    await this.save(conversationId, metadata, plan);
    return plan;
  }

  /**
   * Ordered `(tool, args)` hashes of the plan's write steps, persisted next to
   * the plan in `metadata.agent_plan_step_hashes`.
   *
   * Lives OUTSIDE `agent_plan` on purpose: the plan shape is the agent loop's
   * cognitive scaffolding (shared with Vexi), while the hashes are the
   * approval binding (Vex). The apply path compares these against the plan
   * token's server-stored list — a mismatch means the model moved the goalposts
   * after approval and the step re-confirms alone.
   */
  async getStepHashes(conversationId: number): Promise<PlanStepHash[]> {
    return (await this.getStepHashRecord(conversationId)).steps;
  }

  /** G voice can approve only the one diff actually shown in this owned thread. */
  async assertVoiceProposalPreview(
    conversationId: number,
    planId: string,
    tool: string,
    args: Record<string, unknown>,
    previewHash: string,
  ): Promise<{ stepId: string }> {
    await this.load(conversationId);
    const message = await this.prisma.ai_messages.findFirst({
      where: {
        conversation_id: conversationId,
        role: 'assistant',
        metadata: { path: ['plan', 'plan_id'], equals: planId },
      },
      orderBy: { created_at: 'desc' },
      select: { metadata: true },
    });
    const plan = (
      message?.metadata as {
        plan?: {
          status?: string;
          steps?: Array<{
            step_id?: string;
            status?: string;
            tool: string;
            arguments: Record<string, unknown>;
            preview?: unknown;
          }>;
        };
      } | null
    )?.plan;
    const step = plan?.steps?.length === 1 ? plan.steps[0] : undefined;
    if (
      !step ||
      !step.step_id ||
      step.status !== 'pending' ||
      !['proposed', 'approved'].includes(plan?.status ?? '') ||
      step.tool !== tool ||
      canonicalStepHash(tool, step.arguments) !==
        canonicalStepHash(tool, args) ||
      createHash('sha256').update(canonicalJson(step.preview)).digest('hex') !==
        previewHash
    )
      throw new ConflictException(
        'La propuesta visible cambió o no está pendiente. Revisa una nueva propuesta.',
      );
    return { stepId: step.step_id };
  }

  /** Realtime creates the same single-step Vex proposal identity as text. */
  async persistVoiceWriteProposal(
    conversationId: number,
    tool: string,
    args: Record<string, unknown>,
    preview: unknown,
  ): Promise<{ planId: string; stepId: string }> {
    await this.load(conversationId);
    const planId = randomUUID();
    const stepId = 's1';
    await this.setStepHashes(
      conversationId,
      [{ order: 1, tool, args }],
      planId,
    );
    await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'assistant',
        content:
          'Cambio propuesto por voz. Espera tu aprobación; todavía no se aplicó.',
        metadata: {
          plan: {
            plan_id: planId,
            status: 'proposed',
            steps: [
              {
                step_id: stepId,
                order: 1,
                tool,
                arguments: args,
                preview,
                status: 'pending',
              },
            ],
          },
        } as any,
      },
    });
    return { planId, stepId };
  }

  /**
   * Registro completo de hashes: `{plan_id, created_at, steps}`. Lee también
   * la forma antigua (arreglo plano sin identidad): `plan_id`/`created_at`
   * llegan `null`, de modo que approve la trata como no vinculada a ningún
   * plan y la rechaza — nunca como "cualquier plan".
   */
  async getStepHashRecord(conversationId: number): Promise<PlanStepHashRecord> {
    // Sin gate de `agent_plan` a propósito: el plan interno de tareas y el
    // plan de escritura de Vex son sistemas distintos — un turno Vex propone
    // escrituras sin lista interna (el loop ni siquiera recibe `params.plan`)
    // y sus hashes deben leerse igual. Hallazgo live E2E-1 (2026-10-01).
    const { metadata } = await this.load(conversationId);
    const state = this.durableStates.get(metadata);
    const raw = state?.objective.step_hashes ?? null;
    const list: unknown = Array.isArray(raw) ? raw : raw?.steps;
    const steps = Array.isArray(list)
      ? list.filter(
          (h): h is PlanStepHash =>
            !!h &&
            typeof h.order === 'number' &&
            typeof h.tool === 'string' &&
            typeof h.args_hash === 'string',
        )
      : [];
    return {
      plan_id:
        !Array.isArray(raw) && typeof raw?.plan_id === 'string'
          ? raw.plan_id
          : null,
      created_at:
        !Array.isArray(raw) && typeof raw?.created_at === 'string'
          ? raw.created_at
          : null,
      steps,
    };
  }

  async setStepHashes(
    conversationId: number,
    steps: Array<{ order: number; tool: string; args: Record<string, any> }>,
    planId?: string,
    session?: DurablePlanSession,
  ): Promise<PlanStepHash[]> {
    // Sin gate de `agent_plan`: ver `getStepHashRecord`.
    const { metadata } = await this.load(conversationId, session);
    const hashes: PlanStepHash[] = [...steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        order: s.order,
        tool: s.tool,
        args_hash: canonicalStepHash(s.tool, s.args),
      }));
    const record: PlanStepHashRecord = {
      plan_id: planId ?? null,
      created_at: new Date().toISOString(),
      steps: hashes,
    };
    let state = this.durableStates.get(metadata);
    if (!state) {
      const objective = await this.durableRepository().createOrReplace(
        conversationId,
        null,
        undefined,
        { goal: 'Aplicar la propuesta seleccionada' },
      );
      state = { objective };
    }
    if (state) {
      const saved = await this.durableRepository().updateHashes(
        state.objective.id,
        session?.lease.version ?? state.objective.version,
        record as unknown as Record<string, unknown>,
        session?.lease,
      );
      if (session) {
        session.objective = saved;
        Object.assign(session.lease, {
          version: saved.version,
          lease_generation: saved.lease_generation,
        });
      }
    }
    return hashes;
  }

  /** Borra los hashes (rechazo del plan): un plan cancelado deja de ser aprobable. */
  async clearStepHashes(conversationId: number): Promise<void> {
    const { metadata } = await this.load(conversationId);
    const state = this.durableStates.get(metadata);
    if (state) {
      await this.durableRepository().updateHashes(
        state.objective.id,
        state.objective.version,
        null,
      );
      return;
    }
  }

  /** Intent is durable BEFORE dispatch. A consumed confirmation is not an exactly-once guarantee. */
  async applyDurableEffect(
    input: {
      conversationId?: number;
      stepId?: string;
      tool: string;
      args: Record<string, any>;
      consent?: {
        channel: 'voice';
        challenge_hash: string;
        proposal_hash: string;
      };
    },
    dispatch: () => Promise<string>,
  ): Promise<{ output: string; result?: ToolExecutionResult }> {
    if (!input.conversationId)
      throw new ConflictException(
        'Selecciona la conversación del objetivo antes de aplicar el cambio.',
      );
    const repository = this.durableRepository();
    let objective = await repository.importLegacy(input.conversationId);
    if (!objective)
      objective = await repository.createOrReplace(
        input.conversationId,
        null,
        undefined,
        { goal: `Aplicar ${input.tool}` },
      );
    const leased = await repository.acquireLease(
      objective.id,
      objective.version,
    );
    const lease: ObjectiveLease = {
      version: leased.version,
      lease_generation: leased.lease_generation,
    };
    const consentAudit =
      input.consent &&
      /^[a-f0-9]{64}$/.test(input.consent.challenge_hash) &&
      /^[a-f0-9]{64}$/.test(input.consent.proposal_hash)
        ? {
            consent: {
              ...input.consent,
              observed_at: new Date().toISOString(),
            },
          }
        : {};
    const effectStarted = Date.now();
    const effectDeadline = new AgentDeadline({
      wallDeadlineMs: Math.min(
        Date.now() + 180_000,
        new Date(leased.expires_at).getTime(),
        new Date(leased.lease_until!).getTime(),
      ),
      activeBudgetMs: Math.max(0, 1_800_000 - leased.budget.active_runtime_ms),
      reserveMs: 2000,
    });
    const proposalHash = canonicalStepHash(input.tool, input.args);
    const currentStep = leased.plan?.steps.find(
      (step) =>
        step.kind === 'cambio' &&
        ['pending', 'in_progress', 'waiting_user'].includes(step.status),
    );
    const stepId =
      input.stepId ??
      (currentStep
        ? `plan:${leased.plan!.id}:${currentStep.order}`
        : `write:${proposalHash}`);
    const operationId = objectiveOperationId(leased.id, stepId, proposalHash);
    let applying = false;
    const checkpoint = async (result: ToolExecutionResult) => {
      const { objective: saved, advanced } = await repository.appendToolResult(
        leased.id,
        lease,
        {
          tool_call_id: `effect:${operationId}`,
          tool_name: input.tool,
          args_hash: proposalHash,
          receipt: toolReceipt(result),
          data: result.data,
          budget_delta: {
            tools: 1,
            ...(effectDeadline
              ? { active_runtime_ms: Math.max(0, Date.now() - effectStarted) }
              : {}),
          },
          checkpoint: {
            semantic_status:
              result.status === 'unknown_effect'
                ? 'unknown_effect'
                : result.status === 'blocked'
                  ? 'blocked'
                  : result.status === 'pending_confirmation'
                    ? 'awaiting_approval'
                    : result.status === 'needs_user_input'
                      ? 'awaiting_input'
                      : 'active',
            next_step: result.next_action,
            requires_revalidation: true,
          },
        },
      );
      if (!advanced)
        throw new ConflictException(
          'El resultado quedó en auditoría; el ejecutor ya fue reemplazado.',
        );
      Object.assign(lease, {
        version: saved.version,
        lease_generation: saved.lease_generation,
      });
    };
    try {
      effectDeadline?.assertCanStart();
      let effect = await repository.proposeEffect(
        leased.id,
        {
          operation_id: operationId,
          proposal_hash: proposalHash,
          step_id: stepId,
        },
        lease,
      );
      // Even a new token cannot replay an operation whose dispatch may have committed.
      if (!['proposed', 'approved'].includes(effect.status))
        throw new ConflictException(
          'Este cambio ya fue enviado o su efecto es incierto. Verifica el registro antes de continuar.',
        );
      if (effect.status === 'proposed')
        effect = await repository.transitionEffect(
          leased.id,
          operationId,
          'proposed',
          'approved',
          { domain_receipt: consentAudit },
          lease,
        );
      await repository.transitionEffect(
        leased.id,
        operationId,
        'approved',
        'applying',
        { domain_receipt: consentAudit },
        lease,
      );
      applying = true;
      let output: string;
      let result: ToolExecutionResult;
      try {
        output = effectDeadline
          ? await agentDeadlineContext.run(effectDeadline, () =>
              effectDeadline.run(dispatch),
            )
          : await dispatch();
        result = normalizeToolResult(output, {
          write: true,
          handlerStarted: true,
        });
      } catch (error) {
        result = normalizeToolException(error, {
          write: true,
          handlerStarted: true,
        });
        await repository.transitionEffect(
          leased.id,
          operationId,
          'applying',
          result.status === 'unknown_effect' ? 'unknown' : 'failed',
          {
            domain_receipt: {
              ...consentAudit,
              status: result.status,
              error_code: result.error_code,
            },
          },
          lease,
        );
        applying = false;
        await checkpoint(result);
        if (result.status !== 'unknown_effect') throw error;
        return { output: JSON.stringify(result), result };
      }
      const status =
        result.effect_status === 'applied' && result.status === 'ok'
          ? 'applied'
          : result.effect_status === 'not_applied'
            ? 'failed'
            : 'unknown';
      await repository.transitionEffect(
        leased.id,
        operationId,
        'applying',
        status,
        {
          domain_receipt: {
            ...consentAudit,
            status: result.status,
            error_code: result.error_code,
            resource_ids: result.resource_ids,
          },
          domain_reference: Object.values(result.resource_ids)[0]?.toString(),
        },
        lease,
      );
      applying = false;
      await checkpoint(result);
      return { output, result };
    } finally {
      // A crash before this boundary leaves applying durable; that state blocks replay.
      // Never turn an unresolved applying receipt into a success or blindly redispatch it.
      if (applying) {
        try {
          await repository.transitionEffect(
            leased.id,
            operationId,
            'applying',
            'unknown',
            {},
            lease,
          );
        } catch {
          /* durable applying also blocks replay */
        }
      }
      effectDeadline?.dispose();
      await repository.releaseLease(leased.id, lease).catch(() => false);
    }
  }

  createHook(
    conversationId: number,
    sharedSession?: DurablePlanSession,
  ): AgentPlanHook {
    let session = sharedSession;
    let released = false;
    const prepare = async () => {
      if (released) throw new ConflictException('Este ejecutor ya terminó.');
      if (session) return;
      const objective =
        await this.durableRepository().importLegacy(conversationId);
      if (objective) {
        const leased = await this.durableRepository().acquireLease(
          objective.id,
          objective.version,
        );
        session = {
          objective: leased,
          lease: {
            version: leased.version,
            lease_generation: leased.lease_generation,
          },
        };
      }
    };
    return {
      get objectiveId() {
        return session?.objective.id;
      },
      execute: async (name, args, options) => {
        await prepare();
        return this.execute(conversationId, name, args ?? {}, session, options);
      },
      snapshot: async () => {
        await prepare();
        const { plan } = await this.load(conversationId, session);
        return plan?.status === 'active' ? plan : null;
      },
      release: async () => {
        released = true;
        if (!sharedSession && session)
          await this.durableRepository().releaseLease(
            session.objective.id,
            session.lease,
          );
      },
    };
  }

  // ── ejecución de tools ────────────────────────────────────────────────

  private async execute(
    conversationId: number,
    name: AgentPlanToolName,
    args: Record<string, any>,
    session?: DurablePlanSession,
    options?: AgentVerificationOptions,
  ): Promise<AgentPlanToolOutcome> {
    const { plan: current, metadata } = await this.load(
      conversationId,
      session,
    );

    if (name === 'propose_plan') {
      return this.propose(conversationId, metadata, current, args);
    }
    if (name === 'resume_plan') {
      if (
        !current ||
        (current.status !== 'paused' && current.status !== 'active')
      ) {
        return reject('no hay plan activo');
      }
      current.status = 'active';
      await this.save(conversationId, metadata, current);
      return { result: ok(current) };
    }

    if (!current || current.status !== 'active') {
      return reject('no hay plan activo');
    }
    const plan = current;
    const robust = !!session;
    if (robust && name === 'verify_deliverables') {
      if (
        !this.verifier ||
        !options ||
        !(session instanceof AgentDurableSession)
      )
        return reject(
          'unsupported_capability: verificación de servidor no disponible en esta superficie',
        );
      if (
        !plan.deliverables.every((d) => d.verification) ||
        !plan.steps.every((step) => step.status === 'done')
      )
        return reject(
          'Faltan postcondiciones de servidor o pasos pendientes. Un texto o verified:true no verifica el objetivo.',
        );
      const supplied = Array.isArray(args.deliverables)
        ? args.deliverables
        : [];
      if (
        supplied.length !== plan.deliverables.length ||
        new Set(supplied.map((item) => item?.id)).size !== supplied.length ||
        supplied.some(
          (item) => !plan.deliverables.some((d) => d.id === item?.id),
        )
      )
        return reject(
          'Incluye referencias para todos los entregables del contrato fijo.',
        );
      const requests = plan.deliverables.map((d) => ({
        ...d.verification!,
        evidence_refs: supplied.find((item) => item?.id === d.id)
          ?.evidence_refs,
      }));
      const result = await this.verifier.verifyMany(session, requests, options);
      if (result.verified === false) {
        const detail = `Postcondiciones no satisfechas: ${result.reasons.join('; ')}`;
        if (
          result.reasons.some((reason) =>
            reason.startsWith('unsupported_capability:'),
          )
        ) {
          const next = `La operación ${requests.map((r) => r.workflow_key).join(', ')} no dispone de verificación completa: ${result.reasons.join('; ')}. Conservé lo aplicado; revisa ese resultado en su módulo antes de repetir cambios.`;
          session.objective =
            (await this.durableRepository().checkpoint(
              session.objective_id,
              session.lease,
              { semantic_status: 'partial', next_step: next },
            )) ?? session.objective;
          Object.assign(session.lease, {
            version: session.objective.version,
            lease_generation: session.objective.lease_generation,
          });
        }
        return reject(detail);
      }
      await session.completeVerified(result.capability);
      return {
        result: ok(session.objective.plan!, {
          evidence_refs: result.evidence_refs,
          completion_verified: true,
        }),
        endTurn: {
          // Evidence refs (`agent-result:<uuid>`) stay in the receipt; the
          // person reads the catalog line.
          text: USER_NOTICES.verified,
        },
      };
    }
    if (robust && name === 'revise_plan') {
      if (str(args.goal) && str(args.goal) !== plan.goal)
        return reject(
          'No puedo cambiar el objetivo económico durante una recuperación técnica. Inicia otro objetivo para un trabajo distinto.',
        );
      if (Array.isArray(args.add_deliverables) && args.add_deliverables.length)
        return reject(
          'Una recuperación técnica no puede ampliar el objetivo económico.',
        );
      if ((session!.objective.budget.recovery ?? 0) >= maximumRecoveryReplans())
        return reject(
          'Se agotaron las dos revisiones técnicas del objetivo; conserva lo ya aplicado.',
        );
    }
    if (robust && name === 'update_plan_step') {
      const step = this.findStep(plan, args.order);
      if (
        step &&
        ['in_progress', 'done'].includes(args.status) &&
        (step.depends_on ?? []).some(
          (order) =>
            plan.steps.find((s) => s.order === order)?.status !== 'done',
        )
      )
        return reject('Las dependencias del paso aún no tienen resultado.');
    }
    let outcome: AgentPlanToolOutcome;

    switch (name) {
      case 'update_plan_step':
        outcome = this.updateStep(plan, args);
        break;
      case 'verify_deliverables':
        outcome = this.verify(plan, args);
        break;
      case 'ask_user':
        outcome = this.ask(plan, args);
        break;
      case 'revise_plan':
        outcome = this.revise(plan, args);
        break;
      case 'pause_plan':
        plan.status = 'paused';
        outcome = { result: ok(plan, { reason: str(args.reason) }) };
        break;
      default:
        return reject(`herramienta desconocida: ${String(name)}`);
    }

    if (
      robust &&
      name === 'revise_plan' &&
      !outcome.result.startsWith('{"ok":false')
    ) {
      if (
        plan.steps.length < 3 ||
        plan.steps.length > 7 ||
        plan.steps.some((step) =>
          (step.depends_on ?? []).some(
            (order) => order >= step.order || order < 1,
          ),
        )
      )
        return reject(
          'El bloque ejecutable requiere entre 3 y 7 pasos con dependencias previas válidas.',
        );
      await (session as AgentDurableSession).addBudget({ recovery: 1 });
    }
    // Un rechazo no cambia estado: no se persiste.
    if (!outcome.result.startsWith('{"ok":false')) {
      await this.save(conversationId, metadata, plan);
    }
    return outcome;
  }

  private async propose(
    conversationId: number,
    metadata: Record<string, any>,
    previous: AgentPlan | null,
    args: Record<string, any>,
  ): Promise<AgentPlanToolOutcome> {
    const rawDel = Array.isArray(args.deliverables) ? args.deliverables : [];
    const rawSteps = Array.isArray(args.steps) ? args.steps : [];
    const descriptions = rawDel
      .map((d: any) => str(d?.description))
      .filter(Boolean);
    if (descriptions.length === 0) {
      return reject(
        'define al menos un entregable verificable (deliverables[].description)',
      );
    }
    if (rawSteps.length === 0) {
      return reject('define al menos un paso');
    }

    if (rawSteps.length < 3 || rawSteps.length > 7)
      return reject(
        'El bloque multietapa debe tener de 3 a 7 pasos. Una consulta simple no necesita plan, y un único cambio se propone directamente sin plan.',
      );
    if (previous && str(args.goal) !== previous.goal)
      return reject(
        'La recuperación no puede cambiar el objetivo económico. Inicia otra conversación para otro trabajo.',
      );
    if (
      rawDel.some(
        (d) =>
          !str(d?.description) ||
          !d?.verification ||
          typeof d.verification.workflow_key !== 'string' ||
          typeof d.verification.step_id !== 'string' ||
          !d.verification.inputs ||
          typeof d.verification.inputs !== 'object' ||
          Array.isArray(d.verification.inputs) ||
          Buffer.byteLength(JSON.stringify(d.verification.inputs)) > 64000,
      )
    )
      return reject(
        'unsupported_capability: cada entregable requiere verification con workflow_key (proceso del servidor), step_id e inputs explícitos. Si este trabajo no es un proceso del servidor con verificador, no uses propose_plan: haz las consultas y propón el cambio directamente.',
      );
    const steps: AgentPlanStep[] = [];
    for (const [i, raw] of rawSteps.slice(0, MAX_PLAN_STEPS).entries()) {
      const kind = raw?.kind === 'cambio' ? 'cambio' : 'verificacion';
      const doneWhen = str(raw?.done_when);
      if (kind === 'cambio' && !doneWhen) {
        return reject(
          `el paso ${i + 1} es un cambio y necesita done_when (criterio verificable)`,
        );
      }
      const missing = [
        !str(raw.expected_input) && 'expected_input',
        !str(raw.expected_output) && 'expected_output',
        (!Array.isArray(raw.candidate_tools) ||
          !raw.candidate_tools.length ||
          raw.candidate_tools.some((name) => typeof name !== 'string')) &&
          'candidate_tools (lista de nombres)',
        !str(raw.verifier) && 'verifier',
        (!Array.isArray(raw.depends_on) ||
          raw.depends_on.some(
            (order) => !Number.isSafeInteger(order) || order < 1 || order > i,
          )) &&
          `depends_on (pasos anteriores a ${i + 1}; [] si no depende de ninguno)`,
        raw.approval !== (kind === 'cambio' ? 'individual' : 'none') &&
          `approval "${kind === 'cambio' ? 'individual' : 'none'}"`,
      ].filter(Boolean);
      if (missing.length)
        return reject(
          `El paso ${i + 1} requiere entrada/salida, tools candidatas, aprobación individual, verifier y dependencias previas. Falta o es inválido: ${missing.join(', ')}.`,
        );
      steps.push({
        ...{
          depends_on: [...raw.depends_on],
          expected_input: str(raw.expected_input),
          expected_output: str(raw.expected_output),
          candidate_tools: [...raw.candidate_tools],
          approval: raw.approval,
          verifier: str(raw.verifier),
        },
        order: i + 1,
        title: str(raw?.title) || `Paso ${i + 1}`,
        kind,
        done_when: doneWhen,
        status: 'pending',
        attempts: 0,
      });
    }
    const now = new Date().toISOString();
    const plan: AgentPlan = {
      id: previous?.goal.trim() === str(args.goal) ? previous.id : randomUUID(),
      status: 'active',
      goal: str(args.goal),
      deliverables: descriptions.map((description: string, i: number) => ({
        id: `d${i + 1}`,
        description,
        verified: false,
        ...{ verification: structuredClone(rawDel[i].verification) },
      })),
      steps,
      created_at:
        previous?.goal.trim() === str(args.goal) ? previous.created_at : now,
      updated_at: now,
    };
    // Solo se guarda el último plan; el previo queda superseded solo en el
    // resultado (no se conserva).
    await this.save(conversationId, metadata, plan);
    return {
      result: ok(plan, {
        plan_declared: true,
        superseded_previous: previous?.status === 'active',
        dropped: Math.max(0, rawSteps.length - steps.length),
        next_step:
          'Encadena lecturas y verificaciones sin detenerte; detente solo ante una escritura (tarjeta) o con ask_user. NUNCA menciones plan, pasos, tareas ni entregables a la persona.',
      }),
    };
  }

  private findStep(plan: AgentPlan, order: unknown): AgentPlanStep | undefined {
    return plan.steps.find((s) => s.order === Number(order));
  }

  private updateStep(
    plan: AgentPlan,
    args: Record<string, any>,
  ): AgentPlanToolOutcome {
    const step = this.findStep(plan, args.order);
    if (!step) return reject(`el paso ${String(args.order)} no existe`);
    const status = args.status as AgentPlanStepStatus;
    if (!['in_progress', 'done', 'failed', 'skipped'].includes(status)) {
      return reject('status inválido: usa in_progress, done, failed o skipped');
    }
    const evidence = str(args.evidence);
    if (status === 'done' && step.kind === 'cambio' && !evidence) {
      return reject(
        'un paso de cambio solo se marca done con evidence: lee el sistema y cita el dato real',
      );
    }
    step.status = status;
    if (evidence) step.evidence = evidence;
    if (str(args.note)) step.note = str(args.note);
    delete step.question;
    let extra: Record<string, unknown> = {};
    if (status === 'failed') {
      step.attempts += 1;
    }
    plan.updated_at = new Date().toISOString();
    return { result: ok(plan, extra) };
  }

  private verify(
    plan: AgentPlan,
    args: Record<string, any>,
  ): AgentPlanToolOutcome {
    const items = Array.isArray(args.deliverables) ? args.deliverables : [];
    if (items.length === 0) return reject('indica los entregables a verificar');
    for (const it of items) {
      const d = plan.deliverables.find((x) => x.id === String(it?.id));
      if (!d) return reject(`el entregable ${String(it?.id)} no existe`);
      if (it?.verified === true && !str(it?.evidence)) {
        return reject(
          `el entregable ${d.id} solo se verifica con evidence: cita el dato real leído del sistema`,
        );
      }
    }
    for (const it of items) {
      const d = plan.deliverables.find(
        (x) => x.id === String(it.id),
      ) as AgentPlanDeliverable;
      d.verified = it.verified === true;
      if (str(it.evidence)) d.evidence = str(it.evidence);
    }
    plan.updated_at = new Date().toISOString();
    const stepsClosed = plan.steps.every((s) => DONE_LIKE.includes(s.status));
    if (stepsClosed && plan.deliverables.every((d) => d.verified)) {
      plan.status = 'done';
      return {
        result: ok(plan, {
          instruccion:
            'Todo está verificado. Redacta ahora la respuesta final en prosa natural con los datos reales (nombres, números, estados), sin mencionar plan, pasos, tareas ni entregables.',
        }),
      };
    }
    return { result: ok(plan) };
  }

  private ask(
    plan: AgentPlan,
    args: Record<string, any>,
  ): AgentPlanToolOutcome {
    const question = str(args.question);
    if (!question) return reject('escribe la pregunta para la persona');
    const step =
      (args.step_order != null
        ? this.findStep(plan, args.step_order)
        : undefined) ??
      plan.steps.find((s) => s.status === 'in_progress') ??
      plan.steps.find((s) => s.status === 'pending');
    if (step) {
      step.status = 'waiting_user';
      step.question = question;
    }
    plan.updated_at = new Date().toISOString();
    return { result: ok(plan, { asked: true }), endTurn: { text: question } };
  }

  private revise(
    plan: AgentPlan,
    args: Record<string, any>,
  ): AgentPlanToolOutcome {
    const removeOrders: number[] = Array.isArray(args.remove_orders)
      ? args.remove_orders.map(Number)
      : [];
    const updates: any[] = Array.isArray(args.update_steps)
      ? args.update_steps
      : [];
    const adds: any[] = Array.isArray(args.add_steps) ? args.add_steps : [];

    for (const o of [
      ...removeOrders,
      ...updates.map((u) => Number(u?.order)),
    ]) {
      const s = this.findStep(plan, o);
      if (!s) return reject(`el paso ${o} no existe`);
      if (s.status === 'done') {
        return reject(
          `el paso ${o} ya está hecho: no se modifica ni se elimina`,
        );
      }
    }

    const dependencies = new Map<AgentPlanStep, AgentPlanStep[]>();
    for (const step of plan.steps) {
      const refs = (step.depends_on ?? []).map((order) =>
        plan.steps.find((s) => s.order === order),
      );
      if (refs.some((ref) => !ref || removeOrders.includes(ref.order)))
        return reject(
          'No elimines una dependencia requerida; revisa el DAG completo.',
        );
      dependencies.set(step, refs as AgentPlanStep[]);
    }
    const newSteps: Array<{ raw: any; step: AgentPlanStep }> = [];
    for (const raw of adds) {
      const kind = raw?.kind === 'cambio' ? 'cambio' : 'verificacion';
      const doneWhen = str(raw?.done_when);
      if (kind === 'cambio' && !doneWhen) {
        return reject('todo paso de cambio nuevo necesita done_when');
      }
      newSteps.push({
        raw,
        step: {
          ...{
            depends_on: Array.isArray(raw.depends_on)
              ? [...raw.depends_on]
              : undefined,
            expected_input: str(raw.expected_input),
            expected_output: str(raw.expected_output),
            candidate_tools: Array.isArray(raw.candidate_tools)
              ? [...raw.candidate_tools]
              : undefined,
            approval: raw.approval,
            verifier: str(raw.verifier),
          },
          order: 0,
          title: str(raw?.title) || 'Paso',
          kind,
          done_when: doneWhen,
          status: 'pending',
          attempts: 0,
        },
      });
    }

    let steps = plan.steps.filter((s) => !removeOrders.includes(s.order));
    // Para insertar por after_order se usa el objeto de referencia (los
    // órdenes se renumeran al final).
    const byOriginal = new Map(plan.steps.map((s) => [s.order, s]));
    for (const u of updates) {
      const s = byOriginal.get(Number(u.order))!;
      if (str(u.title)) s.title = str(u.title);
      if (str(u.done_when)) s.done_when = str(u.done_when);
    }
    for (const { raw, step } of newSteps) {
      {
        if (
          !Array.isArray(raw.depends_on) ||
          raw.depends_on.some((order) => !byOriginal.has(order))
        )
          return reject('La dependencia nueva debe referir un paso existente.');
        dependencies.set(
          step,
          raw.depends_on.map((order) => byOriginal.get(order)!),
        );
      }
      const ref =
        raw?.after_order != null
          ? byOriginal.get(Number(raw.after_order))
          : undefined;
      const idx = ref ? steps.indexOf(ref) : -1;
      if (idx >= 0) steps.splice(idx + 1, 0, step);
      else steps.push(step);
    }
    if (steps.length > MAX_PLAN_STEPS) {
      return reject(
        `el plan quedaría con ${steps.length} pasos y el máximo es ${MAX_PLAN_STEPS}`,
      );
    }
    {
      if (
        steps.some(
          (step) =>
            !step.expected_input ||
            !step.expected_output ||
            !step.candidate_tools?.length ||
            step.candidate_tools.some((name) => typeof name !== 'string') ||
            !step.verifier ||
            step.approval !== (step.kind === 'cambio' ? 'individual' : 'none'),
        )
      )
        return reject(
          'Cada paso revisado requiere contrato completo de entrada/salida, tools, aprobación y verifier.',
        );
      for (const step of steps) {
        const refs = dependencies.get(step) ?? [];
        if (
          refs.some(
            (ref) =>
              steps.indexOf(ref) < 0 ||
              steps.indexOf(ref) >= steps.indexOf(step),
          )
        )
          return reject(
            'El DAG revisado requiere dependencias previas no eliminadas.',
          );
        step.depends_on = refs.map((ref) => steps.indexOf(ref) + 1);
      }
    }
    steps = steps.map((s, i) => ({ ...s, order: i + 1 }));
    plan.steps = steps;

    const addDel: any[] = Array.isArray(args.add_deliverables)
      ? args.add_deliverables
      : [];
    let n = plan.deliverables.length;
    for (const d of addDel) {
      const description = str(d?.description);
      if (!description) continue;
      n += 1;
      plan.deliverables.push({ id: `d${n}`, description, verified: false });
    }
    if (str(args.goal)) plan.goal = str(args.goal);
    plan.updated_at = new Date().toISOString();
    return { result: ok(plan) };
  }

  // ── persistencia ──────────────────────────────────────────────────────

  private async load(
    conversationId: number,
    session?: DurablePlanSession,
  ): Promise<{ metadata: Record<string, any>; plan: AgentPlan | null }> {
    const scope = requireObjectiveScope();
    const row = await this.prisma.ai_conversations.findFirst({
      where: { id: conversationId, ...(scope ?? {}) },
      select: { metadata: true },
    });
    const raw = row?.metadata;
    const metadata: Record<string, any> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as any) }
        : {};
    {
      const objective =
        await this.durableRepository().importLegacy(conversationId);
      if (!objective) return { metadata, plan: null };
      if (
        session &&
        (session.objective.id !== objective.id ||
          session.lease.lease_generation !== objective.lease_generation)
      ) {
        throw new ConflictException(
          'El objetivo cambió de ejecutor. No se avanzó el plan.',
        );
      }
      this.durableStates.set(metadata, { objective, session });
      const plan = objective.plan
        ? (JSON.parse(JSON.stringify(objective.plan)) as AgentPlan)
        : null;
      if (
        plan &&
        objective.expires_at.getTime() <= Date.now() &&
        ['active', 'paused'].includes(plan.status)
      )
        plan.status = 'abandoned';
      return { metadata, plan };
    }
  }

  private async save(
    conversationId: number,
    metadata: Record<string, any>,
    plan: AgentPlan,
    touch = true,
  ): Promise<void> {
    if (touch) plan.updated_at = new Date().toISOString();
    {
      const repository = this.durableRepository();
      const state = this.durableStates.get(metadata);
      const sameObjective =
        state && (!state.objective.plan || state.objective.plan.id === plan.id);
      if (!sameObjective && state?.session?.automaticContinuation) {
        throw new ConflictException(
          'Una continuación automática no puede crear otro objetivo. Usa revise_plan para continuar el objetivo vigente.',
        );
      }
      let saved = sameObjective
        ? await repository.savePlan(
            state.objective.id,
            state.session?.lease.version ?? state.objective.version,
            plan,
            state.session?.lease,
          )
        : await repository.createOrReplace(
            conversationId,
            plan,
            state?.objective.agent_id ?? undefined,
            {
              lease: state?.session?.lease,
              authority_snapshot: (
                state?.objective.authority_snapshot ??
                RequestContextService.asyncLocalStorage.getStore()
                  ?.permissions ??
                []
              ).filter((permission) =>
                (
                  RequestContextService.asyncLocalStorage.getStore()
                    ?.permissions ?? []
                ).includes(permission),
              ),
            },
          );
      if (state?.session && saved.id !== state.objective.id)
        saved = await repository.acquireLease(saved.id, saved.version);
      if (state?.session) {
        state.session.objective = saved;
        Object.assign(state.session.lease, {
          version: saved.version,
          lease_generation: saved.lease_generation,
        });
      }
      return;
    }
  }
}

import type { AgentRecoveryState } from './agent-recovery.service';
import { robustExecutionEnabled } from './agent-execution-flags';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import type { ActivePlaybookPin } from '../playbooks/playbook.service';
import type { AgentResult } from '../ai-agent.service';
import type { AIResponse } from '../interfaces/ai-provider.interface';
import type { ToolExecutionResult } from '../tools/interfaces/tool.interface';
import { toolReceipt } from '../tools/tool-result.normalizer';
import { AgentObjectiveRepository } from './agent-objective.repository';
import { objectiveOperationId } from './agent-objective.repository';
import { canonicalJson } from '../../domains/store/vexi/vexi-confirmation.service';
import { AgentTaskContextService } from './agent-task-context.service';
import { objectiveProviderMeter } from './agent-budget-context';
import {
  AgentObjective,
  ObjectiveBudget,
  ObjectiveProgress,
  ObjectiveLease,
  durableObjectivesEnabled,
} from './interfaces/agent-objective.interface';

export type { ObjectiveProgress } from './interfaces/agent-objective.interface';
export function objectiveProgress(row: AgentObjective): ObjectiveProgress {
  return {
    id: row.id,
    goal: row.goal,
    conversation_id: row.conversation_id,
    version: row.version,
    semantic_status: row.semantic_status,
    next_step: row.next_step,
    budget: row.budget,
    expires_at: new Date(row.expires_at).toISOString(),
    requires_revalidation: row.requires_revalidation,
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function objectiveArgsHash(args: unknown): string {
  return createHash('sha256').update(canonical(args)).digest('hex');
}
function resumeRequired(row: AgentObjective): ConflictException {
  const next =
    row.semantic_status === 'awaiting_approval'
      ? 'Revisa y aprueba o rechaza la propuesta pendiente; todavía no autoriza continuar.'
      : row.semantic_status === 'unknown_effect'
        ? 'Verifica el registro o recibo del cambio incierto antes de intentar otra escritura.'
        : row.semantic_status === 'expired'
          ? 'Selecciona este objetivo vencido y confirma su reanudación; sus datos deberán consultarse de nuevo.'
          : 'Selecciona reanudar este objetivo después de resolver su bloqueo, o inicia una conversación para un trabajo distinto.';
  return new ConflictException({
    error_code: 'AI_OBJECTIVE_REQUIRES_RESUME',
    message: next,
    objective: objectiveProgress(row),
    next_action: next,
  });
}

/** One fenced executor. Facts survive this instance; credentials never do. */
export class AgentDurableSession {
  /** Provider call IDs are only unique within a turn, not across a durable goal. */
  readonly turn_id = randomUUID();
  get objective_id(): string {
    return this.objective.id;
  }
  readonly lease: ObjectiveLease;
  private startedAt = Date.now();
  private accountedRuntime = 0;
  private excludedRuntime = 0;
  private closed = false;
  readonly context: string;
  constructor(
    public objective: AgentObjective,
    context: string,
    private readonly repo: AgentObjectiveRepository,
    readonly automaticContinuation = false,
    readonly playbook_pins: ActivePlaybookPin[] = [],
  ) {
    this.lease = {
      version: objective.version,
      lease_generation: objective.lease_generation,
    };
    this.context = context;
  }
  private accept(row: AgentObjective | null): void {
    if (!row) throw new ConflictException('AI_OBJECTIVE_STALE_EXECUTOR');
    this.objective = row;
    Object.assign(this.lease, {
      version: row.version,
      lease_generation: row.lease_generation,
    });
  }
  async completeVerified(capability: unknown): Promise<void> {
    this.accept(
      await this.repo.commitVerified(this.objective_id, this.lease, capability),
    );
  }
  async recoveryState(): Promise<AgentRecoveryState | undefined> {
    const stored = await this.repo.latestInternalResult(
      this.objective_id,
      'agent_recovery_checkpoint',
    );
    if (!stored) return undefined;
    const state = (stored.data as { recovery?: AgentRecoveryState } | null)
      ?.recovery;
    // A corrupt checkpoint is deliberately passed to the policy, which fails closed.
    return state ?? ({} as AgentRecoveryState);
  }
  async checkpointRecovery(
    state: AgentRecoveryState,
    previous?: AgentRecoveryState,
  ): Promise<void> {
    const counter = (value?: AgentRecoveryState) =>
      value ? value.replans + value.corrections + value.transient_retries : 0;
    const saved = await this.repo.appendToolResult(
      this.objective_id,
      this.lease,
      {
        tool_call_id: `${this.turn_id}:recovery:${randomUUID()}`,
        tool_name: 'agent_recovery_checkpoint',
        args_hash: objectiveArgsHash({}),
        receipt: toolReceipt({
          schema_version: '1',
          status: 'ok',
          error_code: null,
          retryable: false,
          next_action: null,
          evidence_refs: [],
          resource_ids: {},
          pagination: null,
          freshness: 'observed',
          effect_status: 'not_applicable',
          data: null,
        }),
        data: {
          schema_version: '1',
          checkpoint_version: this.lease.version,
          recovery: state,
        },
        // Catalog policy reservations live in state; the actual search dispatch
        // alone charges budget.expansions, so one expansion is never billed twice.
        budget_delta: {
          recovery: Math.max(0, counter(state) - counter(previous)),
        },
        checkpoint: {},
      },
    );
    if (!saved.advanced)
      throw new ConflictException('AI_OBJECTIVE_STALE_EXECUTOR');
    this.accept(saved.objective);
  }
  async assertCurrent(): Promise<void> {
    const row = await this.repo.get(this.objective_id);
    if (
      row.lease_generation !== this.lease.lease_generation ||
      row.version !== this.lease.version ||
      !row.lease_until ||
      new Date(row.lease_until).getTime() <= Date.now()
    )
      throw new ConflictException('AI_OBJECTIVE_STALE_EXECUTOR');
    if (
      [
        'expired',
        'paused',
        'superseded',
        'cancelled',
        'unknown_effect',
        'blocked',
        'awaiting_approval',
      ].includes(row.semantic_status)
    )
      throw resumeRequired(row);
    this.objective = row;
  }
  async addBudget(delta: Partial<ObjectiveBudget>): Promise<void> {
    this.accept(
      await this.repo.addBudget(this.objective_id, this.lease, delta),
    );
  }
  excludeWait(ms: number): void {
    this.excludedRuntime += Math.max(0, ms);
  }
  async accountRuntime(): Promise<void> {
    const active = Math.max(
      0,
      Date.now() - this.startedAt - this.excludedRuntime,
    );
    const delta = Math.max(0, active - this.accountedRuntime);
    if (delta) {
      await this.addBudget({ active_runtime_ms: delta });
      this.accountedRuntime = active;
    }
  }
  async assertBudget(): Promise<void> {
    await this.assertCurrent();
    await this.accountRuntime();
    const b = this.objective.budget;
    // Finite across automatic plan_continue; does not widen ANY turn budget.
    if (
      b.provider_attempts >= 240 ||
      b.tools >= 1000 ||
      b.active_runtime_ms >= 1_800_000
    )
      throw new ConflictException('AI_OBJECTIVE_BUDGET_EXHAUSTED');
  }
  async runProvider(callback: () => Promise<AIResponse>): Promise<AIResponse> {
    await this.assertBudget();
    await this.addBudget({ provider_attempts: 1 }); // durable intent before first dispatch
    return this.withMeter(callback, true);
  }
  /** Vision sub-agents use the same Engine observer, not an unmetered tool side path. */
  async runTool<T>(callback: () => Promise<T>): Promise<T> {
    return this.withMeter(callback, false);
  }
  private async withMeter<T>(
    callback: () => Promise<T>,
    prepaid: boolean,
  ): Promise<T> {
    let dispatches = 0;
    const meter = {
      attempts: 0,
      observed: false,
      dispatch: async () => {
        await this.assertBudget();
        if (dispatches++ > 0 || !prepaid)
          await this.addBudget({ provider_attempts: 1 });
        meter.attempts = 0;
      },
      retry: async () => {
        await this.assertBudget();
        await this.addBudget({ provider_attempts: 1 });
      },
      usage: async (u: AIResponse['usage'], cost: number | null) =>
        this.repo.auditBudget(this.objective_id, this.lease.lease_generation, {
          prompt_tokens: u?.promptTokens ?? 0,
          completion_tokens: u?.completionTokens ?? 0,
          cost_usd: cost,
        }),
    };
    return objectiveProviderMeter.run(meter, async () => {
      try {
        const response = await callback();
        // Mock/custom engines without the real attempt observer remain honestly unpriced.
        if (!meter.observed && prepaid)
          await meter.usage((response as AIResponse).usage, null);
        return response;
      } catch (error) {
        if (!meter.observed && (prepaid || dispatches))
          await meter.usage(undefined, null);
        throw error;
      }
    });
  }
  async proposeWrite(
    tool: string,
    args: Record<string, unknown>,
    explicitStepId?: string,
  ): Promise<void> {
    const hash = createHash('sha256')
      .update(`${tool}|${canonicalJson(args)}`)
      .digest('hex');
    const current = this.objective.plan?.steps.find(
      (s) =>
        s.kind === 'cambio' &&
        ['pending', 'in_progress', 'waiting_user'].includes(s.status),
    );
    const stepId =
      explicitStepId ??
      (current
        ? `plan:${this.objective.plan!.id}:${current.order}`
        : `write:${hash}`);
    const effect = await this.repo.proposeEffect(
      this.objective_id,
      {
        operation_id: objectiveOperationId(this.objective_id, stepId, hash),
        proposal_hash: hash,
        step_id: stepId,
      },
      this.lease,
    );
    if (!['proposed', 'approved'].includes(effect.status))
      throw new ConflictException(
        'Este cambio fue rechazado, enviado o es incierto. Revisa la propuesta antes de continuar.',
      );
  }
  /** Late/non-cooperative reads are auditable, never current-generation evidence. */
  async auditTool(
    callId: string,
    name: string,
    args: unknown,
    result: ToolExecutionResult,
    version = '1',
    countTool = true,
  ): Promise<string> {
    const saved = await this.repo.appendToolResult(
      this.objective_id,
      { version: -1, lease_generation: this.lease.lease_generation },
      {
        tool_call_id: `${this.turn_id}:${callId}`,
        tool_name: name,
        tool_version: version,
        args_hash: objectiveArgsHash(args),
        receipt: toolReceipt(result),
        data: result.data,
        budget_delta: { tools: countTool ? 1 : 0 },
      },
    );
    return saved.result.id;
  }
  async checkpointTool(
    callId: string,
    name: string,
    args: unknown,
    result: ToolExecutionResult,
    version = '1',
  ): Promise<string> {
    const status =
      result.status === 'pending_confirmation'
        ? 'awaiting_approval'
        : result.status === 'needs_user_input'
          ? 'awaiting_input'
          : result.status === 'unknown_effect'
            ? 'unknown_effect'
            : result.status === 'blocked'
              ? 'blocked'
              : 'active';
    const {
      objective,
      advanced,
      result: stored,
    } = await this.repo.appendToolResult(this.objective_id, this.lease, {
      tool_call_id: `${this.turn_id}:${callId.length <= 150 ? callId : createHash('sha256').update(callId).digest('hex')}`,
      tool_name: name,
      tool_version: version,
      args_hash: objectiveArgsHash(args),
      receipt: toolReceipt(result),
      data: result.data,
      budget_delta: { tools: 1 },
      checkpoint: {
        semantic_status:
          ['unknown_effect', 'blocked', 'awaiting_approval'].includes(
            this.objective.semantic_status,
          ) && status === 'active'
            ? (this.objective.semantic_status as
                | 'unknown_effect'
                | 'blocked'
                | 'awaiting_approval')
            : status,
        next_step: result.next_action,
      },
    });
    if (!advanced) throw new ConflictException('AI_OBJECTIVE_STALE_EXECUTOR');
    this.accept(objective);
    return stored.id;
  }
  async finish(result: AgentResult): Promise<ObjectiveProgress> {
    // Old executors never overwrite a replacement's goal, plan or state.
    if (result.aborted) return objectiveProgress(this.objective);
    // Only the opaque server verifier can enter completed_verified. Never
    // downgrade that state to a conversational partial during normal closure.
    if (
      robustExecutionEnabled() &&
      this.objective.semantic_status === 'completed_verified'
    ) {
      await this.close();
      this.objective = await this.repo.get(this.objective_id);
      return objectiveProgress(this.objective);
    }
    await this.accountRuntime();
    const outcome = result.execution?.outcome;
    const semantic_status =
      result.pending_confirmation || result.pending_plan
        ? 'awaiting_approval'
        : result.awaiting_input
          ? 'awaiting_input'
          : outcome === 'unknown_effect'
            ? 'unknown_effect'
            : outcome === 'blocked'
              ? 'blocked'
              : !result.success
                ? 'failed'
                : [
                      'unknown_effect',
                      'blocked',
                      'awaiting_approval',
                      'awaiting_input',
                      'paused',
                    ].includes(this.objective.semantic_status)
                  ? (this.objective.semantic_status as
                      | 'unknown_effect'
                      | 'blocked'
                      | 'awaiting_approval'
                      | 'awaiting_input'
                      | 'paused')
                  : 'partial';
    this.accept(
      await this.repo.checkpoint(this.objective_id, this.lease, {
        semantic_status,
        next_step: result.execution?.next_action ?? this.objective.next_step,
      }),
    );
    await this.close();
    this.objective = await this.repo.get(this.objective_id);
    return objectiveProgress(this.objective);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.repo.releaseLease(this.objective_id, this.lease);
  }
}
@Injectable()
export class AgentDurableSessionService {
  constructor(
    private readonly repo: AgentObjectiveRepository,
    private readonly contexts: AgentTaskContextService,
  ) {}
  async canContinue(conversationId: number): Promise<boolean> {
    if (!durableObjectivesEnabled()) return false;
    let row = await this.repo.getForConversation(conversationId);
    if (row?.semantic_status === 'awaiting_approval')
      row = await this.repo.recoverAppliedReceipt(row.id, row.version);
    return (
      !!row &&
      new Date(row.expires_at).getTime() > Date.now() &&
      ['active', 'partial', 'awaiting_input'].includes(row.semantic_status)
    );
  }
  async open(
    conversationId: number,
    agentKey: string,
    goal: string,
    options: { continuation?: boolean; objectiveId?: string } = {},
  ): Promise<AgentDurableSession | null> {
    if (!durableObjectivesEnabled()) return null;
    // Do not borrow another request's historical static tenant context.
    const ctx = RequestContextService.asyncLocalStorage.getStore();
    if (!ctx?.store_id || !ctx.organization_id || !ctx.user_id)
      throw new NotFoundException();
    let row = options.objectiveId
      ? await this.repo.get(options.objectiveId)
      : ((await this.repo.importLegacy(conversationId, agentKey)) ??
        (await this.repo.getForConversation(conversationId)));
    if (
      row &&
      (row.conversation_id !== conversationId ||
        (row.agent_id && row.agent_id !== agentKey))
    )
      throw new NotFoundException();
    if (!row)
      row = await this.repo.createOrReplace(conversationId, null, agentKey, {
        goal,
        authority_snapshot: ctx.permissions ?? [],
      });
    if (row.semantic_status === 'awaiting_approval')
      row = await this.repo.recoverAppliedReceipt(row.id, row.version);
    // Resume is explicit. Opening a message never refreshes expired facts or approval.
    if (
      [
        'expired',
        'paused',
        'superseded',
        'cancelled',
        'unknown_effect',
        'blocked',
        'awaiting_approval',
      ].includes(row.semantic_status)
    )
      throw resumeRequired(row);
    row = await this.repo.acquireLease(row.id, row.version, 650_000);
    try {
      const facts = await this.contexts.build(row.id, {
        max_chars: 10_000,
        max_results: 8,
      });
      return new AgentDurableSession(
        row,
        facts.context,
        this.repo,
        options.continuation === true,
        facts.playbook_pins ?? [],
      );
    } catch (error) {
      await this.repo.releaseLease(row.id, row);
      throw error;
    }
  }
}

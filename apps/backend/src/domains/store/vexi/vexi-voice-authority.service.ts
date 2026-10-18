import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { RequestContextService } from '../../../common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIAgentService } from '../../../ai-engine/ai-agent.service';
import { AIToolDefinition } from '../../../ai-engine/interfaces/ai-provider.interface';
import {
  AgentPlan,
  AgentPlanToolName,
} from '../../../ai-engine/interfaces/agent-plan.interface';
import { AgentObjectiveRepository } from '../../../ai-engine/tasks/agent-objective.repository';

import { objectiveArgsHash } from '../../../ai-engine/tasks/agent-durable-session.service';
import {
  countsAsToolSuccess,
  normalizeToolResult,
  toolReceipt,
} from '../../../ai-engine/tools/tool-result.normalizer';
import { isAgentPlanTool } from '../../../ai-engine/interfaces/agent-plan.interface';
import { SubscriptionAccessService } from '../subscriptions/services/subscription-access.service';
import { VexiPlanStateService } from './vexi-plan-state.service';

export interface VoiceAuthority {
  conversation_id: number;
  agent_key: 'vex' | 'vexi';
  objective_id: string | null;
  step_id: string | null;
  goal: string;
  plan: AgentPlan | null;
  authorizedDefinitions: AIToolDefinition[];
}

/** One policy adapter for every G transport. Never an alternate execution engine. */
@Injectable()
export class VexiVoiceAuthorityService {
  /** Role proof for nested narrowed calls, never permissions or client authority. */
  private readonly executionPrincipal = new AsyncLocalStorage<{
    userId: number;
    organizationId: number;
    storeId: number;
    roles: string[];
  }>();
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly agent: AIAgentService,
    private readonly access: SubscriptionAccessService,
    private readonly plans: VexiPlanStateService,
    private readonly objectives: AgentObjectiveRepository,
  ) {}

  async prepareAuthority(
    conversationId: number,
    expectedAgentKey?: string,
    goal?: string,
  ): Promise<VoiceAuthority> {
    const current = await this.resolveAuthority(
      conversationId,
      expectedAgentKey,
    );
    if (!current.objective_id) {
      await this.objectives.ensureForConversation(
        conversationId,
        current.agent_key,
        goal?.trim() || 'Conversación por voz',
      );
      return this.resolveAuthority(conversationId, expectedAgentKey);
    }
    return current;
  }

  async resolveAuthority(
    conversationId: number,
    expectedAgentKey?: string,
  ): Promise<VoiceAuthority> {
    const ctx = RequestContextService.asyncLocalStorage.getStore();
    const proof = this.executionPrincipal.getStore();
    const provenRole =
      proof &&
      proof.userId === ctx?.user_id &&
      proof.organizationId === ctx?.organization_id &&
      proof.storeId === ctx?.store_id &&
      proof.roles.some((role) => role === 'owner' || role === 'admin');
    if (
      !ctx?.user_id ||
      !ctx.store_id ||
      !ctx.organization_id ||
      (!ctx.roles?.some((role) => role === 'owner' || role === 'admin') &&
        !provenRole)
    )
      throw new NotFoundException('Voice conversation not found');
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: {
        id: conversationId,
        user_id: ctx.user_id,
        store_id: ctx.store_id,
        organization_id: ctx.organization_id,
      },
      select: { id: true, metadata: true, status: true },
    });
    if (
      !conversation ||
      conversation.status === 'archived' ||
      conversation.status === 'deleted'
    )
      throw new NotFoundException('Voice conversation not found');
    const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
    const agentKey = metadata.agent_key ?? 'vexi';
    if (
      (agentKey !== 'vex' && agentKey !== 'vexi') ||
      (expectedAgentKey && expectedAgentKey !== agentKey)
    )
      throw new NotFoundException('Voice conversation not found');
    const [row, settings, voiceGate, toolsGate] = await Promise.all([
      this.globalPrisma.ai_agents.findUnique({ where: { key: agentKey } }),
      this.globalPrisma.store_settings.findUnique({
        where: { store_id: ctx.store_id },
        select: { settings: true },
      }),
      this.access.canUseAIFeature(ctx.store_id, 'realtime_voice'),
      this.access.canUseAIFeature(
        ctx.store_id,
        agentKey === 'vex' ? 'vex_agent' : 'tool_agents',
      ),
    ]);
    const toggles = settings?.settings as Record<
      string,
      { enabled?: boolean }
    > | null;
    if (
      !row?.is_active ||
      toggles?.[agentKey]?.enabled !== true ||
      !voiceGate.allowed ||
      !toolsGate.allowed
    )
      throw new ConflictException(
        'La voz o las herramientas de este agente no están disponibles en el plan actual. Puedes revisar el cambio con clic.',
      );
    const plan = await this.plans.get(conversationId); // Also rejects a durable-pointer rollback.
    const objective = await this.objectives.getForConversation(conversationId);
    if (
      objective &&
      (objective.expires_at.getTime() <= Date.now() ||
        [
          'unknown_effect',
          'expired',
          'superseded',
          'cancelled',
          'completed_verified',
        ].includes(objective.semantic_status))
    )
      throw new ConflictException(
        'El objetivo requiere reconciliación o reanudación explícita antes de continuar por voz.',
      );
    const effectiveContext = {
      ...ctx,
      permissions: objective
        ? (ctx.permissions ?? []).filter((permission) =>
            objective.authority_snapshot.includes(permission),
          )
        : [...(ctx.permissions ?? [])],
      // Do not fall back to roles when a durable permission intersection is empty.
      roles: objective ? [] : [...(ctx.roles ?? [])],
    };
    const definitions = await RequestContextService.runIsolated(
      effectiveContext,
      () =>
        this.agent.resolveToolAuthority({
          goal: objective?.goal ?? plan?.goal ?? '',
          agent_key: agentKey,
          agent_allowed_tools: row.allowed_tools ?? [],
          agent_denied_tools: row.denied_tools ?? [],
          plan: this.plans.createHook(conversationId),
        }),
    );
    const current = plan?.steps.find(
      (step) =>
        step.kind === 'cambio' &&
        ['pending', 'in_progress', 'waiting_user'].includes(step.status),
    );
    return {
      conversation_id: conversationId,
      agent_key: agentKey,
      objective_id: objective?.id ?? null,
      step_id: current ? `plan:${plan!.id}:${current.order}` : null,
      goal: objective?.goal ?? plan?.goal ?? '',
      plan,
      authorizedDefinitions: definitions,
    };
  }

  async assertWritable(authority: VoiceAuthority): Promise<void> {
    await this.runAuthorized(authority, async () => {
      const ctx = RequestContextService.asyncLocalStorage.getStore()!;
      const gate = await this.access.canUseModule(
        ctx.store_id!,
        'store-operations',
      );
      if (gate.mode === 'block')
        throw new ConflictException(
          'El plan actual no permite aplicar este cambio.',
        );
    });
  }

  /**
   * Tool-level filtering is not enough for generic call_endpoint/write_endpoint:
   * their endpoint permissions are resolved later by the bridge's preflight.
   * Keep the full preview/dispatch callback inside current ∩ durable authority,
   * not just resolveToolAuthority(). Never substitute the legacy static fallback.
   */
  async runAuthorized<T>(
    authority: VoiceAuthority,
    callback: (fresh: VoiceAuthority) => Promise<T>,
  ): Promise<T> {
    const ctx = RequestContextService.asyncLocalStorage.getStore();
    if (!ctx?.user_id || !ctx.store_id || !ctx.organization_id)
      throw new NotFoundException('Voice conversation not found');
    const fresh = await this.resolveAuthority(
      authority.conversation_id,
      authority.agent_key,
    );
    if (
      fresh.objective_id !== authority.objective_id ||
      fresh.step_id !== authority.step_id
    )
      throw new ConflictException(
        'Cambió el objetivo o el paso. Revisa una propuesta nueva.',
      );
    const objective = fresh.objective_id
      ? await this.objectives.get(fresh.objective_id)
      : null;
    if (
      objective &&
      (objective.conversation_id !== fresh.conversation_id ||
        objective.user_id !== ctx.user_id ||
        objective.organization_id !== ctx.organization_id ||
        objective.store_id !== ctx.store_id)
    )
      throw new NotFoundException('Voice conversation not found');
    const effective = {
      ...ctx,
      permissions: objective
        ? (ctx.permissions ?? []).filter((permission) =>
            objective.authority_snapshot.includes(permission),
          )
        : [...(ctx.permissions ?? [])],
      roles: objective ? [] : [...(ctx.roles ?? [])],
    };
    const existingProof = this.executionPrincipal.getStore();
    const proof = {
      userId: ctx.user_id,
      organizationId: ctx.organization_id,
      storeId: ctx.store_id,
      roles:
        existingProof &&
        existingProof.userId === ctx.user_id &&
        existingProof.organizationId === ctx.organization_id &&
        existingProof.storeId === ctx.store_id
          ? [...existingProof.roles]
          : [...(ctx.roles ?? [])],
    };
    return this.executionPrincipal.run(proof, () =>
      RequestContextService.runIsolated(effective, async () => {
        // Recheck the same owner/config/plan and objective after entering the narrowed
        // authority. The callback gets that refreshed catalog, not the stale caller's.
        const scoped = await this.resolveAuthority(
          fresh.conversation_id,
          fresh.agent_key,
        );
        if (
          scoped.objective_id !== fresh.objective_id ||
          scoped.step_id !== fresh.step_id
        )
          throw new ConflictException(
            'Cambió el objetivo o el paso. Revisa una propuesta nueva.',
          );
        return callback(scoped);
      }),
    );
  }

  async executePlanningTool(
    authority: VoiceAuthority,
    name: AgentPlanToolName,
    args: Record<string, unknown>,
  ): Promise<string> {
    return this.runAuthorized(authority, async (fresh) => {
      if (
        !fresh.authorizedDefinitions.some(
          (definition) => definition.function.name === name,
        )
      )
        throw new ConflictException(
          'La herramienta no pertenece al catálogo vigente.',
        );
      const hook = this.plans.createHook(fresh.conversation_id);
      try {
        const outcome = await hook.execute(name, args, {
          assertToolAllowed: async (tool) =>
            (
              await this.resolveAuthority(
                fresh.conversation_id,
                fresh.agent_key,
              )
            ).authorizedDefinitions.some((d) => d.function.name === tool),
        });
        return outcome.result;
      } finally {
        await hook.release?.();
      }
    });
  }

  async recordResult(
    authority: VoiceAuthority,
    tool: string,
    args: Record<string, unknown>,
    raw: string,
    callId?: string,
  ): Promise<void> {
    const result = normalizeToolResult(raw, {
      evidenceRef: callId ? `voice_call:${callId}` : undefined,
    });
    if (callId && !isAgentPlanTool(tool) && countsAsToolSuccess(result)) {
      const context = RequestContextService.asyncLocalStorage.getStore()!;
      try {
        await this.access.consumeAIQuota(
          context.store_id!,
          authority.agent_key === 'vex' ? 'vex_agent' : 'tool_agents',
          1,
          `${context.request_id ?? `internal-${randomUUID()}`}:tool:${callId}`,
        );
      } catch {
        /* Like the shared text path: do not hide an observed receipt on metering outage. */
      }
    }
    if (!authority.objective_id) return;
    const objective = await this.objectives.get(authority.objective_id);
    const leased = await this.objectives.acquireLease(
      objective.id,
      objective.version,
    );
    const lease = {
      version: leased.version,
      lease_generation: leased.lease_generation,
    };
    try {
      const saved = await this.objectives.appendToolResult(
        objective.id,
        lease,
        {
          tool_call_id: `voice:${randomUUID()}`,
          tool_name: tool,
          args_hash: objectiveArgsHash(args),
          receipt: toolReceipt(result),
          data: result.data,
          budget_delta: { tools: 1 },
          checkpoint: {
            requires_revalidation: true,
            semantic_status:
              result.status === 'pending_confirmation'
                ? 'awaiting_approval'
                : result.status === 'unknown_effect'
                  ? 'unknown_effect'
                  : objective.semantic_status === 'completed_verified'
                    ? 'partial'
                    : objective.semantic_status,
            next_step: result.next_action ?? objective.next_step,
          },
        },
      );
      Object.assign(lease, {
        version: saved.objective.version,
        lease_generation: saved.objective.lease_generation,
      });
      if (!saved.advanced)
        throw new ConflictException(
          'El resultado quedó en auditoría; otro turno reemplazó esta sesión.',
        );
    } finally {
      await this.objectives.releaseLease(objective.id, lease);
    }
  }
}

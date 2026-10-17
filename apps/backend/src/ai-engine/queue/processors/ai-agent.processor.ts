import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ForbiddenException, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AIAgentService, AgentRunParams } from '../../ai-agent.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { AIAgentJob } from '../interfaces/ai-queue.interface';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { buildActiveUserRolesWhere } from '../../../common/utils/role-scope.util';
import { SubscriptionAccessService } from '../../../domains/store/subscriptions/services/subscription-access.service';
import { AgentObjectiveRepository } from '../../tasks/agent-objective.repository';
import { durableObjectivesEnabled } from '../../tasks/interfaces/agent-objective.interface';
import { AgentDurableSessionService } from '../../tasks/agent-durable-session.service';
import type { RequestContext } from '../../../common/context/request-context.service';

/**
 * Runs an agent turn with no user waiting on it.
 *
 * The `ai-agent` queue has existed and been unconsumed since it was declared, so
 * `enqueueAgentTask` added jobs that nothing ever ran. This is its worker.
 *
 * One property defines what a background task may do: **there is no bearer token
 * here**. A queued job has no HTTP request behind it, so `write_endpoint` refuses
 * (it checks for the caller's token before anything else) and every
 * confirmation-gated tool still throws its approval demand. That is the correct
 * shape rather than a limitation to work around — the business rule is that
 * nothing applies without the person saying yes, and a background job is by
 * definition a place where nobody can say yes. What a task does, then, is the
 * expensive read-side work: validating 200 rows against the real catalog, sweeping
 * a month of orders for inconsistencies, preparing a bulk upload. The proposal
 * comes back to the chat, where it can be approved.
 *
 * With D1 enabled the job snapshot is a ceiling, never a grant: intersect it
 * with current DB memberships, role permissions and plan gates. Revocation must
 * stop execution; a later grant must never enlarge the queued authority.
 */
@Processor('ai-agent')
export class AIAgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AIAgentProcessor.name);

  constructor(
    private readonly aiAgent: AIAgentService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly prisma?: GlobalPrismaService,
    @Optional() private readonly subscriptionAccess?: SubscriptionAccessService,
    @Optional() private readonly objectives?: AgentObjectiveRepository,
    @Optional() private readonly durableSessions?: AgentDurableSessionService,
  ) {
    super();
  }

  async process(job: Job<AIAgentJob>): Promise<any> {
    const { goal, task_id } = job.data;

    this.logger.log(
      `Processing Vexi agent task ${job.id} (task_id=${task_id ?? 'none'}): ${goal.slice(0, 80)}`,
    );

    const requestId = job.data.request_id?.trim()
      ? job.data.request_id
      : `queue-${randomUUID()}`;

    try {
      const result = await RequestContextService.runIsolated(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: job.data.store_id,
          organization_id: job.data.organization_id,
          user_id: job.data.user_id,
          permissions: job.data.permissions,
          roles: job.data.roles,
          request_id: requestId,
          // Never spread a job/context: no credential survives the queue boundary.
        },
        async () => {
          const enabled = durableObjectivesEnabled();
          const context = enabled
            ? await this.currentAuthority(job.data, requestId)
            : RequestContextService.asyncLocalStorage.getStore()!;
          return RequestContextService.runIsolated(context, async () => {
            let durable: Awaited<
              ReturnType<AgentDurableSessionService['open']>
            > = null;
            let agentKey = 'vexi';
            let objectiveConversation: number | undefined;
            if (enabled && job.data.objective_id) {
              if (!this.objectives || !this.durableSessions)
                throw new ForbiddenException('Durable worker unavailable');
              const objective = await this.objectives.get(
                job.data.objective_id,
              );
              if (objective.conversation_id !== job.data.conversation_id)
                throw new ForbiddenException('Objective context mismatch');
              // Stored facts cannot grant authority. The enqueue snapshot already
              // caps current permissions; the objective snapshot can only narrow it.
              context.permissions = context.permissions?.filter((permission) =>
                objective.authority_snapshot.includes(permission),
              );
              if (!context.permissions?.length)
                throw new ForbiddenException('Objective authority revoked');
              agentKey = objective.agent_id ?? 'vexi';
              objectiveConversation = objective.conversation_id;
            }
            const policy = enabled
              ? await this.currentAgentPolicy(context, agentKey, job.data)
              : {};
            if (enabled && job.data.objective_id) {
              durable = await this.durableSessions!.open(
                objectiveConversation!,
                agentKey,
                goal,
                {
                  objectiveId: job.data.objective_id,
                  continuation: true,
                },
              );
            }
            try {
              return await this.aiAgent.runAgent({
                goal,
                app_key: job.data.app_key ?? 'chat_assistant',
                tools: job.data.tools,
                max_iterations: job.data.max_iterations,
                timeout_ms: job.data.timeout_ms,
                ...policy,
                ...(durable
                  ? {
                      durable,
                      objective_id: durable.objective_id,
                      turn_id: durable.turn_id,
                      conversation_id: durable.objective.conversation_id,
                      ...(durable.context
                        ? {
                            messages: [
                              {
                                role: 'system' as const,
                                content: durable.context,
                              },
                            ],
                          }
                        : {}),
                    }
                  : {}),
              });
            } finally {
              await durable?.close();
            }
          });
        },
      );

      this.eventEmitter.emit('vexi.task.finished', {
        job_id: job.id,
        task_id,
        store_id: job.data.store_id,
        user_id: job.data.user_id,
        conversation_id: job.data.conversation_id,
        goal,
        success: result.success,
        content: result.content,
        ...(result.execution ? { execution: result.execution } : {}),
        tools_used: result.tools_used?.length ?? 0,
      });

      return result;
    } catch (error: any) {
      this.logger.error(`Vexi agent task ${job.id} failed: ${error?.message}`);

      // Emitted, not swallowed: the person is not watching, so the only way they
      // learn the task died is the notification this event drives.
      this.eventEmitter.emit('vexi.task.finished', {
        job_id: job.id,
        task_id,
        store_id: job.data.store_id,
        user_id: job.data.user_id,
        conversation_id: job.data.conversation_id,
        goal,
        success: false,
        error: error?.message ?? 'Error desconocido',
      });

      throw error;
    }
  }
  /** Resolve like JWT/store access, but never mint or persist a user's credential. */
  private async currentAuthority(
    job: AIAgentJob,
    requestId: string,
  ): Promise<RequestContext> {
    const {
      store_id: storeId,
      organization_id: organizationId,
      user_id: userId,
    } = job;
    if (
      !this.prisma ||
      !this.subscriptionAccess ||
      ![storeId, organizationId, userId].every(
        (id) => Number.isSafeInteger(id) && Number(id) > 0,
      )
    ) {
      throw new ForbiddenException('Explicit worker authority is required');
    }
    const [user, store, assignments, membership] = await Promise.all([
      this.prisma.users.findFirst({
        where: { id: userId!, organization_id: organizationId! },
        select: { id: true, state: true, locked_until: true },
      }),
      this.prisma.stores.findFirst({
        where: {
          id: storeId!,
          organization_id: organizationId!,
          is_active: true,
        },
        select: { id: true },
      }),
      this.prisma.user_roles.findMany({
        where: buildActiveUserRolesWhere(userId!, storeId!),
        include: {
          roles: {
            include: { role_permissions: { include: { permissions: true } } },
          },
        },
      }),
      this.prisma.store_users.findUnique({
        where: { store_id_user_id: { store_id: storeId!, user_id: userId! } },
        select: { id: true },
      }),
    ]);
    const currentRoles = assignments.flatMap((assignment) =>
      assignment.roles ? [assignment.roles.name] : [],
    );
    const effectiveRoles = (job.roles ?? []).filter((role) =>
      currentRoles.includes(role),
    );
    const hasOrgAccess = assignments.some(
      (assignment) =>
        assignment.store_id == null &&
        !!assignment.roles &&
        ['owner', 'admin', 'org_admin'].includes(assignment.roles.name) &&
        effectiveRoles.includes(assignment.roles.name),
    );
    if (
      !user ||
      user.state !== 'active' ||
      (user.locked_until && user.locked_until > new Date()) ||
      !store ||
      (!membership && !hasOrgAccess)
    ) {
      throw new ForbiddenException('Worker access revoked');
    }
    const currentPermissions = new Set(
      assignments.flatMap((assignment) =>
        (assignment.roles?.role_permissions ?? [])
          .filter(
            (entry) => entry.granted && entry.permissions.status === 'active',
          )
          .map((entry) => entry.permissions.name),
      ),
    );
    const permissions = [...new Set(job.permissions ?? [])].filter(
      (permission) => currentPermissions.has(permission),
    );
    if (!permissions.length)
      throw new ForbiddenException('Worker permissions revoked');
    return {
      store_id: storeId,
      organization_id: organizationId,
      user_id: userId,
      request_id: requestId,
      app_type: 'STORE_ADMIN',
      permissions,
      roles: effectiveRoles,
      is_super_admin: false,
      is_owner: effectiveRoles.includes('owner'),
    };
  }

  /** Current agent policy narrows execution; no Vex-only approval/block hooks in a worker. */
  private async currentAgentPolicy(
    context: RequestContext,
    key: string,
    job: AIAgentJob,
  ): Promise<Partial<AgentRunParams>> {
    if (!this.prisma || !this.subscriptionAccess)
      throw new ForbiddenException('Worker policy unavailable');
    if (
      key === 'vex' &&
      !context.roles?.some((role) => ['owner', 'admin'].includes(role))
    ) {
      throw new ForbiddenException('Worker Vex role revoked');
    }
    const [row, settings, gate] = await Promise.all([
      this.prisma.ai_agents.findUnique({ where: { key } }),
      this.prisma.store_settings.findUnique({
        where: { store_id: context.store_id! },
        select: { settings: true },
      }),
      this.subscriptionAccess.canUseAIFeature(
        context.store_id!,
        key === 'vex' ? 'vex_agent' : 'tool_agents',
      ),
    ]);
    const switches = settings?.settings as Record<
      string,
      { enabled?: boolean }
    > | null;
    if (
      !row?.is_active ||
      switches?.[key === 'vex' ? 'vex' : 'vexi']?.enabled !== true ||
      !gate.allowed
    ) {
      throw new ForbiddenException('Worker AI access blocked');
    }
    const max = row.max_iterations ?? undefined;
    const timeoutMs =
      row.timeout_seconds == null ? undefined : row.timeout_seconds * 1000;
    return {
      agent_key: row.key,
      ...(row.app_key
        ? { app_key: row.app_key }
        : row.system_prompt
          ? { app_key: undefined, system_prompt: row.system_prompt }
          : {}),
      agent_allowed_tools: row.allowed_tools.length
        ? row.allowed_tools
        : undefined,
      // These tools replay authenticated HTTP. A queue intentionally has no bearer.
      agent_denied_tools: [
        ...new Set([
          ...row.denied_tools,
          'call_endpoint',
          'write_endpoint',
          'bulk_prepare',
        ]),
      ],
      max_iterations:
        max == null
          ? job.max_iterations
          : job.max_iterations == null
            ? max
            : Math.min(max, job.max_iterations),
      ...(timeoutMs == null
        ? {}
        : {
            timeout_ms:
              job.timeout_ms == null
                ? timeoutMs
                : Math.min(timeoutMs, job.timeout_ms),
            agent_timeout_seconds: row.timeout_seconds!,
          }),
      trace_surface: 'worker',
    };
  }
}

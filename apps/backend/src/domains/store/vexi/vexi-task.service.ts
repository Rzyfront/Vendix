import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIQueueService } from '../../../ai-engine/queue/ai-queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/** Past this, the "goal" is a document, not an instruction. */
const MAX_GOAL_CHARS = 2000;

/**
 * One in-flight task per person at a time.
 *
 * Not a technical limit — BullMQ would happily queue fifty. It is a product one:
 * a person who can fire off unbounded background agents has no way to reason about
 * what is running, and every task consumes AI quota they are paying for. Serialised,
 * "¿en qué va?" always has one answer.
 */
const MAX_ACTIVE_TASKS_PER_USER = 1;

export interface TaskSnapshot {
  id: number;
  goal: string;
  status: string;
  job_id: string | null;
  result: unknown;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

/**
 * Work that does not fit in a conversation turn.
 *
 * A turn has a wall-clock budget measured in seconds because a person is watching
 * a cursor blink. Validating a 300-row product file against the real catalog, or
 * sweeping a quarter of orders for inconsistencies, is minutes of tool calls — so
 * it runs on the `ai-agent` queue and the person gets a notification when it lands.
 *
 * Two invariants make this safe to hand to an agent:
 *
 *  1. **Nothing applies in the background.** The worker has no bearer token, so
 *     every write refuses and every confirmation gate still fires. A task prepares
 *     and reports; approving what it found is a conversation.
 *  2. **The task inherits the authority of the moment it was queued**, snapshotted
 *     into the job. A role revoked afterwards does not retroactively widen it, and
 *     one granted afterwards does not silently extend it.
 */
@Injectable()
export class VexiTaskService {
  private readonly logger = new Logger(VexiTaskService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly queue: AIQueueService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Queues a task and returns the row the panel polls.
   *
   * The row is written BEFORE the job is added so a task can never exist in the
   * queue without a record the user can ask about. If the enqueue then fails, the
   * row is marked `failed` with the reason — visible and explainable, rather than a
   * task that silently never ran.
   */
  async enqueue(params: {
    goal: string;
    plan?: unknown;
    conversationId?: number;
    tools?: string[];
  }): Promise<TaskSnapshot> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const organizationId = context?.organization_id;
    const userId = context?.user_id;

    if (!storeId || !organizationId || !userId) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        'No hay contexto de tienda para dejar un trabajo en cola.',
      );
    }

    const goal = String(params.goal ?? '').trim();
    if (!goal) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        'Un trabajo de fondo necesita un objetivo concreto.',
      );
    }

    const active = await this.prisma.ai_agent_tasks.count({
      where: { user_id: userId, status: { in: ['queued', 'running'] } },
    });

    if (active >= MAX_ACTIVE_TASKS_PER_USER) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        'Ya tienes un trabajo en curso. Espera a que termine y te aviso, o dime si prefieres que lo cancele.',
      );
    }

    const task = await this.prisma.ai_agent_tasks.create({
      data: {
        store_id: storeId,
        organization_id: organizationId,
        user_id: userId,
        conversation_id: params.conversationId ?? null,
        goal: goal.slice(0, MAX_GOAL_CHARS),
        plan: (params.plan as any) ?? undefined,
        status: 'queued',
      },
      select: this.selection(),
    });

    try {
      const job = await this.queue.enqueueAgentTask({
        goal: task.goal,
        tools: params.tools,
        store_id: storeId,
        organization_id: organizationId,
        user_id: userId,
        conversation_id: params.conversationId,
        task_id: task.id,
        // Snapshotted, not re-resolved. See the class docblock.
        permissions: context?.permissions,
        roles: context?.roles,
        app_key: 'chat_assistant',
      });

      const updated = await this.prisma.ai_agent_tasks.update({
        where: { id: task.id },
        data: { job_id: job.id ? String(job.id) : null, status: 'running' },
        select: this.selection(),
      });

      return updated;
    } catch (error: any) {
      await this.prisma.ai_agent_tasks.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          error: `No se pudo encolar: ${error?.message ?? 'error desconocido'}`,
          finished_at: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Current state of a task, merging the row with the live job.
   *
   * The row is the durable record and the job is the live truth; they disagree in
   * one real window — between the worker finishing and the event listener writing
   * the row. Preferring the queue's own status in that window is what keeps the
   * panel from showing "en curso" on a task that already finished.
   */
  async get(id: number): Promise<TaskSnapshot & { live_status?: string }> {
    const task = await this.prisma.ai_agent_tasks.findFirst({
      where: { id },
      select: this.selection(),
    });

    if (!task) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        'Ese trabajo no existe o no pertenece a esta tienda.',
      );
    }

    if (!task.job_id) return task;

    try {
      const job = await this.queue.getJobStatus('ai-agent', task.job_id);
      return { ...task, live_status: job.status };
    } catch {
      // A completed job is trimmed from the queue after 50 more, so a missing job
      // is the normal end state, not an error worth surfacing.
      return task;
    }
  }

  /** The person's recent tasks, newest first, for the panel's task strip. */
  async listRecent(limit = 5): Promise<TaskSnapshot[]> {
    const userId = RequestContextService.getContext()?.user_id;
    if (!userId) return [];

    return this.prisma.ai_agent_tasks.findMany({
      where: { user_id: userId },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limit, 1), 20),
      select: this.selection(),
    });
  }

  /**
   * Closes the row and tells the person, from outside any request context.
   *
   * `GlobalPrismaService` rather than the scoped client on purpose: the worker
   * emitting this event runs with the context it restored itself, and by the time
   * the listener fires that scope may already be gone. The `store_id` from the
   * event is the tenant boundary here, and it came from the job, not from a client.
   *
   * `suppressErrors` is left at its default because this listener owns the tail of
   * the flow: nothing downstream reads its throw, and a notification that fails must
   * not retry the task.
   */
  @OnEvent('vexi.task.finished')
  async onTaskFinished(payload: {
    task_id?: number;
    store_id?: number;
    user_id?: number;
    goal: string;
    success: boolean;
    content?: string;
    error?: string;
  }): Promise<void> {
    if (payload.task_id) {
      try {
        await this.globalPrisma.ai_agent_tasks.update({
          where: { id: payload.task_id },
          data: {
            status: payload.success ? 'completed' : 'failed',
            result: payload.success
              ? ({ content: payload.content ?? '' } as any)
              : undefined,
            error: payload.success ? null : (payload.error ?? 'Error'),
            finished_at: new Date(),
          },
        });
      } catch (error: any) {
        this.logger.warn(
          `Could not close Vexi task ${payload.task_id}: ${error?.message}`,
        );
      }
    }

    if (!payload.store_id || !payload.user_id) return;

    await this.notifications.sendToUser(
      payload.store_id,
      payload.user_id,
      payload.success ? 'vexi_task_completed' : 'vexi_task_failed',
      payload.success ? 'Vexi terminó tu trabajo' : 'Vexi no pudo terminar',
      payload.success
        ? this.summarize(payload.content) || payload.goal
        : `${payload.goal} — ${payload.error ?? 'no se pudo completar'}`,
      { kind: 'vexi_task', task_id: payload.task_id },
    );
  }

  /** First sentence of the result, for the bell body. */
  private summarize(content?: string): string {
    const text = (content ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    const firstSentence = text.split(/(?<=[.!?])\s/)[0];
    return firstSentence.slice(0, 180);
  }

  private selection() {
    return {
      id: true,
      goal: true,
      status: true,
      job_id: true,
      result: true,
      error: true,
      created_at: true,
      finished_at: true,
    } as const;
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { REDIS_CLIENT } from '../../../../../common/redis/redis.module';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  CRM_TASK_DUE_NOTIFICATION,
  CRM_TASKS_ROUTE,
} from './crm-tasks.service';

/** Only tasks that fell due recently: a deploy never floods old reminders. */
export const CRM_TASK_DUE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CRM_TASK_DUE_BATCH = 200;
const DEDUP_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Notifies the assignee (or the creator when unassigned) once when a pending
 * CRM task falls due. Runs without a store context, so every row names its
 * store. Deduplicated in Redis by task and due instant: rescheduling a task
 * re-arms its reminder, and the API and the worker never notify twice.
 */
@Injectable()
export class CrmTaskDueJob {
  private readonly logger = new Logger(CrmTaskDueJob.name);
  private running = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * *')
  async handle(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.notifyDue(new Date());
    } catch (error) {
      this.logger.error(
        `CRM task due reminders failed: ${(error as Error)?.message}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  async notifyDue(now: Date): Promise<number> {
    const tasks = await this.prisma.crm_tasks.findMany({
      where: {
        status: 'pending',
        due_at: {
          gte: new Date(now.getTime() - CRM_TASK_DUE_LOOKBACK_MS),
          lte: now,
        },
      },
      select: {
        id: true,
        store_id: true,
        title: true,
        due_at: true,
        assigned_user_id: true,
        created_by_user_id: true,
      },
      orderBy: { due_at: 'asc' },
      take: CRM_TASK_DUE_BATCH,
    });

    let sent = 0;
    for (const task of tasks) {
      const recipient = task.assigned_user_id ?? task.created_by_user_id;
      if (!recipient || !task.due_at) continue;
      const key = `crm:task:due:${task.id}:${task.due_at.getTime()}`;
      const claimed = await this.redis.set(
        key,
        '1',
        'EX',
        DEDUP_TTL_SECONDS,
        'NX',
      );
      if (!claimed) continue;
      await this.notifications.sendToUser(
        task.store_id,
        recipient,
        CRM_TASK_DUE_NOTIFICATION,
        'Tarea vencida',
        task.title,
        { kind: 'crm_task', task_id: task.id, url: CRM_TASKS_ROUTE },
      );
      sent++;
    }
    return sent;
  }
}

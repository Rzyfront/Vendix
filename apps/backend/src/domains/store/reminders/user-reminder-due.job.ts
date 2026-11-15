import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REMINDER_DUE_NOTIFICATION,
  REMINDERS_ROUTE,
} from './reminders.service';

/** Only reminders that fell due recently: a deploy never floods old ones. */
export const REMINDER_DUE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const REMINDER_DUE_BATCH = 200;

/**
 * QUI-580 — notifies the OWNER of a pending reminder once, when it falls due.
 * Runs without a store context (like `CrmTaskDueJob`), so every row names its
 * store and its user, and the notification is targeted with `sendToUser` to
 * exactly that store and user: never a store-wide broadcast.
 *
 * "Once" lives in the database: the row is claimed by setting `notified_at`
 * only while it is still null, so the API and the worker never notify twice.
 * Changing `remind_at` clears `notified_at` and re-arms it. A failed send
 * releases the claim so the next run retries it.
 */
@Injectable()
export class UserReminderDueJob {
  private readonly logger = new Logger(UserReminderDueJob.name);
  private running = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('* * * * *')
  async handle(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.notifyDue(new Date());
    } catch (error) {
      this.logger.error(
        `Reminder due notifications failed: ${(error as Error)?.message}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  async notifyDue(now: Date): Promise<number> {
    const due = await this.prisma.user_reminders.findMany({
      where: {
        status: 'pending',
        notified_at: null,
        remind_at: {
          gte: new Date(now.getTime() - REMINDER_DUE_LOOKBACK_MS),
          lte: now,
        },
      },
      select: {
        id: true,
        store_id: true,
        user_id: true,
        title: true,
        link_label: true,
      },
      orderBy: { remind_at: 'asc' },
      take: REMINDER_DUE_BATCH,
    });

    let sent = 0;
    for (const reminder of due) {
      const claimed = await this.prisma.user_reminders.updateMany({
        where: { id: reminder.id, status: 'pending', notified_at: null },
        data: { notified_at: now },
      });
      if (claimed.count !== 1) continue;
      const notification = await this.notifications.sendToUser(
        reminder.store_id,
        reminder.user_id,
        REMINDER_DUE_NOTIFICATION,
        'Recordatorio',
        reminder.link_label
          ? `${reminder.title} · ${reminder.link_label}`
          : reminder.title,
        { kind: 'user_reminder', reminder_id: reminder.id, url: REMINDERS_ROUTE },
      );
      if (!notification) {
        // `sendToUser` swallows its errors and answers null: release this
        // run's claim (only if still ours) so the next run retries it.
        await this.prisma.user_reminders.updateMany({
          where: { id: reminder.id, notified_at: now },
          data: { notified_at: null },
        });
        this.logger.warn(
          `Reminder ${reminder.id} due notification failed; will retry`,
        );
        continue;
      }
      sent++;
    }
    return sent;
  }
}

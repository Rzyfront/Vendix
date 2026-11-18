import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailService } from '../../../email/email.service';
import { buildReminderDueEmail } from '../../../email/templates/reminder-due-email.template';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  formatStoreDate,
  formatStoreTime,
  resolveStoreTimezone,
} from '../../../common/utils/store-timezone.util';
import { NotificationsService } from '../notifications/notifications.service';
import { ReminderLinkType } from './dto/reminders.dto';
import {
  canOpenLink,
  findLinkedRecords,
  linkKey,
  linkRoute,
  linkTypeLabel,
  loadUserLinkAccess,
} from './reminder-links';
import {
  REMINDER_DUE_NOTIFICATION,
  REMINDERS_ROUTE,
} from './reminders.service';

/** Only reminders that fell due recently: a deploy never floods old ones. */
export const REMINDER_DUE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const REMINDER_DUE_BATCH = 200;

interface DueReminder {
  id: number;
  store_id: number;
  user_id: number;
  title: string;
  note: string | null;
  remind_at: Date | null;
  link_type: string | null;
  link_id: number | null;
  link_label: string | null;
}

/** Where the notice (bell, push and e-mail) takes the user. */
interface NoticeTarget {
  /** Admin route: the linked record, or the Bitácora. */
  url: string;
  opensRecord: boolean;
}

/**
 * QUI-580 — notifies the OWNER of a pending reminder once, when it falls due:
 * in Vendix (bell + web push, via `sendToUser`) and by e-mail. Runs without a
 * store context (like `CrmTaskDueJob`), so every row names its store and its
 * user, and every lookup carries that store explicitly: never a store-wide
 * broadcast.
 *
 * "Once" lives in the database: the row is claimed by setting `notified_at`
 * only while it is still null, so the API and the worker never notify twice.
 * Changing `remind_at` clears `notified_at` and re-arms it. A failed in-app
 * send releases the claim so the next run retries it; the e-mail goes out only
 * after the in-app notice did, and a failed e-mail is logged, not retried
 * (retrying would repeat the in-app notice).
 *
 * The notice opens the linked record when it still exists in the store and
 * the owner may read its module; otherwise it opens the Bitácora.
 */
@Injectable()
export class UserReminderDueJob {
  private readonly logger = new Logger(UserReminderDueJob.name);
  private running = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
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
    const due: DueReminder[] = await this.prisma.user_reminders.findMany({
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
        note: true,
        remind_at: true,
        link_type: true,
        link_id: true,
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
      const target = await this.target(reminder);
      const notification = await this.notifications.sendToUser(
        reminder.store_id,
        reminder.user_id,
        REMINDER_DUE_NOTIFICATION,
        'Recordatorio',
        reminder.link_label
          ? `${reminder.title} · ${reminder.link_label}`
          : reminder.title,
        { kind: 'user_reminder', reminder_id: reminder.id, url: target.url },
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
      await this.sendEmail(reminder, target);
    }
    return sent;
  }

  /**
   * The linked record's route when it still exists in the reminder's store and
   * the owner may read it; the Bitácora otherwise (also on any lookup error:
   * the notice must still go out).
   */
  private async target(reminder: DueReminder): Promise<NoticeTarget> {
    const bitacora: NoticeTarget = { url: REMINDERS_ROUTE, opensRecord: false };
    const type = reminder.link_type as ReminderLinkType | null;
    if (!type) return bitacora;
    try {
      const access = await loadUserLinkAccess(this.prisma, reminder.user_id, reminder.store_id);
      if (!canOpenLink(type, access)) return bitacora;
      if (type !== 'metric') {
        const store = await this.prisma.stores.findUnique({
          where: { id: reminder.store_id },
          select: { organization_id: true },
        });
        const existing = await findLinkedRecords(
          this.prisma,
          { store_id: reminder.store_id, organization_id: store?.organization_id ?? null },
          [{ type, id: reminder.link_id }],
        );
        if (!reminder.link_id || !existing.has(linkKey(type, reminder.link_id))) {
          return bitacora;
        }
      }
      const url = linkRoute(type, reminder.link_id);
      return url ? { url, opensRecord: true } : bitacora;
    } catch (error) {
      this.logger.warn(
        `Reminder ${reminder.id} link could not be resolved; opening the Bitácora: ${(error as Error)?.message}`,
      );
      return bitacora;
    }
  }

  /** E-mail to the owner, at most once (the row is already claimed). Never throws. */
  private async sendEmail(reminder: DueReminder, target: NoticeTarget): Promise<void> {
    try {
      const [user, store, adminDomain] = await Promise.all([
        this.prisma.users.findUnique({
          where: { id: reminder.user_id },
          select: { email: true, first_name: true },
        }),
        this.prisma.stores.findUnique({
          where: { id: reminder.store_id },
          select: { name: true },
        }),
        this.prisma.domain_settings.findFirst({
          where: { store_id: reminder.store_id, app_type: 'STORE_ADMIN', status: 'active' },
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          select: { hostname: true },
        }),
      ]);
      if (!user?.email) return;

      let when: string | null = null;
      if (reminder.remind_at) {
        // No store context here: the explicit store id is the only scope
        // `resolveStoreTimezone` needs (same as tenant-activity.service).
        const tz = await resolveStoreTimezone(
          this.prisma as unknown as StorePrismaService,
          reminder.store_id,
        );
        when = `${formatStoreDate(reminder.remind_at, tz)} ${formatStoreTime(reminder.remind_at, tz)}`;
      }
      const type = reminder.link_type as ReminderLinkType | null;
      const message = buildReminderDueEmail({
        firstName: user.first_name,
        storeName: store?.name ?? null,
        title: reminder.title,
        note: reminder.note,
        when,
        link:
          type && reminder.link_label
            ? {
                typeLabel: linkTypeLabel(type),
                label: reminder.link_label,
                available: target.opensRecord,
              }
            : null,
        actionUrl: adminDomain?.hostname
          ? `https://${adminDomain.hostname}${target.url}`
          : null,
        opensRecord: target.opensRecord,
      });
      const result = await this.email.sendEmail(
        user.email,
        message.subject,
        message.html,
        message.text,
      );
      if (!result.success) {
        this.logger.warn(
          `Reminder ${reminder.id} due e-mail failed (not retried): ${result.error}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Reminder ${reminder.id} due e-mail failed (not retried): ${(error as Error)?.message}`,
      );
    }
  }
}

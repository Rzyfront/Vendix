import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import {
  formatStoreTime,
  localDateString,
  zonedWallClockToUtc,
  localCivil,
} from '../../../../../common/utils/store-timezone.util';
import { NotifyInput } from '../../../notifications/notification-dispatcher.service';
import { NotificationPreferencesService } from '../../../notifications/notification-preferences.service';
import {
  MAX_TASK_DUE_SOON_MINUTES,
  readStoreReminderSettings,
} from '../../../notifications/reminders/reminder-settings';
import {
  OVERDUE_ESCALATION_DELAY_MS,
  digestInstantFor,
  digestSourceType,
} from '../../../notifications/reminders/reminder-scheduler.service';
import {
  ClaimedReminder,
  ReminderResolution,
  ReminderSourceHandler,
} from '../../../notifications/reminders/reminder-source.registry';
import {
  CRM_TASK_DIGEST_NOTIFICATION,
  CRM_TASK_DUE_NOTIFICATION,
  CRM_TASK_DUE_SOON_NOTIFICATION,
  CRM_TASK_REMINDER_SOURCE,
  CRM_TASKS_ROUTE,
  crmTaskCustomerSuffix,
  crmTaskData,
  crmTaskReminderRecipients,
} from './crm-task-notifications';

export const CRM_TASK_DIGEST_SOURCE = digestSourceType(CRM_TASK_REMINDER_SOURCE);
/** Tareas que lista un resumen; el resto se cuenta. */
export const CRM_TASK_DIGEST_MAX_ITEMS = 15;

const CUSTOMER_SELECT = { select: { first_name: true, last_name: true } } as const;

const skip = (reason: string): ReminderResolution => ({ action: 'skip', reason });

/**
 * Relee la tarea al disparar un recordatorio (`ScheduledRemindersJob`) y arma
 * el aviso. Corre sin contexto: la tarea se busca por id Y tienda de la fila,
 * así un recordatorio nunca lee ni avisa algo de otra tienda. Los
 * destinatarios se resuelven de nuevo con la tarea actual; el despachador
 * descarta a quien ya no es personal activo de esa tienda.
 */
@Injectable()
export class CrmTaskReminderSource implements ReminderSourceHandler {
  readonly source_types = [CRM_TASK_REMINDER_SOURCE, CRM_TASK_DIGEST_SOURCE] as const;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  resolve(reminder: ClaimedReminder, now: Date): Promise<ReminderResolution> {
    return reminder.source_type === CRM_TASK_DIGEST_SOURCE
      ? this.resolveDigest(reminder)
      : this.resolveTask(reminder, now);
  }

  private async resolveTask(
    reminder: ClaimedReminder,
    now: Date,
  ): Promise<ReminderResolution> {
    const task = await this.prisma.crm_tasks.findFirst({
      where: { id: reminder.source_id, store_id: reminder.store_id },
      select: {
        id: true,
        title: true,
        status: true,
        due_at: true,
        assigned_user_id: true,
        created_by_user_id: true,
        customer: CUSTOMER_SELECT,
        supporters: { select: { user_id: true } },
      },
    });
    if (!task) return skip('Task no longer exists');
    if (task.status !== 'pending') return skip(`Task is ${task.status}`);
    if (!task.due_at) return skip('Task has no due date');
    if (!firesForDueAt(reminder, task.due_at, now)) return skip('Due date changed');

    const recipients = crmTaskReminderRecipients({
      assigned_user_id: task.assigned_user_id,
      created_by_user_id: task.created_by_user_id,
      supporter_ids: task.supporters.map((row) => row.user_id),
    });
    const user_ids =
      reminder.kind === 'overdue_escalation' ? recipients.escalate : recipients.notify;
    if (user_ids.length === 0) return skip('No recipients');

    const suffix = crmTaskCustomerSuffix(task.customer);
    let title: string;
    let body: string;
    let type: string;
    if (reminder.kind === 'due_soon') {
      const { timezone } = await readStoreReminderSettings(this.prisma, reminder.store_id);
      type = CRM_TASK_DUE_SOON_NOTIFICATION;
      title = 'Tarea por vencer';
      body = `${task.title}${suffix} · vence a las ${formatStoreTime(task.due_at, timezone)}`;
    } else if (reminder.kind === 'overdue_escalation') {
      type = CRM_TASK_DUE_NOTIFICATION;
      title = 'Tarea vencida hace 24 h';
      body = `Sigue sin completarse: ${task.title}${suffix}`;
    } else {
      type = CRM_TASK_DUE_NOTIFICATION;
      title = 'Tarea vencida';
      body = `${task.title}${suffix}`;
    }

    return {
      action: 'notify',
      notifications: [
        {
          store_id: reminder.store_id,
          user_ids,
          type,
          title,
          body,
          data: crmTaskData(task.id, { reminder: reminder.kind }),
          dedupe_key: `${CRM_TASK_REMINDER_SOURCE}:${task.id}:${reminder.kind}:${reminder.fire_at.toISOString()}`,
        },
      ],
    };
  }

  /**
   * Resumen de la mañana: un solo aviso por persona con sus tareas pendientes
   * que vencen ese día local (responsable; sin responsable, el creador). Es
   * solo correo (D1): llega únicamente a quien encendió el correo de
   * "Resumen diario de tareas"; a los demás no les deja ni la campana. A
   * quien sí lo recibe, el despachador le deja además su fila en la campana
   * como historial del envío (sin push: el tipo no tiene canal push).
   * Idempotente por persona + tienda + fecha (`dedupe_key` del correo).
   */
  private async resolveDigest(reminder: ClaimedReminder): Promise<ReminderResolution> {
    const store_id = reminder.store_id;
    const settings = await readStoreReminderSettings(this.prisma, store_id);
    // La tienda cambió la hora o la zona después de programarlo: este ya no
    // es SU resumen (el correcto se programa con la próxima tarea del día).
    if (digestInstantFor(reminder.fire_at, settings).getTime() !== reminder.fire_at.getTime()) {
      return skip('Digest hour or timezone changed');
    }
    const day = localCivil(reminder.fire_at, settings.timezone);
    const dayStart = zonedWallClockToUtc(day.year, day.month, day.day, 0, 0, 0, 0, settings.timezone);
    const nextDayStart = zonedWallClockToUtc(
      day.year,
      day.month,
      day.day + 1,
      0,
      0,
      0,
      0,
      settings.timezone,
    );

    const tasks = await this.prisma.crm_tasks.findMany({
      where: { store_id, status: 'pending', due_at: { gte: dayStart, lt: nextDayStart } },
      select: {
        id: true,
        title: true,
        due_at: true,
        assigned_user_id: true,
        created_by_user_id: true,
        customer: CUSTOMER_SELECT,
      },
      orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
    const byUser = new Map<number, typeof tasks>();
    for (const task of tasks) {
      const owner = task.assigned_user_id ?? task.created_by_user_id;
      if (!owner) continue;
      byUser.set(owner, [...(byUser.get(owner) ?? []), task]);
    }
    if (byUser.size === 0) return skip('No tasks due that day');

    const prefs = await this.preferences.resolveForUsers(
      store_id,
      [...byUser.keys()],
      CRM_TASK_DIGEST_NOTIFICATION,
    );
    const date = localDateString(reminder.fire_at, settings.timezone);
    const notifications: NotifyInput[] = [];
    for (const [user_id, own] of byUser) {
      if (!prefs.get(user_id)?.email) continue;
      notifications.push({
        store_id,
        user_ids: [user_id],
        type: CRM_TASK_DIGEST_NOTIFICATION,
        title: 'Tus tareas de hoy',
        body: digestBody(own, settings.timezone),
        data: { kind: 'crm_task_digest', date, url: CRM_TASKS_ROUTE },
        dedupe_key: `${CRM_TASK_DIGEST_SOURCE}:${date}`,
      });
    }
    if (notifications.length === 0) return skip('Nobody turned on the digest e-mail');
    return { action: 'notify', notifications };
  }
}

/**
 * El recordatorio sigue correspondiendo a la fecha actual de la tarea. `sync`
 * ya cancela lo re-fechado; esto es la red de seguridad del cron.
 */
function firesForDueAt(reminder: ClaimedReminder, due_at: Date, now: Date): boolean {
  const due = due_at.getTime();
  const fire = reminder.fire_at.getTime();
  switch (reminder.kind) {
    case 'due':
      return fire === due;
    case 'overdue_escalation':
      return fire === due + OVERDUE_ESCALATION_DELAY_MS;
    case 'due_soon':
      // Antes de la fecha, dentro de la anticipación máxima, y aún no vencida
      // (si ya venció, el aviso que corresponde es "vencida").
      return fire < due && due - fire <= MAX_TASK_DUE_SOON_MINUTES * 60_000 && due > now.getTime();
    default:
      return false;
  }
}

function digestBody(
  tasks: Array<{
    title: string;
    due_at: Date | null;
    customer: { first_name: string | null; last_name: string | null } | null;
  }>,
  tz: string,
): string {
  const header =
    tasks.length === 1 ? 'Hoy vence 1 tarea:' : `Hoy vencen ${tasks.length} tareas:`;
  const lines = tasks
    .slice(0, CRM_TASK_DIGEST_MAX_ITEMS)
    .map(
      (task) =>
        `• ${task.due_at ? `${formatStoreTime(task.due_at, tz)} · ` : ''}${task.title}${crmTaskCustomerSuffix(task.customer)}`,
    );
  const rest = tasks.length - CRM_TASK_DIGEST_MAX_ITEMS;
  if (rest > 0) lines.push(`y ${rest} más.`);
  return [header, ...lines].join('\n');
}

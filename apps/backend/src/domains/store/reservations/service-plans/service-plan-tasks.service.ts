import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { ReminderScheduler } from '../../notifications/reminders/reminder-scheduler.service';
import { NotificationDispatcher } from '../../notifications/notification-dispatcher.service';
import {
  CRM_TASK_ASSIGNED_NOTIFICATION,
  CRM_TASK_REMINDER_SOURCE,
  crmTaskData,
  crmTaskReminderRecipients,
} from '../../customers/crm/tasks/crm-task-notifications';
import { isPlanProduct } from './service-plan-pricing.util';
import {
  activityDate,
  activityStartsAt,
  buildPlanTaskContent,
  planTaskDueAt,
  planTaskKind,
  replacePlanTaskDateLine,
  supplierContactLine,
  type PlanTaskKind,
} from './service-plan-tasks.util';

/** Estados en los que la reserva está vendida: sus actividades llevan tarea. */
const SOLD_STATUSES = new Set(['confirmed', 'arriving', 'attending', 'in_progress']);

/** Fila de «Tareas del plan» en el detalle de la reserva. */
export interface PlanBookingTask {
  link_id: number;
  task_id: number | null;
  activity_id: number | null;
  day_number: number | null;
  kind: PlanTaskKind;
  title: string;
  status: 'pending' | 'done' | 'cancelled' | null;
  due_at: string | null;
  assigned_user: { id: number; first_name: string | null; last_name: string | null } | null;
}

export interface PlanTasksSyncResult {
  created: number;
  rescheduled: number;
  cancelled: number;
}

type BookingRow = {
  id: number;
  store_id: number;
  booking_number: string;
  date: Date;
  status: string;
  customer_id: number | null;
  created_by_user_id: number | null;
  product: {
    id: number;
    name: string | null;
    service_pricing_type: string | null;
    plan_duration_days: number | null;
  } | null;
};

type ActivityRow = {
  id: number;
  day_number: number;
  start_time: string | null;
  title: string;
  provider_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  creates_task: boolean;
};

const TASK_PEOPLE_SELECT = {
  id: true,
  store_id: true,
  status: true,
  due_at: true,
  description: true,
  assigned_user_id: true,
  created_by_user_id: true,
  supporters: { select: { user_id: true } },
} as const;

type TaskPeopleRow = Prisma.crm_tasksGetPayload<{ select: typeof TASK_PEOPLE_SELECT }>;

/**
 * QUI-1060 F3 · Actividades del plan → tareas del CRM. `syncBooking` es idempotente
 * y decide por el estado actual de la reserva: vendida → crea las tareas que falten
 * (una por actividad con «Crear tarea al vender», vía `service_plan_booking_tasks`)
 * y recalcula el vencimiento de las pendientes; cancelada → cancela las pendientes.
 * Las completadas nunca se tocan. Reservas que no son de un plan: nada.
 */
@Injectable()
export class ServicePlanTasksService {
  private readonly logger = new Logger(ServicePlanTasksService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    @Optional() private readonly reminders?: ReminderScheduler,
    @Optional() private readonly dispatcher?: NotificationDispatcher,
  ) {}

  async syncBooking(
    bookingId: number,
    actorUserId: number | null = null,
    now: Date = new Date(),
  ): Promise<PlanTasksSyncResult> {
    const result: PlanTasksSyncResult = { created: 0, rescheduled: 0, cancelled: 0 };
    const booking = await this.findBooking(bookingId);
    if (!booking?.product || !isPlanProduct(booking.product)) return result;

    if (booking.status === 'cancelled') {
      result.cancelled = await this.cancelPending(booking, now);
      return result;
    }
    if (!SOLD_STATUSES.has(booking.status)) return result;

    const tz = await resolveStoreTimezone(this.prisma, booking.store_id);
    const startDate = this.dateOnly(booking.date);
    const days = booking.product.plan_duration_days as number;
    const activities = (await this.prisma.service_plan_activities.findMany({
      where: { store_id: booking.store_id, product_id: booking.product.id },
      select: {
        id: true,
        day_number: true,
        start_time: true,
        title: true,
        provider_id: true,
        supplier_id: true,
        supplier_name: true,
        supplier_contact: true,
        creates_task: true,
      },
    })) as ActivityRow[];
    const inPlan = activities.filter((a) => a.day_number >= 1 && a.day_number <= days);

    result.rescheduled = await this.reschedulePending(booking, inPlan, startDate, tz, now);

    const links = await this.prisma.service_plan_booking_tasks.findMany({
      where: { store_id: booking.store_id, booking_id: booking.id },
      select: { activity_id: true },
    });
    const linked = new Set(links.map((l) => l.activity_id));
    for (const activity of inPlan) {
      if (!activity.creates_task || linked.has(activity.id)) continue;
      if (await this.createTask(booking, activity, startDate, tz, actorUserId, now)) result.created++;
    }
    return result;
  }

  /** Tareas generadas para una reserva; null si la reserva no es de un plan. */
  async listForBooking(bookingId: number): Promise<PlanBookingTask[] | null> {
    const booking = await this.findBooking(bookingId);
    if (!booking) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_026);
    if (!booking.product || !isPlanProduct(booking.product)) return null;
    const links = await this.prisma.service_plan_booking_tasks.findMany({
      where: { store_id: booking.store_id, booking_id: booking.id },
      select: {
        id: true,
        activity_id: true,
        crm_task_id: true,
        activity: { select: { day_number: true, provider_id: true, supplier_id: true, supplier_name: true } },
        crm_task: {
          select: {
            id: true,
            title: true,
            status: true,
            due_at: true,
            assigned_user: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });
    const rows: PlanBookingTask[] = links.map((l) => ({
      link_id: l.id,
      task_id: l.crm_task?.id ?? null,
      activity_id: l.activity_id,
      day_number: l.activity?.day_number ?? null,
      kind: l.activity
        ? planTaskKind(l.activity)
        : l.crm_task?.title.startsWith('Confirmar con proveedor') ? 'supplier' : 'none',
      title: l.crm_task?.title ?? 'Tarea eliminada',
      status: l.crm_task?.status ?? null,
      due_at: l.crm_task?.due_at ? l.crm_task.due_at.toISOString() : null,
      assigned_user: l.crm_task?.assigned_user ?? null,
    }));
    return rows.sort(
      (a, b) =>
        (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || (a.day_number ?? 0) - (b.day_number ?? 0) || a.link_id - b.link_id,
    );
  }

  // ---------------------------------------------------------------------------

  private async findBooking(bookingId: number): Promise<BookingRow | null> {
    return (await this.prisma.bookings.findFirst({
      where: { id: bookingId },
      select: {
        id: true,
        store_id: true,
        booking_number: true,
        date: true,
        status: true,
        customer_id: true,
        created_by_user_id: true,
        product: {
          select: { id: true, name: true, service_pricing_type: true, plan_duration_days: true },
        },
      },
    })) as BookingRow | null;
  }

  /**
   * Una tarea + su enlace en la misma transacción. Si otra confirmación ganó la
   * carrera, el UNIQUE (booking_id, activity_id) aborta esta y no se duplica.
   */
  private async createTask(
    booking: BookingRow,
    activity: ActivityRow,
    startDate: string,
    tz: string,
    actorUserId: number | null,
    now: Date,
  ): Promise<boolean> {
    const kind = planTaskKind(activity);
    const owner = await this.resolveOwner(booking, activity, kind);
    const date = activityDate(startDate, activity.day_number);
    const startsAt = activityStartsAt(startDate, activity.day_number, activity.start_time, tz);
    const content = buildPlanTaskContent({
      kind,
      activityTitle: activity.title,
      dayNumber: activity.day_number,
      date,
      startTime: activity.start_time,
      planName: booking.product?.name ?? 'Plan',
      bookingNumber: booking.booking_number,
      supplierName: owner.supplierName,
      supplierContact: owner.supplierContact,
      providerName: owner.providerName,
      providerWithoutUser: owner.providerWithoutUser,
    });
    let task: TaskPeopleRow;
    try {
      task = await this.prisma.$transaction(async (tx) => {
        const created = await tx.crm_tasks.create({
          data: {
            store_id: booking.store_id,
            title: content.title,
            description: content.description,
            due_at: planTaskDueAt(kind, startsAt, now),
            assigned_user_id: owner.assignedUserId,
            created_by_user_id: actorUserId,
            customer_id: booking.customer_id,
          },
          select: TASK_PEOPLE_SELECT,
        });
        await tx.service_plan_booking_tasks.create({
          data: {
            store_id: booking.store_id,
            booking_id: booking.id,
            activity_id: activity.id,
            crm_task_id: created.id,
            created_at: now,
            updated_at: now,
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    await this.afterWrite(task);
    await this.notifyAssigned(task, content.title, actorUserId);
    return true;
  }

  /** Interno → usuario del prestador; tercero → quien creó la reserva; si no, sin asignar. */
  private async resolveOwner(booking: BookingRow, activity: ActivityRow, kind: PlanTaskKind) {
    const owner = {
      assignedUserId: null as number | null,
      providerName: null as string | null,
      providerWithoutUser: false,
      supplierName: activity.supplier_name,
      supplierContact: activity.supplier_contact,
    };
    if (kind === 'internal') {
      const provider = await this.prisma.service_providers.findFirst({
        where: { id: activity.provider_id as number, store_id: booking.store_id },
        select: {
          user_id: true,
          display_name: true,
          user: { select: { first_name: true, last_name: true } },
          employee: { select: { first_name: true, last_name: true } },
        },
      });
      const person = provider?.user ?? provider?.employee ?? null;
      owner.providerName =
        provider?.display_name?.trim() ||
        [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim() ||
        null;
      owner.assignedUserId = provider?.user_id ?? null;
      owner.providerWithoutUser = owner.assignedUserId == null;
    } else if (kind === 'supplier') {
      owner.assignedUserId = booking.created_by_user_id ?? null;
      if (activity.supplier_id != null) {
        // La ficha viva del proveedor manda; la copia del itinerario es el respaldo.
        const supplier = await this.prisma.suppliers.findFirst({
          where: { id: activity.supplier_id },
          select: { name: true, contact_person: true, mobile: true, phone: true, email: true },
        });
        if (supplier) {
          owner.supplierName = supplier.name;
          owner.supplierContact = supplierContactLine(supplier) ?? activity.supplier_contact;
        }
      }
    }
    return owner;
  }

  /** Recalcula vencimiento y línea de fecha de las pendientes cuya actividad sigue en el plan. */
  private async reschedulePending(
    booking: BookingRow,
    activities: ActivityRow[],
    startDate: string,
    tz: string,
    now: Date,
  ): Promise<number> {
    const byId = new Map(activities.map((a) => [a.id, a]));
    const links = await this.prisma.service_plan_booking_tasks.findMany({
      where: { store_id: booking.store_id, booking_id: booking.id, crm_task_id: { not: null } },
      select: { activity_id: true, crm_task: { select: TASK_PEOPLE_SELECT } },
    });
    let changed = 0;
    for (const link of links) {
      const task = link.crm_task;
      const activity = link.activity_id != null ? byId.get(link.activity_id) : undefined;
      if (!task || task.status !== 'pending' || !activity) continue;
      const startsAt = activityStartsAt(startDate, activity.day_number, activity.start_time, tz);
      const due = planTaskDueAt(planTaskKind(activity), startsAt, now);
      // Un tercero cuya confirmación ya venció no se corre a «ahora» en cada reintento.
      const sameDue = task.due_at?.getTime() === due.getTime();
      const alreadyDueSupplier =
        planTaskKind(activity) === 'supplier' && due.getTime() === now.getTime() && task.due_at != null && task.due_at <= now;
      if (sameDue || alreadyDueSupplier) continue;
      const description =
        replacePlanTaskDateLine(task.description, activityDate(startDate, activity.day_number), activity.start_time) ??
        task.description;
      const { count } = await this.prisma.crm_tasks.updateMany({
        where: { id: task.id, store_id: booking.store_id, status: 'pending' },
        data: { due_at: due, description },
      });
      if (count === 1) {
        changed++;
        await this.afterWrite({ ...task, due_at: due });
      }
    }
    return changed;
  }

  private async cancelPending(booking: BookingRow, now: Date): Promise<number> {
    const links = await this.prisma.service_plan_booking_tasks.findMany({
      where: { store_id: booking.store_id, booking_id: booking.id, crm_task_id: { not: null } },
      select: { crm_task: { select: TASK_PEOPLE_SELECT } },
    });
    let cancelled = 0;
    for (const { crm_task: task } of links) {
      if (!task || task.status !== 'pending') continue;
      // Condicional: una tarea completada entre la lectura y aquí no se toca.
      const { count } = await this.prisma.crm_tasks.updateMany({
        where: { id: task.id, store_id: booking.store_id, status: 'pending' },
        data: { status: 'cancelled', completed_at: now },
      });
      if (count === 1) {
        cancelled++;
        await this.afterWrite({ ...task, status: 'cancelled' });
      }
    }
    return cancelled;
  }

  /** Recordatorios de la tarea, como los replanifica el CRM. Nunca deshace la escritura. */
  private async afterWrite(task: TaskPeopleRow): Promise<void> {
    if (!this.reminders) return;
    try {
      await this.reminders.sync({
        source_type: CRM_TASK_REMINDER_SOURCE,
        source_id: task.id,
        store_id: task.store_id,
        due_at: task.due_at,
        status: task.status,
        recipients: crmTaskReminderRecipients({
          assigned_user_id: task.assigned_user_id,
          created_by_user_id: task.created_by_user_id,
          supporter_ids: task.supporters.map((s) => s.user_id),
        }),
        digest: true,
      });
    } catch (error) {
      this.logger.error(
        `Plan task ${task.id}: reminders not synced: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Aviso «Nueva tarea asignada» al responsable, salvo a quien confirmó. */
  private async notifyAssigned(task: TaskPeopleRow, title: string, actorUserId: number | null): Promise<void> {
    if (!this.dispatcher || !task.assigned_user_id || task.assigned_user_id === actorUserId) return;
    try {
      await this.dispatcher.notify({
        store_id: task.store_id,
        user_ids: [task.assigned_user_id],
        type: CRM_TASK_ASSIGNED_NOTIFICATION,
        title: 'Nueva tarea asignada',
        body: title,
        data: crmTaskData(task.id),
      });
    } catch (error) {
      this.logger.error(
        `Plan task ${task.id}: assignee not notified: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private dateOnly(value: Date | string): string {
    return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '../../../common/utils/store-timezone.util';
import {
  FulfillmentAvailabilityService,
  SchedulingReader,
} from './fulfillment-availability.service';

export type FulfillmentStatus =
  | 'scheduled'
  | 'in_production'
  | 'ready'
  | 'delivered'
  | 'no_show'
  | 'cancelled';

export type FulfillmentType = 'pickup' | 'delivery';

/** Bloque opcional `schedule` que reciben POS y checkout. */
export interface ScheduleInput {
  start: string | Date;
  end: string | Date;
  fulfillment_type?: FulfillmentType;
  notes?: string;
}

/**
 * Transiciones permitidas del ciclo de cumplimiento. `no_show` solo desde
 * `ready` y con la franja ya vencida; `cancelled` antes de `delivered`.
 */
export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  scheduled: ['in_production', 'cancelled'],
  in_production: ['ready', 'cancelled'],
  ready: ['delivered', 'no_show', 'cancelled'],
  delivered: [],
  no_show: [],
  cancelled: [],
};

/** Espacio de nombres del advisory lock (primer int4) para el cupo por tienda. */
const SCHEDULE_LOCK_NAMESPACE = 734_210;

/** Cliente de transacción: el `tx` del cliente base (sin scoping automático). */
type Tx = Prisma.TransactionClient;

/**
 * Gancho que S4 registra para consumir inventario al iniciar producción.
 * Puede devolver una acción a ejecutar tras el commit (asiento contable).
 */
export type ProductionStartHook = (
  tx: Tx,
  schedule: { id: number; store_id: number; order_id: number },
) => Promise<void | (() => void)>;

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new VendixHttpException(ErrorCodes.SCHED_OUT_OF_HOURS);
  }
  return date;
}

@Injectable()
export class ScheduledOrdersService {
  private readonly logger = new Logger(ScheduledOrdersService.name);
  private productionStartHook: ProductionStartHook | null = null;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly availability: FulfillmentAvailabilityService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  registerProductionStartHook(hook: ProductionStartHook) {
    this.productionStartHook = hook;
  }

  private context() {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return { store_id: ctx.store_id, user_id: ctx.user_id ?? null };
  }

  /**
   * Serializa la toma de cupo por tienda dentro de la transacción: dos ventas
   * simultáneas por el último cupo se ejecutan una tras otra, y la segunda ve
   * la franja llena. Se libera solo al terminar la transacción.
   */
  async lockStoreSchedule(tx: Tx, store_id: number) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_NAMESPACE}::int, ${store_id}::int)`;
  }

  /**
   * Validación previa SIN bloqueo (falla temprano en el checkout, antes de
   * crear la orden). La validación definitiva es `createForOrder`.
   */
  async preValidate(store_id: number, schedule: ScheduleInput, now = new Date()) {
    const config = await this.availability.getEnabledConfig(store_id);
    if (!config.fulfillment_types.includes(schedule.fulfillment_type ?? 'pickup')) {
      throw new VendixHttpException(ErrorCodes.SCHED_FULFILLMENT_TYPE);
    }
    await this.availability.assertSlotAvailable(store_id, toDate(schedule.start), toDate(schedule.end), { now });
  }

  /**
   * Crea el agendamiento de una orden dentro de la MISMA transacción que la
   * crea. Valida en el servidor ajuste activo, tipo de cumplimiento, día,
   * anticipación y cupo. v1 sin hold con expiración: el cupo queda tomado con
   * la orden y se libera cuando la orden se cancela (`cancelForOrder`).
   */
  async createForOrder(
    tx: Tx,
    params: {
      store_id: number;
      order_id: number;
      schedule: ScheduleInput;
      user_id?: number | null;
      now?: Date;
    },
  ) {
    const { store_id, order_id, schedule } = params;
    const config = await this.availability.getEnabledConfig(store_id);
    const fulfillment_type = schedule.fulfillment_type ?? 'pickup';
    if (!config.fulfillment_types.includes(fulfillment_type)) {
      throw new VendixHttpException(ErrorCodes.SCHED_FULFILLMENT_TYPE);
    }

    const start = toDate(schedule.start);
    const end = toDate(schedule.end);
    const now = params.now ?? new Date();

    await this.lockStoreSchedule(tx, store_id);

    const existing = await tx.order_fulfillment_schedules.findUnique({
      where: { order_id },
    });
    if (existing) throw new VendixHttpException(ErrorCodes.SCHED_ALREADY_SCHEDULED);

    await this.availability.assertSlotAvailable(store_id, start, end, {
      now,
      client: tx as unknown as SchedulingReader,
    });

    const created = await tx.order_fulfillment_schedules.create({
      data: {
        store_id,
        order_id,
        scheduled_start: start,
        scheduled_end: end,
        fulfillment_type,
        status: 'scheduled',
        notes: schedule.notes ?? null,
        created_by_user_id: params.user_id ?? null,
      },
    });

    await tx.order_fulfillment_changes.create({
      data: {
        store_id,
        schedule_id: created.id,
        change_type: 'created',
        to_status: 'scheduled',
        to_start: start,
        to_end: end,
        changed_by_user_id: params.user_id ?? null,
      },
    });

    // Espejo informativo; la agenda se lee de `order_fulfillment_schedules`.
    await tx.orders.update({
      where: { id: order_id },
      data: { estimated_ready_at: start },
    });

    return created;
  }

  /** Cancela el agendamiento cuando la orden se cancela (antes de entregar). */
  async cancelForOrder(order_id: number, note = 'Orden cancelada') {
    const schedule = await this.prisma.withoutScope().order_fulfillment_schedules.findUnique({
      where: { order_id },
    });
    if (!schedule || !FULFILLMENT_TRANSITIONS[schedule.status as FulfillmentStatus].includes('cancelled')) {
      return null;
    }
    return this.prisma.$transaction((tx: Tx) =>
      this.applyTransition(tx, schedule, 'cancelled', null, note),
    );
  }

  private async findOwned(store_id: number, id: number) {
    const schedule = await this.prisma.order_fulfillment_schedules.findFirst({
      where: { id, store_id },
    });
    if (!schedule) throw new VendixHttpException(ErrorCodes.SCHED_NOT_FOUND);
    return schedule;
  }

  private async applyTransition(
    tx: Tx,
    schedule: { id: number; store_id: number; order_id: number; status: string },
    to: FulfillmentStatus,
    user_id: number | null,
    note?: string,
    afterCommit: Array<() => void> = [],
  ) {
    const now = new Date();
    if (to === 'in_production' && this.productionStartHook) {
      // Consumo de inventario (S4) en la misma transacción que el cambio de estado.
      const after = await this.productionStartHook(tx, schedule);
      if (after) afterCommit.push(after);
    }

    const stamp: Prisma.order_fulfillment_schedulesUpdateInput = {
      status: to,
      ...(to === 'in_production' ? { produced_at: now } : {}),
      ...(to === 'ready' ? { ready_at: now } : {}),
      ...(to === 'delivered' ? { delivered_at: now } : {}),
      ...(to === 'cancelled' ? { cancelled_at: now } : {}),
    };

    // Compare-and-set: si otro usuario ya movió el estado, no se pisa.
    const updated = await tx.order_fulfillment_schedules.updateMany({
      where: { id: schedule.id, status: schedule.status as FulfillmentStatus },
      data: stamp as Prisma.order_fulfillment_schedulesUpdateManyMutationInput,
    });
    if (updated.count === 0) {
      throw new VendixHttpException(ErrorCodes.SCHED_INVALID_TRANSITION);
    }

    await tx.order_fulfillment_changes.create({
      data: {
        store_id: schedule.store_id,
        schedule_id: schedule.id,
        change_type: 'status',
        from_status: schedule.status as FulfillmentStatus,
        to_status: to,
        note: note ?? null,
        changed_by_user_id: user_id,
      },
    });

    return tx.order_fulfillment_schedules.findUnique({ where: { id: schedule.id } });
  }

  /** Cambia el estado de cumplimiento validando la máquina de estados. */
  async transition(id: number, to: FulfillmentStatus, note?: string, now = new Date()) {
    const { store_id, user_id } = this.context();
    const schedule = await this.findOwned(store_id, id);
    const from = schedule.status as FulfillmentStatus;

    if (!FULFILLMENT_TRANSITIONS[from].includes(to)) {
      throw new VendixHttpException(
        ErrorCodes.SCHED_INVALID_TRANSITION,
        `No se puede pasar de "${from}" a "${to}".`,
      );
    }
    if (to === 'no_show' && schedule.scheduled_end.getTime() > now.getTime()) {
      throw new VendixHttpException(
        ErrorCodes.SCHED_INVALID_TRANSITION,
        'Solo se puede marcar "No recogida" cuando la franja ya pasó.',
      );
    }

    const afterCommit: Array<() => void> = [];
    // Holgura de tiempo: iniciar producción puede escribir varios movimientos.
    const result = await this.prisma.$transaction(
      (tx: Tx) => this.applyTransition(tx, schedule, to, user_id, note, afterCommit),
      { timeout: 30000 },
    );
    for (const run of afterCommit) {
      try {
        run();
      } catch (err) {
        this.logger.error(`Post-commit de producción falló (agendamiento #${id}): ${(err as Error).message}`);
      }
    }
    return result;
  }

  /**
   * Reprogramación libre para quien tenga `store:scheduled_orders:reschedule`
   * (el permiso lo valida el controlador). Revalida cupo y anticipación y deja
   * historial "de → a, por quién".
   */
  async reschedule(id: number, input: { start: string; end: string; note?: string }, now = new Date()) {
    const { store_id, user_id } = this.context();
    const schedule = await this.findOwned(store_id, id);
    if (!['scheduled', 'in_production', 'ready'].includes(schedule.status)) {
      throw new VendixHttpException(
        ErrorCodes.SCHED_INVALID_TRANSITION,
        'Este pedido ya no se puede reprogramar.',
      );
    }
    const start = toDate(input.start);
    const end = toDate(input.end);

    const result = await this.prisma.$transaction(async (tx: Tx) => {
      await this.lockStoreSchedule(tx, store_id);
      await this.availability.assertSlotAvailable(store_id, start, end, {
        now,
        exclude_schedule_id: id,
        client: tx as unknown as SchedulingReader,
      });
      // Compare-and-set: si otro usuario movió el estado entre la lectura y
      // aquí (p. ej. lo entregó o canceló), no se reprograma.
      const updated = await tx.order_fulfillment_schedules.updateMany({
        where: { id, status: schedule.status as FulfillmentStatus },
        data: { scheduled_start: start, scheduled_end: end },
      });
      if (updated.count === 0) {
        throw new VendixHttpException(
          ErrorCodes.SCHED_INVALID_TRANSITION,
          'El pedido cambió de estado mientras lo reprogramabas. Recarga e intenta de nuevo.',
        );
      }
      const moved = await tx.order_fulfillment_schedules.findUnique({ where: { id } });
      await tx.order_fulfillment_changes.create({
        data: {
          store_id,
          schedule_id: id,
          change_type: 'reschedule',
          from_start: schedule.scheduled_start,
          to_start: start,
          from_end: schedule.scheduled_end,
          to_end: end,
          note: input.note ?? null,
          changed_by_user_id: user_id,
        },
      });
      await tx.orders.update({
        where: { id: schedule.order_id },
        data: { estimated_ready_at: start },
      });
      return moved;
    });

    this.eventEmitter.emit('scheduled_order.rescheduled', {
      store_id,
      schedule_id: id,
      order_id: schedule.order_id,
      from_start: schedule.scheduled_start,
      to_start: start,
      user_id,
    });
    return result;
  }

  /** Agenda del rango (fechas locales de tienda), con la orden y sus líneas. */
  async getAgenda(query: { from: string; to: string; status?: string }) {
    const { store_id } = this.context();
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const [fy, fm, fd] = query.from.split('-').map(Number);
    const [ty, tm, td] = query.to.split('-').map(Number);
    const rangeStart = zonedWallClockToUtc(fy, fm, fd, 0, 0, 0, 0, timezone);
    const rangeEnd = zonedWallClockToUtc(ty, tm, td + 1, 0, 0, 0, 0, timezone);
    const statuses = query.status
      ? (query.status.split(',') as FulfillmentStatus[])
      : undefined;

    return this.prisma.order_fulfillment_schedules.findMany({
      where: {
        scheduled_start: { gte: rangeStart, lt: rangeEnd },
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      orderBy: { scheduled_start: 'asc' },
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
            grand_total: true,
            state: true,
            customer_id: true,
            users: { select: { first_name: true, last_name: true, phone: true, email: true } },
            order_items: {
              select: {
                id: true,
                product_name: true,
                variant_attributes: true,
                quantity: true,
                notes: true,
                order_item_options: {
                  select: { group_name: true, option_name: true, quantity: true, uom: true, scope: true },
                },
              },
            },
          },
        },
      },
    });
  }

  /** Detalle con historial ("Reprogramado de … a … por …"). */
  async findOne(id: number) {
    const { store_id } = this.context();
    await this.findOwned(store_id, id);
    return this.prisma.order_fulfillment_schedules.findFirst({
      where: { id },
      include: {
        changes: {
          orderBy: { created_at: 'asc' },
          include: { changed_by: { select: { id: true, first_name: true, last_name: true } } },
        },
        order: { select: { id: true, order_number: true, grand_total: true, state: true } },
      },
    });
  }

}

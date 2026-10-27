import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../../email/email.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { resolveStoreTimezone, localDateString } from '@common/utils/store-timezone.util';
import { ListServiceRegistryDto, ListServiceRemindersDto, ServiceRegistryActionDto, ServiceRegistryAssignCustomerDto, ServiceRegistryWhatsappDto } from './dto';
import {
  buildReminderMessage,
  computeRecurrence,
  localDayUtc,
  digitsOnlyPhone,
  normalizeWhatsappPhone,
  summarizeSubject,
} from './service-reminders.utils';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Estados de orden que anulan el servicio (no se recuerda lo que se reversó). */
const VOID_ORDER_STATES = ['cancelled', 'refunded'] as const;
/** Órdenes "normales" (sin estación) cuentan cuando se completan. */
const COMPLETED_ORDER_STATES = ['finished', 'delivered'] as const;
/** Ventana máxima de historial por fuente (sesiones / órdenes) para el registro. */
const HISTORY_CAP = 5000;
const DUE_SOON_DAYS = 3;

export type RecurrenceStatus = 'none' | 'ok' | 'due_soon' | 'due_today' | 'overdue' | 'superseded';

export interface ServiceRegistryRow {
  row_key: string;
  source: 'station' | 'order';
  session_id: number | null;
  source_order_id: number;
  order_number: string | null;
  customer: { id: number | null; name: string; email: string | null; phone: string | null; registered: boolean };
  service: { id: number; name: string; is_recurring: boolean; recurrence_interval_days: number | null };
  station: { id: number; name: string } | null;
  subject: { type: string; label: string; display: string | null } | null;
  service_date: Date;
  service_local_date: string;
  days_since: number;
  next_due_date: string | null;
  days_remaining: number | null;
  recurrence_status: RecurrenceStatus;
  reminder: { id: number; status: string; channel: string; sent_at: Date | null; due_date: Date } | null;
  can_dismiss: boolean;
}

/** Entrada cruda: un servicio realizado (orden fuente + producto). */
interface RawEntry {
  source: 'station' | 'order';
  session_id: number | null;
  station_id: number | null;
  booking_id: number | null;
  contact_email: string | null;
  source_order_id: number;
  order_number: string | null;
  product_id: number;
  customer_id: number | null;
  service_at: Date;
}

interface MessageContext {
  row: ServiceRegistryRow;
  subjectPhrase: string | null;
  storeName: string;
  tz: string;
}

@Injectable()
export class ServiceRemindersService {
  private readonly logger = new Logger(ServiceRemindersService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly storeContextRunner: StoreContextRunner,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  private requireStoreId(): number {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('Contexto de tienda requerido');
    }
    return storeId;
  }

  // ---------------------------------------------------------------------------
  // Fuentes de servicios realizados
  // ---------------------------------------------------------------------------

  /**
   * Servicios hechos en estación: sesiones `closed` (la atención terminó).
   * Fecha base = `service_sessions.closed_at` — es el momento real en que se
   * entregó el servicio. `orders.completed_at` NO sirve: cerrar la sesión no
   * toca la orden SVC-{id}; ésta se cobra después (POS / mesa) y puede quedar
   * en draft/processing días después de la atención.
   * Se excluyen sesiones cuya orden fue cancelada/reembolsada.
   * Productos = servicio principal de la sesión + ítems recurrentes de su orden.
   */
  private async loadStationEntries(
    storeId: number,
    opts: { orderIds?: number[]; recurringIds: Set<number> },
  ): Promise<RawEntry[]> {
    const sessions = await this.prisma.service_sessions.findMany({
      where: {
        store_id: storeId,
        status: 'closed',
        closed_at: { not: null },
        order_id: opts.orderIds ? { in: opts.orderIds } : { not: null },
      },
      select: { id: true, station_id: true, product_id: true, booking_id: true, order_id: true, contact_email: true, closed_at: true },
      orderBy: { closed_at: 'desc' },
      take: HISTORY_CAP,
    });
    if (!sessions.length) return [];

    const orderIds = [...new Set(sessions.map((s) => s.order_id!))];
    const bookingIds = [...new Set(sessions.map((s) => s.booking_id).filter((id): id is number => id != null))];
    const [orders, bookings, extraItems] = await Promise.all([
      this.prisma.orders.findMany({
        where: { store_id: storeId, id: { in: orderIds } },
        select: { id: true, state: true, customer_id: true, order_number: true },
      }),
      bookingIds.length
        ? this.prisma.bookings.findMany({ where: { store_id: storeId, id: { in: bookingIds } }, select: { id: true, customer_id: true } })
        : Promise.resolve([] as Array<{ id: number; customer_id: number | null }>),
      opts.recurringIds.size
        ? this.prisma.order_items.findMany({
            where: { order_id: { in: orderIds }, product_id: { in: [...opts.recurringIds] }, orders: { store_id: storeId } },
            select: { order_id: true, product_id: true },
          })
        : Promise.resolve([] as Array<{ order_id: number; product_id: number | null }>),
    ]);
    const orderMap = new Map<number, (typeof orders)[number]>(orders.map((o) => [o.id, o]));
    const bookingMap = new Map<number, (typeof bookings)[number]>(bookings.map((b) => [b.id, b]));
    const extraByOrder = new Map<number, Set<number>>();
    for (const item of extraItems) {
      if (!item.product_id) continue;
      if (!extraByOrder.has(item.order_id)) extraByOrder.set(item.order_id, new Set());
      extraByOrder.get(item.order_id)!.add(item.product_id);
    }

    const entries: RawEntry[] = [];
    for (const session of sessions) {
      const order = orderMap.get(session.order_id!);
      if (!order || (VOID_ORDER_STATES as readonly string[]).includes(order.state)) continue;
      const customerId = order.customer_id ?? (session.booking_id ? bookingMap.get(session.booking_id)?.customer_id ?? null : null);
      const productIds = new Set<number>([session.product_id, ...(extraByOrder.get(order.id) ?? [])]);
      for (const productId of productIds) {
        entries.push({
          source: 'station',
          session_id: session.id,
          station_id: session.station_id,
          booking_id: session.booking_id,
          contact_email: session.contact_email,
          source_order_id: order.id,
          order_number: order.order_number,
          product_id: productId,
          customer_id: customerId,
          service_at: session.closed_at!,
        });
      }
    }
    return entries;
  }

  /**
   * Servicios recurrentes vendidos fuera de estación (orden finished/delivered
   * sin `service_session_id`). Las órdenes de estación se excluyen aquí para
   * no contarlas dos veces: su fuente es la sesión.
   */
  private async loadOrderEntries(
    storeId: number,
    opts: { orderIds?: number[]; recurringIds: Set<number> },
  ): Promise<RawEntry[]> {
    if (!opts.recurringIds.size) return [];
    const items = await this.prisma.order_items.findMany({
      where: {
        product_id: { in: [...opts.recurringIds] },
        ...(opts.orderIds ? { order_id: { in: opts.orderIds } } : {}),
        orders: {
          store_id: storeId,
          customer_id: { not: null },
          service_session_id: null,
          state: { in: [...COMPLETED_ORDER_STATES] },
        },
      },
      select: {
        product_id: true,
        orders: { select: { id: true, customer_id: true, order_number: true, completed_at: true, created_at: true } },
      },
      orderBy: { id: 'desc' },
      take: HISTORY_CAP,
    });
    const seen = new Set<string>();
    const entries: RawEntry[] = [];
    for (const item of items) {
      if (!item.product_id || !item.orders) continue;
      const key = `${item.orders.id}:${item.product_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const serviceAt = item.orders.completed_at || item.orders.created_at;
      if (!serviceAt) continue;
      entries.push({
        source: 'order',
        session_id: null,
        station_id: null,
        booking_id: null,
        contact_email: null,
        source_order_id: item.orders.id,
        order_number: item.orders.order_number,
        product_id: item.product_id,
        customer_id: item.orders.customer_id,
        service_at: serviceAt,
      });
    }
    return entries;
  }

  /**
   * Construye las filas hidratadas del registro con consultas en lote (sin N+1).
   * `orderIds` restringe a órdenes puntuales (acciones sobre una fila).
   */
  private async buildRows(storeId: number, opts: { orderIds?: number[] } = {}): Promise<{ rows: ServiceRegistryRow[]; tz: string; subjectPhrases: Map<string, string | null> }> {
    const recurringProducts = await this.prisma.products.findMany({
      where: { store_id: storeId, is_recurring: true, recurrence_interval_days: { not: null } },
      select: { id: true },
    });
    const recurringIds = new Set<number>(recurringProducts.map((p) => p.id));

    const [stationEntries, orderEntries, tz] = await Promise.all([
      this.loadStationEntries(storeId, { orderIds: opts.orderIds, recurringIds }),
      this.loadOrderEntries(storeId, { orderIds: opts.orderIds, recurringIds }),
      resolveStoreTimezone(this.prisma, storeId),
    ]);
    const entries = [...stationEntries, ...orderEntries];
    if (!entries.length) return { rows: [], tz, subjectPhrases: new Map() };

    const productIds = [...new Set(entries.map((e) => e.product_id))];
    const stationIds = [...new Set(entries.map((e) => e.station_id).filter((id): id is number => id != null))];
    const sessionIds = [...new Set(entries.map((e) => e.session_id).filter((id): id is number => id != null))];
    const customerIds = [...new Set(entries.map((e) => e.customer_id).filter((id): id is number => id != null))];
    const sourceOrderIds = [...new Set(entries.map((e) => e.source_order_id))];

    const [products, stations, subjects, customers, logs] = await Promise.all([
      this.prisma.products.findMany({
        where: { store_id: storeId, id: { in: productIds } },
        select: { id: true, name: true, is_recurring: true, recurrence_interval_days: true },
      }),
      stationIds.length
        ? this.prisma.service_stations.findMany({ where: { store_id: storeId, id: { in: stationIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as Array<{ id: number; name: string }>),
      sessionIds.length
        ? this.prisma.service_subjects.findMany({
            where: { store_id: storeId, session_id: { in: sessionIds } },
            select: { session_id: true, subject_type: true, label: true, metadata: true },
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([] as Array<{ session_id: number; subject_type: string; label: string; metadata: unknown }>),
      customerIds.length
        ? this.prisma.users.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, first_name: true, last_name: true, email: true, phone: true },
          })
        : Promise.resolve([] as Array<{ id: number; first_name: string; last_name: string | null; email: string | null; phone: string | null }>),
      this.prisma.service_reminder_logs.findMany({
        where: { store_id: storeId, source_order_id: { in: sourceOrderIds } },
        select: { id: true, customer_id: true, product_id: true, source_order_id: true, status: true, channel: true, sent_at: true, due_date: true },
      }),
    ]);

    const productMap = new Map<number, (typeof products)[number]>(products.map((p) => [p.id, p]));
    const stationMap = new Map<number, (typeof stations)[number]>(stations.map((s) => [s.id, s]));
    const subjectMap = new Map<number, (typeof subjects)[number]>();
    for (const subject of subjects) if (!subjectMap.has(subject.session_id)) subjectMap.set(subject.session_id, subject);
    const customerMap = new Map<number, (typeof customers)[number]>(customers.map((c) => [c.id, c]));
    const logMap = new Map<string, (typeof logs)[number]>(logs.map((l) => [`${l.source_order_id}:${l.product_id}:${l.customer_id}`, l]));

    // Un servicio queda "superseded" si el mismo cliente lo repitió después.
    const latestByCustomerProduct = new Map<string, number>();
    for (const entry of entries) {
      if (entry.customer_id == null) continue;
      const key = `${entry.customer_id}:${entry.product_id}`;
      const time = entry.service_at.getTime();
      if ((latestByCustomerProduct.get(key) ?? -Infinity) < time) latestByCustomerProduct.set(key, time);
    }

    // Teléfonos capturados en plantillas (campos tipo teléfono de la atención o del
    // perfil del cliente): respaldo cuando el perfil no tiene `phone`.
    const sessionIdsForPhone = entries.map((e) => e.session_id).filter((id): id is number => id != null);
    const customerIdsForPhone = entries.map((e) => e.customer_id).filter((id): id is number => id != null);
    const phoneValues = sessionIdsForPhone.length || customerIdsForPhone.length
      ? await this.prisma.entity_metadata_values.findMany({
          where: {
            store_id: storeId,
            field: { field_type: 'phone' },
            OR: [
              ...(sessionIdsForPhone.length ? [{ entity_type: 'service_session' as const, entity_id: { in: sessionIdsForPhone } }] : []),
              ...(customerIdsForPhone.length ? [{ entity_type: 'customer' as const, entity_id: { in: customerIdsForPhone } }] : []),
            ],
          },
          select: { entity_type: true, entity_id: true, value_text: true },
        })
      : [];
    const phoneByEntity = new Map<string, string>();
    for (const v of phoneValues) {
      const text = v.value_text?.trim();
      const key = `${v.entity_type}:${v.entity_id}`;
      if (text && !phoneByEntity.has(key)) phoneByEntity.set(key, text);
    }
    const templatePhone = (type: 'service_session' | 'customer', id: number | null) =>
      id == null ? null : phoneByEntity.get(`${type}:${id}`) ?? null;

    const now = new Date();
    const subjectPhrases = new Map<string, string | null>();
    const rows: ServiceRegistryRow[] = [];
    for (const entry of entries) {
      const product = productMap.get(entry.product_id);
      if (!product) continue;
      const subject = entry.session_id ? subjectMap.get(entry.session_id) ?? null : null;
      const meta = (subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {}) as Record<string, unknown>;
      const user = entry.customer_id != null ? customerMap.get(entry.customer_id) : undefined;
      const metaName = typeof meta['customer_name'] === 'string' ? (meta['customer_name'] as string).trim() : '';
      const customerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || metaName || 'Cliente';
      const email = user?.email || entry.contact_email || (typeof meta['customer_email'] === 'string' ? (meta['customer_email'] as string) : null) || null;
      const phone = user?.phone
        || (typeof meta['customer_phone'] === 'string' ? (meta['customer_phone'] as string) : null)
        || templatePhone('customer', entry.customer_id)
        || templatePhone('service_session', entry.session_id)
        || null;

      const isRecurring = Boolean(product.is_recurring && product.recurrence_interval_days);
      const recurrence = computeRecurrence(entry.service_at, isRecurring ? product.recurrence_interval_days : null, now, tz);
      const superseded = entry.customer_id != null && latestByCustomerProduct.get(`${entry.customer_id}:${entry.product_id}`)! > entry.service_at.getTime();
      const log = entry.customer_id != null ? logMap.get(`${entry.source_order_id}:${entry.product_id}:${entry.customer_id}`) : undefined;

      let recurrenceStatus: RecurrenceStatus = 'none';
      if (isRecurring && recurrence.days_remaining != null) {
        if (superseded) recurrenceStatus = 'superseded';
        else if (recurrence.days_remaining < 0) recurrenceStatus = 'overdue';
        else if (recurrence.days_remaining === 0) recurrenceStatus = 'due_today';
        else if (recurrence.days_remaining <= DUE_SOON_DAYS) recurrenceStatus = 'due_soon';
        else recurrenceStatus = 'ok';
      }

      const summary = summarizeSubject(subject);
      const rowKey = `${entry.source_order_id}:${entry.product_id}`;
      subjectPhrases.set(rowKey, summary?.phrase ?? null);
      rows.push({
        row_key: rowKey,
        source: entry.source,
        session_id: entry.session_id,
        source_order_id: entry.source_order_id,
        order_number: entry.order_number,
        customer: { id: entry.customer_id, name: customerName, email, phone, registered: entry.customer_id != null },
        service: {
          id: product.id,
          name: product.name,
          is_recurring: isRecurring,
          recurrence_interval_days: isRecurring ? product.recurrence_interval_days : null,
        },
        station: entry.station_id ? { id: entry.station_id, name: stationMap.get(entry.station_id)?.name ?? `Estación #${entry.station_id}` } : null,
        subject: subject ? { type: subject.subject_type, label: subject.label, display: summary?.display ?? null } : null,
        service_date: entry.service_at,
        service_local_date: recurrence.service_date,
        days_since: recurrence.days_since,
        next_due_date: recurrence.next_due_date,
        days_remaining: recurrence.days_remaining,
        recurrence_status: recurrenceStatus,
        reminder: log ? { id: log.id, status: log.status, channel: log.channel, sent_at: log.sent_at, due_date: log.due_date } : null,
        can_dismiss: entry.customer_id != null && log?.status !== 'dismissed',
      });
    }
    return { rows, tz, subjectPhrases };
  }

  // ---------------------------------------------------------------------------
  // Recordatorios vencidos → log + notificación interna
  // ---------------------------------------------------------------------------

  /**
   * Por cada cliente y servicio recurrente toma el último servicio realizado
   * (sesión de estación cerrada u orden completada). Si fecha base + intervalo
   * <= hoy (zona horaria de la tienda) y no existe log para esa orden fuente,
   * crea el log `pending` y emite `service_reminder_due` al admin.
   * Las filas sin cliente registrado no generan log (customer_id es NOT NULL).
   */
  async computeDue(storeId: number): Promise<void> {
    const { rows } = await this.buildRows(storeId);
    const due = rows.filter(
      (r) => r.customer.id != null && !r.reminder && (r.recurrence_status === 'overdue' || r.recurrence_status === 'due_today'),
    );
    if (!due.length) return;

    for (const row of due) {
      let createdId: number;
      try {
        const created = await this.prisma.service_reminder_logs.create({
          data: {
            store_id: storeId,
            customer_id: row.customer.id!,
            product_id: row.service.id,
            source_order_id: row.source_order_id,
            due_date: new Date(`${row.next_due_date}T00:00:00.000Z`),
            channel: 'notification',
            status: 'pending',
          },
          select: { id: true },
        });
        createdId = created.id;
      } catch (err: any) {
        // P2002: otro proceso (cron vs. listado) ya lo creó — no notificar dos veces.
        if (err?.code === 'P2002') continue;
        throw err;
      }

      try {
        const subjectText = row.subject?.display ? ` (${row.subject.display})` : '';
        await this.notifications.createAndBroadcast(
          storeId,
          'service_reminder_due',
          'Recordatorio de servicio recurrente',
          `Es momento de contactar a ${row.customer.name} para repetir ${row.service.name}${subjectText}.`,
          {
            customer_id: row.customer.id,
            product_id: row.service.id,
            source_order_id: row.source_order_id,
            service_session_id: row.session_id,
            reminder_id: createdId,
          },
        );
      } catch (notifErr: any) {
        this.logger.warn(`No se pudo emitir la notificación para recordatorio #${createdId}: ${notifErr.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Registro de servicios y estaciones
  // ---------------------------------------------------------------------------

  async registry(query: ListServiceRegistryDto) {
    const storeId = this.requireStoreId();
    // Solo lectura: computeDue lo ejecuta el cron diario (handleDailyCron).
    const { rows } = await this.buildRows(storeId);

    const search = query.search?.trim() ? normalizeText(query.search.trim()) : '';
    const searched = search
      ? rows.filter((r) =>
          normalizeText(
            [r.customer.name, r.service.name, r.station?.name, r.subject?.label, r.subject?.display, r.order_number].filter(Boolean).join(' '),
          ).includes(search),
        )
      : rows;

    const isActive = (r: ServiceRegistryRow) => r.recurrence_status !== 'none' && r.recurrence_status !== 'superseded' && r.reminder?.status !== 'dismissed';
    const isDueSoon = (r: ServiceRegistryRow) => isActive(r) && (r.recurrence_status === 'due_soon' || r.recurrence_status === 'due_today');
    const isOverdue = (r: ServiceRegistryRow) => isActive(r) && r.recurrence_status === 'overdue';

    const stats = {
      total: searched.length,
      recurring: searched.filter(isActive).length,
      due_soon: searched.filter(isDueSoon).length,
      overdue: searched.filter(isOverdue).length,
    };

    const filter = query.filter ?? 'all';
    let filtered = searched;
    if (filter === 'recurring') filtered = searched.filter(isActive);
    else if (filter === 'due_soon') filtered = searched.filter(isDueSoon);
    else if (filter === 'overdue') filtered = searched.filter(isOverdue);

    if (filter === 'all') {
      filtered = [...filtered].sort((a, b) => b.service_date.getTime() - a.service_date.getTime());
    } else {
      filtered = [...filtered].sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0));
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const items = filtered.slice((page - 1) * limit, page * limit);
    return { items, total: filtered.length, page, limit, stats };
  }

  /** Resuelve una fila puntual del registro (validando tienda, orden y servicio). */
  private async resolveRow(storeId: number, sourceOrderId: number, productId: number): Promise<MessageContext> {
    const [{ rows, tz, subjectPhrases }, store] = await Promise.all([
      this.buildRows(storeId, { orderIds: [sourceOrderId] }),
      this.prisma.stores.findFirst({ where: { id: storeId }, select: { name: true } }),
    ]);
    const row = rows.find((r) => r.source_order_id === sourceOrderId && r.service.id === productId);
    if (!row) throw new NotFoundException('Servicio no encontrado en el registro');
    return { row, tz, subjectPhrase: subjectPhrases.get(row.row_key) ?? null, storeName: store?.name || 'Vendix' };
  }

  /** Crea (o devuelve) el log de la fila. Null si el cliente no está registrado. */
  private async ensureLog(storeId: number, row: ServiceRegistryRow): Promise<number | null> {
    if (row.customer.id == null) return null;
    if (row.reminder) return row.reminder.id;
    const where = {
      store_id: storeId,
      customer_id: row.customer.id,
      product_id: row.service.id,
      source_order_id: row.source_order_id,
    };
    const dueDate = new Date(`${row.next_due_date ?? row.service_local_date}T00:00:00.000Z`);
    try {
      const created = await this.prisma.service_reminder_logs.create({
        data: { ...where, due_date: dueDate, channel: 'notification', status: 'pending' },
        select: { id: true },
      });
      return created.id;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      const existing = await this.prisma.service_reminder_logs.findFirst({ where, select: { id: true } });
      return existing?.id ?? null;
    }
  }

  private messageFor(ctx: MessageContext): string {
    const { row, tz } = ctx;
    const todayYear = Number(localDateString(new Date(), tz).slice(0, 4));
    return buildReminderMessage({
      customerName: row.customer.name,
      storeName: ctx.storeName,
      productName: row.service.name,
      serviceDay: localDayUtc(row.service_date, tz),
      subjectPhrase: ctx.subjectPhrase,
      intervalDays: row.service.recurrence_interval_days,
      daysSince: row.days_since,
      referenceYear: todayYear,
    });
  }

  private async deliverEmail(ctx: MessageContext, logId: number | null) {
    if (!ctx.row.customer.email) {
      throw new BadRequestException('El cliente no tiene un correo electrónico registrado');
    }
    const message = this.messageFor(ctx);
    const subject = `Recordatorio de tu servicio en ${ctx.storeName}`;
    const result = await this.email.sendEmail(ctx.row.customer.email, subject, `<p>${escapeHtml(message)}</p>`, message);
    if (!result.success) {
      throw new BadRequestException(`No se pudo enviar el correo: ${result.error ?? 'error del proveedor'}`);
    }
    if (logId) await this.markSent(logId, 'email');
    return { success: true, message: 'Correo enviado correctamente', reminder_id: logId };
  }

  private async deliverWhatsapp(ctx: MessageContext, logId: number | null) {
    if (!ctx.row.customer.phone) {
      throw new BadRequestException('El cliente no tiene un número de teléfono registrado');
    }
    const phone = normalizeWhatsappPhone(ctx.row.customer.phone);
    if (!phone) throw new BadRequestException('El teléfono del cliente no es válido');
    const message = this.messageFor(ctx);
    // Generar el enlace no garantiza que el mensaje se envió: el
    // recordatorio queda pendiente hasta una confirmación real de envío.
    return { url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, message, reminder_id: logId };
  }

  async registryEmail(dto: ServiceRegistryActionDto) {
    const storeId = this.requireStoreId();
    const ctx = await this.resolveRow(storeId, dto.source_order_id, dto.product_id);
    if (!ctx.row.customer.email) throw new BadRequestException('El cliente no tiene un correo electrónico registrado');
    return this.deliverEmail(ctx, await this.ensureLog(storeId, ctx.row));
  }

  async registryWhatsapp(dto: ServiceRegistryWhatsappDto) {
    const storeId = this.requireStoreId();
    const ctx = await this.resolveRow(storeId, dto.source_order_id, dto.product_id);
    // Sin teléfono guardado, el comercio lo escribe al enviar; si el cliente está
    // registrado y su perfil no tiene teléfono, queda guardado para la próxima vez.
    if (!ctx.row.customer.phone && dto.phone) {
      const cleanPhone = digitsOnlyPhone(dto.phone);
      if (!cleanPhone) throw new BadRequestException('El teléfono no es válido: debe tener entre 10 y 15 dígitos');
      if (ctx.row.customer.id != null) {
        await this.prisma.users.updateMany({
          where: { id: ctx.row.customer.id, store_users: { some: { store_id: storeId } }, OR: [{ phone: null }, { phone: '' }] },
          data: { phone: cleanPhone },
        });
      }
      ctx.row.customer.phone = cleanPhone;
    }
    if (!ctx.row.customer.phone) throw new BadRequestException('El cliente no tiene un número de teléfono registrado');
    return this.deliverWhatsapp(ctx, await this.ensureLog(storeId, ctx.row));
  }

  /**
   * Asocia un cliente a una atención hecha sin cliente para que entre a los
   * recordatorios. Solo completa órdenes SIN cliente: nunca reemplaza uno existente
   * (la orden pudo facturarse a nombre de ese cliente).
   */
  async registryAssignCustomer(dto: ServiceRegistryAssignCustomerDto) {
    const storeId = this.requireStoreId();
    await this.resolveRow(storeId, dto.source_order_id, dto.product_id);
    const customer = await this.prisma.users.findFirst({
      where: { id: dto.customer_id, store_users: { some: { store_id: storeId } } },
      select: { id: true },
    });
    if (!customer) throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
    const updated = await this.prisma.orders.updateMany({
      where: { id: dto.source_order_id, store_id: storeId, customer_id: null },
      data: { customer_id: dto.customer_id, updated_at: new Date() },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('Esta atención ya tiene un cliente asignado.');
    }
    return { success: true, source_order_id: dto.source_order_id, customer_id: dto.customer_id };
  }

  async registryDismiss(dto: ServiceRegistryActionDto) {
    const storeId = this.requireStoreId();
    const ctx = await this.resolveRow(storeId, dto.source_order_id, dto.product_id);
    const logId = await this.ensureLog(storeId, ctx.row);
    if (!logId) {
      throw new BadRequestException('Este cliente no está registrado en la tienda; no es posible descartar su recordatorio.');
    }
    await this.dismiss(logId);
    return { success: true, reminder_id: logId };
  }

  // ---------------------------------------------------------------------------
  // API legacy por id de log
  // ---------------------------------------------------------------------------

  /**
   * Lista los recordatorios (logs) de la tienda con filtros y paginación.
   * Solo lectura: los logs los genera el cron diario (computeDue).
   */
  async list(query: ListServiceRemindersDto) {
    const storeId = this.requireStoreId();

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const todayStartUtc = localDayUtc(new Date(), tz);

    const [pendingCount, totalCount, sentTodayCount] = await Promise.all([
      this.prisma.service_reminder_logs.count({ where: { store_id: storeId, status: 'pending' } }),
      this.prisma.service_reminder_logs.count({ where: { store_id: storeId } }),
      this.prisma.service_reminder_logs.count({
        where: { store_id: storeId, status: 'sent', sent_at: { gte: todayStartUtc } },
      }),
    ]);

    const where: any = { store_id: storeId };
    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }

    const total = await this.prisma.service_reminder_logs.count({ where });
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const logs = await this.prisma.service_reminder_logs.findMany({
      where,
      orderBy: [{ due_date: 'asc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const customerIds = [...new Set<number>(logs.map((l) => l.customer_id))];
    const productIds = [...new Set<number>(logs.map((l) => l.product_id))];
    const orderIds = [...new Set<number>(logs.map((l) => l.source_order_id))];

    const [customers, products, orders] = await Promise.all([
      this.prisma.users.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, first_name: true, last_name: true, email: true, phone: true },
      }),
      this.prisma.products.findMany({
        where: { store_id: storeId, id: { in: productIds } },
        select: { id: true, name: true },
      }),
      this.prisma.orders.findMany({
        where: { store_id: storeId, id: { in: orderIds } },
        select: { id: true, order_number: true, created_at: true, completed_at: true },
      }),
    ]);

    const customerMap = new Map<number, (typeof customers)[number]>(customers.map((c) => [c.id, c]));
    const productMap = new Map<number, (typeof products)[number]>(products.map((p) => [p.id, p]));
    const orderMap = new Map<number, (typeof orders)[number]>(orders.map((o) => [o.id, o]));

    const items = logs.map((log) => {
      const cust = customerMap.get(log.customer_id);
      const prod = productMap.get(log.product_id);
      const ord = orderMap.get(log.source_order_id);
      const customerName = [cust?.first_name, cust?.last_name].filter(Boolean).join(' ') || 'Cliente';
      const lastServiceDate = ord?.completed_at || ord?.created_at || log.created_at;
      const daysSince = lastServiceDate ? computeRecurrence(lastServiceDate, null, new Date(), tz).days_since : 0;

      return {
        id: log.id,
        store_id: log.store_id,
        customer_id: log.customer_id,
        product_id: log.product_id,
        source_order_id: log.source_order_id,
        customer: { id: log.customer_id, name: customerName, email: cust?.email || null, phone: cust?.phone || null },
        product: { id: log.product_id, name: prod?.name || 'Servicio' },
        order_number: ord?.order_number || `#${log.source_order_id}`,
        last_service_date: lastServiceDate,
        due_date: log.due_date,
        days_since: daysSince,
        status: log.status,
        channel: log.channel,
        sent_at: log.sent_at,
        created_at: log.created_at,
      };
    });

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      stats: { pending: pendingCount, sent_today: sentTodayCount, total: totalCount },
    };
  }

  /**
   * Mensaje al cliente con servicio, fecha y sujeto (vehículo/equipo):
   * "Hola Juan, en {tienda} le hicimos el servicio de cambio de aceite a tu
   * moto AKT (ABC12D) el 3 de oct. Ya pasaron 30 días, que es el periodo
   * recomendado; ..." — ver buildReminderMessage.
   */
  async buildMessage(logId: number): Promise<{ message: string; customer: any; store: any; reminder_id: number }> {
    const storeId = this.requireStoreId();
    const log = await this.prisma.service_reminder_logs.findFirst({ where: { id: logId, store_id: storeId } });
    if (!log) throw new NotFoundException('Recordatorio no encontrado');
    const ctx = await this.resolveRow(storeId, log.source_order_id, log.product_id);
    return {
      message: this.messageFor(ctx),
      customer: { name: ctx.row.customer.name, email: ctx.row.customer.email, phone: ctx.row.customer.phone },
      store: { name: ctx.storeName },
      reminder_id: log.id,
    };
  }

  async markSent(id: number, channel: 'whatsapp' | 'email' | 'notification'): Promise<void> {
    const storeId = this.requireStoreId();
    await this.prisma.service_reminder_logs.updateMany({
      where: { id, store_id: storeId },
      data: { status: 'sent', channel, sent_at: new Date() },
    });
  }

  private async contextForLog(id: number): Promise<MessageContext> {
    const storeId = this.requireStoreId();
    const log = await this.prisma.service_reminder_logs.findFirst({ where: { id, store_id: storeId } });
    if (!log) throw new NotFoundException('Recordatorio no encontrado');
    return this.resolveRow(storeId, log.source_order_id, log.product_id);
  }

  async sendEmail(id: number): Promise<{ success: boolean; message: string }> {
    const result = await this.deliverEmail(await this.contextForLog(id), id);
    return { success: result.success, message: result.message };
  }

  async whatsappLink(id: number): Promise<{ url: string }> {
    const result = await this.deliverWhatsapp(await this.contextForLog(id), id);
    return { url: result.url };
  }

  async dismiss(id: number): Promise<{ success: boolean }> {
    const storeId = this.requireStoreId();
    await this.prisma.service_reminder_logs.updateMany({
      where: { id, store_id: storeId },
      data: { status: 'dismissed' },
    });
    return { success: true };
  }

  /**
   * Cron diario 8:00 AM: recorre las tiendas con servicios recurrentes y
   * ejecuta computeDue (sesiones de estación cerradas + órdenes completadas).
   */
  @Cron('0 8 * * *')
  async handleDailyCron(): Promise<void> {
    this.logger.log('Iniciando revisión diaria de recordatorios de servicios recurrentes...');
    try {
      const storesWithRecurring = await this.globalPrisma.products.findMany({
        where: { is_recurring: true, recurrence_interval_days: { not: null } },
        select: { store_id: true },
        distinct: ['store_id'],
      });

      for (const { store_id } of storesWithRecurring) {
        try {
          await this.storeContextRunner.runInStoreContext(store_id, async () => {
            await this.computeDue(store_id);
          });
        } catch (err: any) {
          this.logger.error(`Error procesando recordatorios de tienda #${store_id}: ${err.message}`, err.stack);
        }
      }
      this.logger.log(`Revisión diaria completada para ${storesWithRecurring.length} tiendas.`);
    } catch (err: any) {
      this.logger.error(`Error en cron diario de recordatorios: ${err.message}`, err.stack);
    }
  }
}

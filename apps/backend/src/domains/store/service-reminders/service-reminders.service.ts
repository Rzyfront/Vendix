import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../../email/email.service';
import { resolveStoreTimezone, localDateString } from '@common/utils/store-timezone.util';
import { ListServiceRemindersDto } from './dto';

function formatShortDateEs(date: Date): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = months[date.getUTCMonth()];
  return `${d} ${m}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
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

  /**
   * Calcula recordatorios vencidos para la tienda:
   * Por cada cliente y producto recurrente, busca la última orden completada/entregada.
   * Si fecha base + intervalo <= hoy (en la zona horaria de la tienda),
   * crea un log con status 'pending' si aún no existe para esa orden fuente.
   */
  async computeDue(storeId: number): Promise<void> {
    const recurrentProducts = await this.prisma.products.findMany({
      where: {
        store_id: storeId,
        is_recurring: true,
        recurrence_interval_days: { not: null },
      },
      select: {
        id: true,
        name: true,
        recurrence_interval_days: true,
      },
    });

    if (!recurrentProducts.length) return;

    const productIds = recurrentProducts.map((p) => p.id);
    const productMap = new Map(recurrentProducts.map((p) => [p.id, p]));

    const orderItems = await this.prisma.order_items.findMany({
      where: {
        product_id: { in: productIds },
        orders: {
          store_id: storeId,
          customer_id: { not: null },
          state: { in: ['finished', 'delivered'] },
        },
      },
      select: {
        id: true,
        product_id: true,
        order_id: true,
        orders: {
          select: {
            id: true,
            customer_id: true,
            completed_at: true,
            created_at: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const latestMap = new Map<string, (typeof orderItems)[0]>();
    for (const item of orderItems) {
      if (!item.product_id || !item.orders?.customer_id) continue;
      const key = `${item.orders.customer_id}-${item.product_id}`;
      if (!latestMap.has(key)) {
        latestMap.set(key, item);
      }
    }

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const todayLocalDateStr = localDateString(new Date(), tz);
    const [tY, tM, tD] = todayLocalDateStr.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(tY, tM - 1, tD));

    for (const item of latestMap.values()) {
      const baseDate = item.orders.completed_at || item.orders.created_at;
      if (!baseDate) continue;
      const product = productMap.get(item.product_id!);
      if (!product || !product.recurrence_interval_days) continue;

      const baseLocalDateStr = localDateString(baseDate, tz);
      const [bY, bM, bD] = baseLocalDateStr.split('-').map(Number);
      const dueDate = new Date(Date.UTC(bY, bM - 1, bD));
      dueDate.setUTCDate(dueDate.getUTCDate() + product.recurrence_interval_days);

      if (dueDate <= todayUtc) {
        const existing = await this.prisma.service_reminder_logs.findFirst({
          where: {
            store_id: storeId,
            customer_id: item.orders.customer_id,
            product_id: item.product_id,
            source_order_id: item.orders.id,
          },
        });

        if (!existing) {
          const createdLog = await this.prisma.service_reminder_logs.create({
            data: {
              store_id: storeId,
              customer_id: item.orders.customer_id,
              product_id: item.product_id,
              source_order_id: item.orders.id,
              due_date: dueDate,
              channel: 'notification',
              status: 'pending',
            },
          });

          try {
            const customer = await this.prisma.users.findFirst({
              where: { id: item.orders.customer_id },
              select: { first_name: true, last_name: true },
            });
            const customerName =
              [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
              'Cliente';
            await this.notifications.createAndBroadcast(
              storeId,
              'service_reminder_due' as any,
              'Recordatorio de servicio recurrente',
              `Es momento de contactar a ${customerName} para su servicio recurrente de ${product.name}.`,
              {
                customer_id: item.orders.customer_id,
                product_id: item.product_id,
                source_order_id: item.orders.id,
                reminder_id: createdLog.id,
              },
            );
          } catch (notifErr: any) {
            this.logger.warn(`No se pudo emitir la notificación para recordatorio #${createdLog.id}: ${notifErr.message}`);
          }
        }
      }
    }
  }

  /**
   * Lista los recordatorios de la tienda con filtros y paginación.
   * Ejecuta computeDue antes de listar.
   */
  async list(query: ListServiceRemindersDto) {
    const storeId = this.requireStoreId();
    await this.computeDue(storeId);

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const todayLocalDateStr = localDateString(new Date(), tz);
    const [tY, tM, tD] = todayLocalDateStr.split('-').map(Number);
    const todayStartUtc = new Date(Date.UTC(tY, tM - 1, tD));

    const [pendingCount, totalCount, sentTodayCount] = await Promise.all([
      this.prisma.service_reminder_logs.count({ where: { store_id: storeId, status: 'pending' } }),
      this.prisma.service_reminder_logs.count({ where: { store_id: storeId } }),
      this.prisma.service_reminder_logs.count({
        where: {
          store_id: storeId,
          status: 'sent',
          sent_at: { gte: todayStartUtc },
        },
      }),
    ]);

    const where: any = { store_id: storeId };
    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }

    const total = await this.prisma.service_reminder_logs.count({ where });
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const logs = await this.prisma.service_reminder_logs.findMany({
      where,
      orderBy: [{ due_date: 'asc' }, { id: 'desc' }],
      skip,
      take: limit,
    });

    const customerIds = [...new Set(logs.map((l) => l.customer_id))];
    const productIds = [...new Set(logs.map((l) => l.product_id))];
    const orderIds = [...new Set(logs.map((l) => l.source_order_id))];

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

    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    const items = logs.map((log) => {
      const cust = customerMap.get(log.customer_id);
      const prod = productMap.get(log.product_id);
      const ord = orderMap.get(log.source_order_id);

      const customerName =
        [cust?.first_name, cust?.last_name].filter(Boolean).join(' ') ||
        'Cliente';

      const lastServiceDate = ord?.completed_at || ord?.created_at || log.created_at;
      let daysSince = 0;
      if (lastServiceDate) {
        const baseLocalDateStr = localDateString(lastServiceDate, tz);
        const [bY, bM, bD] = baseLocalDateStr.split('-').map(Number);
        const baseDateUtc = new Date(Date.UTC(bY, bM - 1, bD));
        daysSince = Math.max(0, Math.floor((todayStartUtc.getTime() - baseDateUtc.getTime()) / (1000 * 60 * 60 * 24)));
      }

      return {
        id: log.id,
        store_id: log.store_id,
        customer_id: log.customer_id,
        product_id: log.product_id,
        source_order_id: log.source_order_id,
        customer: {
          id: log.customer_id,
          name: customerName,
          email: cust?.email || null,
          phone: cust?.phone || null,
        },
        product: {
          id: log.product_id,
          name: prod?.name || 'Servicio',
        },
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
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stats: {
        pending: pendingCount,
        sent_today: sentTodayCount,
        total: totalCount,
      },
    };
  }

  /**
   * Construye el mensaje estándar para el cliente:
   * "Hola {nombre}, desde {nombre tienda} te recordamos que ya pasaron {N} días desde tu servicio de {servicio} ({fecha base dd MMM}). Es momento de agendar de nuevo para mantener todo en buen estado. ¡Te esperamos!"
   */
  async buildMessage(logId: number): Promise<{ message: string; customer: any; store: any }> {
    const storeId = this.requireStoreId();
    const log = await this.prisma.service_reminder_logs.findFirst({
      where: { id: logId, store_id: storeId },
    });
    if (!log) {
      throw new NotFoundException('Recordatorio no encontrado');
    }

    const [customer, product, order, store] = await Promise.all([
      this.prisma.users.findFirst({
        where: { id: log.customer_id },
        select: { first_name: true, last_name: true, phone: true, email: true },
      }),
      this.prisma.products.findFirst({
        where: { store_id: storeId, id: log.product_id },
        select: { name: true },
      }),
      this.prisma.orders.findFirst({
        where: { store_id: storeId, id: log.source_order_id },
        select: { created_at: true, completed_at: true },
      }),
      this.prisma.stores.findFirst({
        where: { id: storeId },
        select: { name: true },
      }),
    ]);

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const todayLocalDateStr = localDateString(new Date(), tz);
    const [tY, tM, tD] = todayLocalDateStr.split('-').map(Number);
    const todayStartUtc = new Date(Date.UTC(tY, tM - 1, tD));

    const baseDate = order?.completed_at || order?.created_at || log.created_at;
    let daysSince = 0;
    let formattedBaseDate = '';
    if (baseDate) {
      const baseLocalDateStr = localDateString(baseDate, tz);
      const [bY, bM, bD] = baseLocalDateStr.split('-').map(Number);
      const baseDateUtc = new Date(Date.UTC(bY, bM - 1, bD));
      daysSince = Math.max(0, Math.floor((todayStartUtc.getTime() - baseDateUtc.getTime()) / (1000 * 60 * 60 * 24)));
      formattedBaseDate = formatShortDateEs(baseDateUtc);
    }

    const customerName =
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Cliente';
    const storeName = store?.name || 'Vendix';
    const productName = product?.name || 'Servicio';

    const message = `Hola ${customerName}, desde ${storeName} te recordamos que ya pasaron ${daysSince} días desde tu servicio de ${productName} (${formattedBaseDate}). Es momento de agendar de nuevo para mantener todo en buen estado. ¡Te esperamos!`;

    return { message, customer, store };
  }

  async markSent(id: number, channel: 'whatsapp' | 'email' | 'notification'): Promise<void> {
    const storeId = this.requireStoreId();
    await this.prisma.service_reminder_logs.updateMany({
      where: { id, store_id: storeId },
      data: {
        status: 'sent',
        channel,
        sent_at: new Date(),
      },
    });
  }

  async sendEmail(id: number): Promise<{ success: boolean; message: string }> {
    const { message, customer, store } = await this.buildMessage(id);
    if (!customer?.email) {
      throw new BadRequestException('El cliente no tiene un correo electrónico registrado');
    }

    const storeName = store?.name || 'Vendix';
    const subject = `Recordatorio de tu servicio en ${storeName}`;
    const html = `<p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`;

    await this.email.sendEmail(customer.email, subject, html, message);
    await this.markSent(id, 'email');

    return { success: true, message: 'Correo enviado correctamente' };
  }

  async whatsappLink(id: number): Promise<{ url: string }> {
    const { message, customer } = await this.buildMessage(id);
    if (!customer?.phone) {
      throw new BadRequestException('El cliente no tiene un número de teléfono registrado');
    }

    const rawDigits = customer.phone.replace(/\D/g, '');
    if (!rawDigits) {
      throw new BadRequestException('El teléfono del cliente no es válido');
    }
    const normalizedPhone = rawDigits.length === 10 ? `57${rawDigits}` : rawDigits;
    const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

    await this.markSent(id, 'whatsapp');

    return { url };
  }

  async dismiss(id: number): Promise<{ success: boolean }> {
    const storeId = this.requireStoreId();
    await this.prisma.service_reminder_logs.updateMany({
      where: { id, store_id: storeId },
      data: {
        status: 'dismissed',
      },
    });

    return { success: true };
  }

  /**
   * Cron diario a las 8:00 AM:
   * Recorre todas las tiendas con productos recurrentes y ejecuta computeDue.
   */
  @Cron('0 8 * * *')
  async handleDailyCron(): Promise<void> {
    this.logger.log('Iniciando revisión diaria de recordatorios de servicios recurrentes...');
    try {
      const storesWithRecurring = await this.globalPrisma.products.findMany({
        where: {
          is_recurring: true,
          recurrence_interval_days: { not: null },
        },
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

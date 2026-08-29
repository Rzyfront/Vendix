import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EmailService } from '../../../email/email.service';
import { S3Service } from '../../../common/services/s3.service';
import { EmailAttachment } from '../../../email/interfaces/email.interface';
import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailText,
  InvoiceEmailData,
} from '../../../email/templates/invoice-email.template';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  PaymentReceivedEvent,
  NewCustomerEvent,
} from './interfaces/notification-events.interface';
import { QueueEntryEvent } from '../customer-queue/interfaces/queue-events.interface';
import { InvoiceDataRequestEvent } from '../invoicing/invoice-data-requests/interfaces/invoice-data-request-events.interface';
import {
  buildDianEmailSubject,
  resolveDianDocumentTypeCode,
} from '../invoicing/utils/dian-email-subject.util';
import { tryResolveTenantFiscalIdentity } from '../../../common/helpers/fiscal-identity.helper';
import { AppointmentQueueService } from '../reservations/appointment-queue/appointment-queue.service';
import { writeInvoiceDeliveryEvent } from '../invoicing/delivery/invoice-delivery-events.writer';
// Entrega PRIMARIA normativa. `InvoiceDeliveryService.deliver()` es el único
// lugar del sistema que arma el `.zip` del Anexo Técnico 1.9 §9.1 (PDF
// re-renderizado + XML firmado crudo + sobre `AttachedDocument`), y ya está
// probado contra el XSD. `RequestContextService.runIsolated` abre el contexto de
// tenant que su `StorePrismaService` necesita — `runIsolated` y no `run`, porque
// forjar contexto desde un listener con `run` dejaría el tenant en el estático
// de clase y el siguiente ejecutor fuera del ALS lo adoptaría en silencio.
import { InvoiceDeliveryService } from '../invoicing/delivery/invoice-delivery.service';
import { RequestContextService } from '../../../common/context/request-context.service';

@Injectable()
export class NotificationsEventsListener {
  private readonly logger = new Logger(NotificationsEventsListener.name);

  constructor(
    private readonly notifications_service: NotificationsService,
    private readonly global_prisma: GlobalPrismaService,
    private readonly email_service: EmailService,
    private readonly s3_service: S3Service,
    private readonly appointment_queue_service: AppointmentQueueService,
    private readonly event_emitter: EventEmitter2,
    private readonly invoice_delivery_service: InvoiceDeliveryService,
  ) {}

  /**
   * Appointment redesign phase 2 — resolves the FROM address for emails
   * the listener sends on behalf of a store. Priority chain:
   *
   *   1. The specific user who triggered the action (`decidedByUserId`
   *      from the event payload) — the customer sees "the actual person
   *      who decided" and can reply directly. PREFERRED.
   *   2. Store owner — fallback when no decidedByUserId (e.g. automated
   *      flows) or when that user has no email set.
   *   3. Organization admin — second fallback.
   *   4. `null` — caller uses platform default EMAIL_FROM.
   */
  private async resolveFromForAction(
    decidedByUserId: number | undefined,
    store_id: number,
  ): Promise<{ name: string; email: string } | null> {
    try {
      // 1. The admin who performed the action — most useful for the
      //    customer (they see who actually decided).
      if (decidedByUserId) {
        const actor = await this.global_prisma.users.findUnique({
          where: { id: decidedByUserId },
          select: { first_name: true, last_name: true, email: true, state: true },
        });
        if (actor?.email && actor.state === 'active') {
          const fullName = `${actor.first_name ?? ''} ${actor.last_name ?? ''}`.trim() || 'Equipo de la tienda';
          return { name: fullName, email: actor.email };
        }
      }
      // 2. Store owner fallback
      const owner = await this.global_prisma.users.findFirst({
        where: {
          main_store_id: store_id,
          state: 'active',
          user_roles: {
            some: { roles: { name: { in: ['owner', 'ORG_ADMIN'] } } },
          },
        },
        orderBy: { id: 'asc' },
        select: { first_name: true, last_name: true, email: true },
      });
      if (owner?.email) {
        const fullName = `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() || 'Store Owner';
        return { name: fullName, email: owner.email };
      }
      // 3. Org admin fallback
      const org = await this.global_prisma.stores.findUnique({
        where: { id: store_id },
        select: { organization_id: true },
      });
      if (org) {
        const orgAdmin = await this.global_prisma.users.findFirst({
          where: {
            organization_id: org.organization_id,
            state: 'active',
            user_roles: { some: { roles: { name: 'ORG_ADMIN' } } },
          },
          orderBy: { id: 'asc' },
          select: { first_name: true, last_name: true, email: true },
        });
        if (orgAdmin?.email) {
          const fullName = `${orgAdmin.first_name ?? ''} ${orgAdmin.last_name ?? ''}`.trim() || 'Org Admin';
          return { name: fullName, email: orgAdmin.email };
        }
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `[resolveFromForAction] failed for store ${store_id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent) {
    const customer_text = event.customer_name
      ? ` de ${event.customer_name}`
      : '';

    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_order',
      'Nueva Orden',
      `Orden #${event.order_number}${customer_text} por $${event.grand_total} ${event.currency}`,
      { order_id: event.order_id, order_number: event.order_number },
    );
  }

  @OnEvent('order.status_changed')
  async handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'order_status_change',
      'Estado de Orden Actualizado',
      `Orden #${event.order_number}: ${event.old_state} → ${event.new_state}`,
      { order_id: event.order_id, order_number: event.order_number },
    );
  }

  /**
   * Vendix Repartos — Fase B5. Un admin publicó una orden al pool de
   * repartidores (evento emitido por `DispatchNotesService.sendToDispatchPool`).
   * Resolvemos los carriers de la tienda (usuarios de `store_users` con rol
   * `carrier`) y les entregamos una notificación DIRIGIDA (patrón
   * `handleBookingStarted`, multi-destinatario). Si no hay carriers resueltos,
   * caemos a un broadcast de tienda para no perder la señal.
   */
  @OnEvent('order.awaiting_carrier')
  async handleOrderAwaitingCarrier(event: {
    order_id: number;
    store_id: number;
  }) {
    let carrierUserIds: number[] = [];
    try {
      const rows = await this.global_prisma.store_users.findMany({
        where: {
          store_id: event.store_id,
          user: { user_roles: { some: { roles: { name: 'carrier' } } } },
        },
        select: { user_id: true },
      });
      carrierUserIds = rows.map((r) => r.user_id);
    } catch (err: any) {
      this.logger.error(
        `[handleOrderAwaitingCarrier] Failed to resolve carriers: ${err.message}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    // order_number para un mensaje más amigable (best-effort).
    let order_number: string | null = null;
    try {
      const order = await this.global_prisma.orders.findUnique({
        where: { id: event.order_id },
        select: { order_number: true },
      });
      order_number = order?.order_number ?? null;
    } catch {
      // best-effort; el número no es crítico para la notificación.
    }

    const title = 'Pedido disponible para reparto';
    const body = order_number
      ? `El pedido #${order_number} está disponible para tomar`
      : 'Hay un pedido disponible para tomar';
    const data = {
      order_id: event.order_id,
      kind: 'awaiting_carrier',
      route: '/repartos/pool',
    };

    if (carrierUserIds.length > 0) {
      for (const user_id of carrierUserIds) {
        await this.notifications_service.sendToUser(
          event.store_id,
          user_id,
          'order_awaiting_carrier',
          title,
          body,
          data,
        );
      }
    } else {
      // Sin carriers → broadcast de tienda (mejor sobre-notificar la campana).
      await this.notifications_service.createAndBroadcast(
        event.store_id,
        'order_awaiting_carrier',
        title,
        body,
        data,
      );
    }
  }

  /**
   * Vendix Repartos — Fase B5. Limpieza del pool de repartos.
   *
   * El plan pedía @OnEvent('order.cancelled') / @OnEvent('order.refunded'),
   * pero el repo NO emite esos nombres de evento. El evento de ciclo de vida
   * real y cableado es `order.status_changed`, que se dispara con
   * new_state='cancelled' (ruta de cancelación en order-flow) o 'refunded'
   * (refund total, refund-flow.service.ts). Enganchamos ese emisor existente
   * (no inventamos emisor) y, al llegar a un estado terminal cancelled/refunded,
   * sacamos la orden del pool y soltamos cualquier claim huérfano. Idempotente
   * (poner null sobre null no falla). Es un segundo @OnEvent para el mismo
   * evento, junto al handler de notificación de arriba (EventEmitter2 lo
   * permite).
   */
  @OnEvent('order.status_changed')
  async handleOrderStateForPoolCleanup(event: OrderStatusChangedEvent) {
    if (event.new_state !== 'cancelled' && event.new_state !== 'refunded') {
      return;
    }
    try {
      await this.global_prisma.orders.updateMany({
        where: { id: event.order_id, store_id: event.store_id },
        data: { dispatch_pool_at: null, claimed_by_carrier_user_id: null },
      });
      // La orden salió del pool (cancelada/reembolsada) → notificar al stream
      // SSE de repartidores para que la retiren de su lista en vivo.
      this.event_emitter.emit('carrier.pool.changed', {
        store_id: event.store_id,
      });
    } catch (err: any) {
      this.logger.error(
        `[handleOrderStateForPoolCleanup] Failed for order ${event.order_id}: ${err.message}`,
      );
    }
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(event: PaymentReceivedEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'payment_received',
      'Pago Recibido',
      `Pago de $${event.amount} ${event.currency} para orden #${event.order_number}`,
      { order_id: event.order_id, payment_method: event.payment_method },
    );
  }

  @OnEvent('customer.created')
  async handleNewCustomer(event: NewCustomerEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_customer',
      'Nuevo Cliente',
      `${event.first_name} ${event.last_name} se registró`,
      { customer_id: event.customer_id, email: event.email },
    );
  }

  @OnEvent('stock.low')
  async handleLowStock(event: {
    store_id: number;
    location_id?: number;
    product_id: number;
    product_name: string;
    quantity: number;
    threshold: number;
  }) {
    // Look up the location name, scope-checked to the event's store_id to
    // avoid leaking warehouse names across tenants. location_id may be
    // undefined if the stock write didn't pass a location (defensive).
    let locationName: string | null = null;
    if (event.location_id != null) {
      const location = await this.global_prisma.inventory_locations.findFirst({
        where: { id: event.location_id, store_id: event.store_id },
        select: { name: true },
      });
      locationName = location?.name ?? null;
    }

    const locationSuffix = locationName ? ` en ${locationName}` : '';
    const titleWithLocation = locationName
      ? `Stock Bajo — ${locationName}`
      : 'Stock Bajo';

    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'low_stock',
      titleWithLocation,
      `${event.product_name} tiene solo ${event.quantity} unidades (umbral: ${event.threshold})${locationSuffix}`,
      {
        product_id: event.product_id,
        location_id: event.location_id ?? null,
        location_name: locationName,
        quantity: event.quantity,
        threshold: event.threshold,
      },
    );
  }

  // ===== LAYAWAY EVENTS =====

  @OnEvent('layaway.created')
  async handleLayawayCreated(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    total_amount: number;
  }) {
    const customer = await this.global_prisma.users.findUnique({
      where: { id: event.customer_id },
      select: { first_name: true, last_name: true },
    });
    const customer_name = customer
      ? `${customer.first_name} ${customer.last_name}`
      : 'Cliente';

    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_completed', // reuse type for "created" since there's no specific one — actually use a valid type
      'Nuevo Plan Separé',
      `Plan ${event.plan_number} creado para ${customer_name} por $${event.total_amount}`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  @OnEvent('layaway.payment_received')
  async handleLayawayPaymentReceived(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    payment_id: number;
    amount: number;
    customer_id: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_payment_received',
      'Pago de Plan Separé Recibido',
      `Pago de $${event.amount} recibido para plan ${event.plan_number}`,
      { plan_id: event.plan_id, payment_id: event.payment_id },
    );
  }

  @OnEvent('layaway.completed')
  async handleLayawayCompleted(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    total_amount: any;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_completed',
      'Plan Separé Completado',
      `El plan ${event.plan_number} ha sido completado. Total: $${event.total_amount}`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  @OnEvent('layaway.cancelled')
  async handleLayawayCancelled(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    paid_amount: any;
    cancellation_reason: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_cancelled',
      'Plan Separé Cancelado',
      `El plan ${event.plan_number} ha sido cancelado. Monto pagado: $${event.paid_amount}`,
      { plan_id: event.plan_id, reason: event.cancellation_reason },
    );
  }

  @OnEvent('layaway.overdue')
  async handleLayawayOverdue(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    overdue_count: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_overdue',
      'Cuota de Plan Separé Vencida',
      `El plan ${event.plan_number} tiene ${event.overdue_count} cuota(s) vencida(s)`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  // ===== CREDIT INSTALLMENT EVENTS =====

  @OnEvent('installment_payment.received')
  async handleInstallmentPaymentReceived(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    installment_id: number;
    installment_number: number;
    payment_id: number;
    amount: number;
    customer_id: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'installment_paid',
      'Pago de Cuota Recibido',
      `Pago de $${event.amount} recibido - Cuota #${event.installment_number} - Crédito ${event.credit_number}`,
      {
        credit_id: event.credit_id,
        installment_id: event.installment_id,
        payment_id: event.payment_id,
      },
    );
  }

  @OnEvent('credit.completed')
  async handleCreditCompleted(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    customer_id: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'credit_completed',
      'Crédito Completado',
      `Crédito ${event.credit_number} pagado en su totalidad`,
      { credit_id: event.credit_id, credit_number: event.credit_number },
    );
  }

  @OnEvent('installment.reminder')
  async handleInstallmentReminder(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    installment_id: number;
    installment_number: number;
    customer_id: number;
    amount: number;
    due_date: Date;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'installment_reminder',
      'Recordatorio de Cuota',
      `Cuota #${event.installment_number} vence en 3 días ($${event.amount}) - Crédito ${event.credit_number}`,
      {
        credit_id: event.credit_id,
        installment_id: event.installment_id,
        due_date: event.due_date,
      },
    );
  }

  @OnEvent('installment.overdue')
  async handleInstallmentOverdue(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    installment_id: number;
    installment_number: number;
    customer_id: number;
    amount: number;
    due_date: Date;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'installment_overdue',
      'Cuota Vencida',
      `Cuota #${event.installment_number} vencida - Crédito ${event.credit_number} ($${event.amount})`,
      {
        credit_id: event.credit_id,
        installment_id: event.installment_id,
        due_date: event.due_date,
      },
    );
  }

  /**
   * QUI-647 — cuota de Cuentas por Pagar que está por vencer.
   *
   * Espejo de `installment.due_soon` del lado del cliente: aquel avisa que un
   * cliente nos debe, este que le debemos al proveedor. Antes de este ticket el
   * módulo de notificaciones no mencionaba `accounts_payable` en ninguna línea.
   */
  @OnEvent('ap_installment.due_soon')
  async handleApInstallmentDueSoon(event: {
    store_id: number;
    accounts_payable_id: number;
    schedule_id: number;
    supplier_id: number;
    supplier_name: string;
    document_number: string | null;
    amount: number;
    scheduled_date: Date;
  }) {
    // QUI-647 — el payload ya traía `document_number` y el listener lo
    // descartaba; el operador necesita saber QUÉ documento vence, no solo
    // cuánto y a quién.
    const docLabel = event.document_number
      ? ` del documento ${event.document_number}`
      : '';
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'ap_installment_due_soon',
      'Pago a proveedor por vencer',
      `Cuota de $${event.amount}${docLabel} a ${event.supplier_name} vence pronto`,
      {
        accounts_payable_id: event.accounts_payable_id,
        schedule_id: event.schedule_id,
        supplier_id: event.supplier_id,
        due_date: event.scheduled_date,
      },
    );
  }

  /**
   * QUI-647 — cuota de CxP ya vencida. Se re-emite en cada barrido mientras
   * siga impaga: una deuda vencida avisada una sola vez y luego callada hace
   * creer al operador que se resolvió.
   */
  @OnEvent('ap_installment.overdue')
  async handleApInstallmentOverdue(event: {
    store_id: number;
    accounts_payable_id: number;
    schedule_id: number;
    supplier_id: number;
    supplier_name: string;
    document_number: string | null;
    amount: number;
    scheduled_date: Date;
  }) {
    // QUI-647 — `document_number` en el texto (ver handleApInstallmentDueSoon).
    const docLabel = event.document_number
      ? ` del documento ${event.document_number}`
      : '';
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'ap_installment_overdue',
      'Pago a proveedor vencido',
      `Cuota de $${event.amount}${docLabel} a ${event.supplier_name} está vencida`,
      {
        accounts_payable_id: event.accounts_payable_id,
        schedule_id: event.schedule_id,
        supplier_id: event.supplier_id,
        due_date: event.scheduled_date,
      },
    );
  }

  @OnEvent('layaway.payment_reminder')
  async handleLayawayPaymentReminder(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    due_date: string;
    amount: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_payment_reminder',
      'Recordatorio de Cuota',
      `Cuota de $${event.amount} del plan ${event.plan_number} vence el ${event.due_date}`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  // ===== INVOICE EMAIL EVENTS =====

  /**
   * Asunto del correo de entrega — Anexo Técnico FEV 1.9 §9.1 (p. 635-636).
   *
   * La DIAN fija el formato del asunto con el que el emisor entrega el
   * documento electrónico al adquiriente. No es una etiqueta legible: es un
   * contrato de cinco campos separados por «;» que el software de recepción del
   * adquiriente parsea. El asunto artesanal que había aquí
   * —«{razón social} - Factura {número}»— no cumplía ninguno de los cinco.
   *
   * Dos decisiones que el lector merece ver explícitas:
   *
   * 1. Solo se aplica al documento ELECTRÓNICO. `dian_status =
   *    'not_applicable'` marca el recibo interno que nunca fue a la DIAN; §9.1
   *    gobierna la entrega del documento electrónico, así que imponerle el
   *    formato normativo sería inventar alcance. Ese caso conserva el asunto
   *    legible.
   * 2. Ante una identidad fiscal incompleta `buildDianEmailSubject` LANZA. Aquí
   *    eso NO puede tumbar el envío: hoy el correo sale siempre, y dejar al
   *    adquiriente sin su factura por una razón social ausente es una
   *    regresión peor que un asunto no normativo. Se registra el campo que
   *    falta y se cae al asunto legible — nunca a un asunto normativo a medias,
   *    que es lo único que el receptor no puede detectar.
   */
  private buildInvoiceEmailSubject(
    invoice: any,
    fallback_store_name: string,
  ): string {
    const fallback = `${fallback_store_name} - Factura ${invoice.invoice_number}`;

    if (invoice.dian_status === 'not_applicable') {
      return fallback;
    }

    try {
      const org = invoice.organization as any;
      const store = invoice.store as any;

      // Misma decisión de alcance que `InvoicePdfService.resolveIssuer`: bajo
      // `fiscal_scope = 'STORE'` la identidad del emisor vive en los ajustes de
      // la TIENDA. Leer `organizations.tax_id` a pelo —lo que hacía este
      // listener para `store_nit`— hace que el asunto discrepe del XML firmado.
      const scope: string = org?.fiscal_scope ?? 'STORE';
      const scoped_settings =
        scope === 'STORE'
          ? store?.store_settings?.settings
          : org?.organization_settings?.settings;
      const owner = scope === 'STORE' ? store : org;

      // El resolvedor permisivo, no una precedencia copiada: es el mismo que
      // alimenta el PDF y el XML, así que los tres coinciden por construcción.
      const { identity } = tryResolveTenantFiscalIdentity({
        nit: org?.tax_id || store?.tax_id || '',
        fiscal_data: ((scoped_settings as any)?.fiscal_data ?? null) as
          | Record<string, unknown>
          | null,
        entity: org ? { legal_name: org.legal_name, name: org.name } : null,
        organization: org
          ? {
              legal_name: org.legal_name,
              name: org.name,
              email: org.email,
              phone: org.phone,
              document_type: org.document_type,
              person_type: org.person_type,
            }
          : null,
        email: org?.email,
      });

      return buildDianEmailSubject({
        issuer_nit: identity.nit,
        issuer_legal_name: identity.legal_name,
        document_number: invoice.invoice_number,
        document_type_code: resolveDianDocumentTypeCode(invoice.invoice_type),
        issuer_trade_name: owner?.name,
      });
    } catch (error) {
      this.logger.warn(
        `Invoice #${invoice.invoice_number}: DIAN subject unavailable, ` +
          `falling back to the legible form — ${error?.message ?? error}`,
      );
      return fallback;
    }
  }

  @OnEvent('invoice.pdf.generated')
  async handleInvoicePdfGenerated(payload: {
    invoice_id: number;
    pdf_key: string;
  }) {
    try {
      // 1. Load invoice with customer and organization data
      const invoice = await this.global_prisma.invoices.findUnique({
        where: { id: payload.invoice_id },
        include: {
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              legal_name: true,
              tax_id: true,
              phone: true,
              email: true,
              addresses: { take: 1 },
              // Fuentes de la identidad fiscal del EMISOR. Sin ellas el asunto
              // normativo (Anexo 1.9 §9.1) tendría que leer
              // `organizations.tax_id` a pelo y discreparía del XML firmado en
              // toda organización con `fiscal_scope = 'STORE'`.
              fiscal_scope: true,
              document_type: true,
              person_type: true,
              organization_settings: { select: { settings: true } },
            },
          },
          store: {
            select: {
              id: true,
              name: true,
              legal_name: true,
              tax_id: true,
              store_settings: { select: { settings: true } },
            },
          },
          invoice_items: true,
        },
      });

      if (!invoice) {
        this.logger.warn(
          `Invoice #${payload.invoice_id} not found for email sending`,
        );
        return;
      }

      // 2. Check if email was already sent
      if (invoice.email_sent_at) {
        this.logger.log(
          `Email already sent for invoice #${invoice.invoice_number}, skipping`,
        );
        return;
      }

      // 3. Determine customer email
      const customer = invoice.customer as any;
      const customer_email = customer?.email;

      if (!customer_email) {
        this.logger.log(
          `No customer email for invoice #${invoice.invoice_number}, skipping email`,
        );
        return;
      }

      // 4. Entrega normativa — delegada, NO reimplementada.
      //
      // Hasta este cambio, la entrega PRIMARIA armaba aquí un `EmailAttachment[]`
      // con el PDF descargado de S3 y el XML crudo como DOS adjuntos sueltos. Eso
      // no cumple el Anexo Técnico 1.9 §9.1, que exige UN único `.zip` con un
      // `AttachedDocument` que embeba el XML firmado y lleve la representación
      // gráfica. El reenvío de conveniencia (E.6) sí lo cumplía desde
      // `InvoiceDeliveryService.deliver()`, así que el sistema tenía DOS caminos
      // de entrega y sólo el manual era normativo — justo al revés de lo que
      // importa, porque el automático es el que recibe el adquiriente en toda
      // venta emitida.
      //
      // No se duplica la lógica del ZIP: son 500+ líneas ya probadas contra
      // `UBL-AttachedDocument-2.1.xsd` (F.12). Duplicarlas crearía dos
      // implementaciones del mismo predicado normativo que divergirían, que es
      // exactamente el defecto que D.9 tuvo que unificar en la gravabilidad AIU.
      //
      // `runIsolated` y no `run`: `deliver()` usa `StorePrismaService`, con
      // alcance por tienda, y este listener corre fuera del request. Forjar el
      // contexto con `run` dejaría el tenant en el estático de clase y el
      // siguiente ejecutor fuera del ALS lo adoptaría en silencio. Mismo patrón
      // que `pos-sale-completed.listener.ts`. No se pasa `user_id` a propósito:
      // la entrega automática no la ejecuta ninguna persona, y `deliver()` deja
      // `created_by: null` al leerlo del contexto.
      const delivery = await RequestContextService.runIsolated(
        {
          organization_id: invoice.organization_id,
          store_id: invoice.store_id,
          is_super_admin: false,
          is_owner: false,
        },
        () =>
          this.invoice_delivery_service.deliver(invoice.id, {
            email: customer_email,
          }),
      );

      // 5. `deliver()` ya escribió su fila en `invoice_delivery_events` con el
      // escritor compartido, y ya lanzó si el proveedor de correo falló. Aquí no
      // se repite la traza: dos filas por una sola entrega volverían inútil la
      // auditoría que E.10 construyó.
      //
      // Se conserva la regla de E.10 intacta: «entregado» NO es «el proveedor
      // aceptó el correo». Si el ZIP no pudo armarse —factura sin `xml_document`,
      // S3 caído, o el tope de 2 MB descartándolo todo— `deliver()` devuelve
      // `zip_name: null` y el correo salió sin factura adjunta. Eso no es una
      // entrega, y no se estampa.
      const delivered = !!delivery.zip_name;

      if (delivered) {
        // 6. Estampa de idempotencia. Va DESPUÉS de la traza que escribió
        // `deliver()`, igual que antes: si esto falla, la factura queda sin
        // `email_sent_at` y el guardia de arriba deja reintentar. Al revés se
        // reintroduciría una entrega estampada que ninguna fila audita, y esa sí
        // es irrecuperable.
        await this.global_prisma.invoices.update({
          where: { id: payload.invoice_id },
          data: { email_sent_at: new Date() },
        });

        this.logger.log(
          `Factura #${invoice.invoice_number} entregada a ${customer_email} — ${delivery.zip_name}`,
        );
      } else {
        this.logger.error(
          `Factura #${invoice.invoice_number}: el correo salió SIN el zip normativo (§9.1) — no se cuenta como entregada`,
        );
      }
    } catch (error) {
      // Never throw - email failures should not break any flow
      this.logger.error(
        `Error in handleInvoicePdfGenerated for invoice #${payload.invoice_id}: ${error.message}`,
      );
    }
  }

  // ===== BOOKING EVENTS =====

  @OnEvent('booking.created')
  async handleBookingCreated(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
    channel: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_created',
      'Nueva Reserva',
      `Reserva ${event.booking_number} - ${event.service_name} para ${event.customer_name} el ${event.date} a las ${event.start_time} (${event.channel})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.confirmed')
  async handleBookingConfirmed(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_confirmed',
      'Reserva Confirmada',
      `Reserva ${event.booking_number} confirmada - ${event.service_name} para ${event.customer_name} el ${event.date} a las ${event.start_time}`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.cancelled')
  async handleBookingCancelled(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_cancelled',
      'Reserva Cancelada',
      `Reserva ${event.booking_number} cancelada - ${event.service_name} de ${event.customer_name} (${event.date} ${event.start_time})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.no_show')
  async handleBookingNoShow(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_no_show',
      'No Show',
      `${event.customer_name} no asistió a ${event.service_name} - Reserva ${event.booking_number} (${event.date} ${event.start_time})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.reminder')
  async handleBookingReminder(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_reminder',
      'Recordatorio de Reserva',
      `Recordatorio: ${event.customer_name} tiene reserva de ${event.service_name} mañana a las ${event.start_time} (${event.booking_number})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.rescheduled')
  async handleBookingRescheduled(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    new_date: string;
    new_start_time: string;
    new_end_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_rescheduled',
      'Reserva Reprogramada',
      `Reserva ${event.booking_number} reprogramada al ${event.new_date} a las ${event.new_start_time}`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  /**
   * "Your turn is now" alert.
   *
   * Emitted by `reservations.service.ts → start()` when a cashier or admin
   * marks a booking as `in_progress`. Resolves the provider's `user_id`
   * (provider → employee.user_id) and sends a TARGETED notification only to
   * that user — other users in the store do NOT receive this event.
   *
   * Falls back to store-wide broadcast if the provider has no `user_id`
   * linked (e.g. the employee record was created without a login) — better
   * to over-notify the bell than to silently swallow.
   *
   * Uses the `booking_attending` enum value so the frontend can apply a
   * distinctive sound + auto-route to the booking detail page via the
   * "attending" data kind.
   */
  @OnEvent('booking.started')
  async handleBookingStarted(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    provider_id?: number;
    date: string;
    start_time: string;
  }) {
    let provider_user_id: number | null = null;

    if (event.provider_id) {
      try {
        const provider =
          await this.global_prisma.service_providers.findUnique({
            where: { id: event.provider_id },
            include: { employee: { select: { user_id: true } } },
          });
        provider_user_id =
          (provider as any)?.employee?.user_id ?? null;
      } catch (err: any) {
        this.logger.error(
          `[handleBookingStarted] Failed to resolve provider user: ${err.message}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    const title = `Tu turno: ${event.customer_name}`;
    const body = `${event.service_name} — ${event.start_time} (${event.booking_number})`;
    const data = {
      booking_id: event.booking_id,
      booking_number: event.booking_number,
      kind: 'attending',
      start_time: event.start_time,
    };

    if (provider_user_id) {
      await this.notifications_service.sendToUser(
        event.store_id,
        provider_user_id,
        'booking_attending',
        title,
        body,
        data,
      );
    } else {
      // Fallback: broadcast to the store (provider mapping missing).
      await this.notifications_service.createAndBroadcast(
        event.store_id,
        'booking_attending',
        title,
        body,
        data,
      );
    }
  }

  @OnEvent('booking.completed')
  async handleBookingCompleted(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_completed',
      'Reserva Completada',
      `Reserva ${event.booking_number} completada - ${event.service_name} de ${event.customer_name} (${event.date} ${event.start_time})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  // ===== REVIEW EVENTS =====

  @OnEvent('review.created')
  async handleNewReview(event: {
    store_id: number;
    review_id: number;
    product_id: number;
    product_name: string;
    customer_name: string;
    rating: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_review',
      'Nueva Reseña',
      `${event.customer_name} dejó una reseña de ${'★'.repeat(event.rating)}${'☆'.repeat(5 - event.rating)} para ${event.product_name}`,
      {
        review_id: event.review_id,
        product_id: event.product_id,
        route: `/admin/customers/reviews?review_id=${event.review_id}`,
      },
    );
  }

  // ===== CUSTOMER QUEUE EVENTS =====

  @OnEvent('queue.entry_added')
  async handleQueueEntryAdded(event: QueueEntryEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'customer_queue_new',
      'Nuevo cliente en cola',
      `${event.first_name} ${event.last_name} se registró en la cola (posición #${event.position})`,
      {
        entry_id: event.entry_id,
        token: event.token,
        position: event.position,
      },
    );
  }

  @OnEvent('queue.entry_selected')
  async handleQueueEntrySelected(event: QueueEntryEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'customer_queue_selected',
      'Cliente seleccionado de cola',
      `${event.first_name} ${event.last_name} fue seleccionado`,
      { entry_id: event.entry_id, token: event.token },
    );
  }

  @OnEvent('queue.entry_consumed')
  async handleQueueEntryConsumed(event: QueueEntryEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'customer_queue_consumed',
      'Cliente procesado',
      `${event.first_name} ${event.last_name} fue procesado`,
      { entry_id: event.entry_id, token: event.token },
    );
  }

  @OnEvent('queue.entry_cancelled')
  async handleQueueEntryCancelled(event: QueueEntryEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'customer_queue_cancelled',
      'Cliente cancelado de cola',
      `${event.first_name} ${event.last_name} fue removido de la cola`,
      { entry_id: event.entry_id, token: event.token },
    );
  }

  @OnEvent('queue.entry_released')
  async handleQueueEntryReleased(event: QueueEntryEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'customer_queue_released',
      'Cliente liberado',
      `${event.first_name} ${event.last_name} volvió a la cola`,
      { entry_id: event.entry_id, token: event.token },
    );
  }

  // ===== INVOICE DATA REQUEST EVENTS =====

  @OnEvent('invoice_data_request.submitted')
  async handleInvoiceDataRequestSubmitted(event: InvoiceDataRequestEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'invoice_data_request_submitted',
      'Solicitud de factura recibida',
      `${event.customer_name || 'Un cliente'} (${event.document_number || 'S/D'}) envió datos para facturación de la orden #${event.order_id}`,
      {
        request_id: event.request_id,
        order_id: event.order_id,
        token: event.token,
      },
    );
  }

  // ==========================================
  // DATA COLLECTION & CONSULTATION EVENTS
  // ==========================================

  @OnEvent('data_collection.submission_created')
  async handleSubmissionCreated(event: {
    store_id: number;
    submission_id: number;
    token: string;
    booking_id?: number;
    customer_id?: number;
  }) {
    // 1. In-app notification to staff
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'data_collection_created',
      'Formulario de Preconsulta Creado',
      `Se ha generado un formulario de preconsulta${event.booking_id ? ` para la reserva #${event.booking_id}` : ''}`,
      { submission_id: event.submission_id, booking_id: event.booking_id },
    );

    // 2. Send email to customer with form link
    if (event.customer_id && event.token) {
      try {
        const customer = await this.global_prisma.users.findUnique({
          where: { id: event.customer_id },
          select: { email: true, first_name: true, last_name: true },
        });

        if (customer?.email) {
          const formUrl = await this.buildPublicFormUrl(
            event.store_id,
            event.token,
          );
          const customerName =
            `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
            'cliente';

          // Look up store name for branding
          const store = await this.global_prisma.stores.findUnique({
            where: { id: event.store_id },
            select: { name: true },
          });
          const storeName = store?.name || 'la tienda';
          const fromOverride = await this.resolveFromForAction(
            undefined,
            event.store_id,
          );

          await this.email_service.sendEmail(
            customer.email,
            `Completa tu formulario de preconsulta - ${storeName}`,
            `
              <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #1a1a1a; margin-bottom: 8px;">Formulario de Preconsulta</h2>
                <p style="color: #444; line-height: 1.6;">
                  Hola ${customerName},
                </p>
                <p style="color: #444; line-height: 1.6;">
                  Te hemos preparado un formulario de preconsulta para tu próxima cita en <strong>${storeName}</strong>.
                  Por favor, complétalo antes de tu visita para que podamos brindarte una mejor atención.
                </p>
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${formUrl}"
                     style="display: inline-block; background-color: #7ED7A5; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    Completar Formulario
                  </a>
                </div>
                <p style="color: #888; font-size: 13px; line-height: 1.5;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
                  <a href="${formUrl}" style="color: #7ED7A5; word-break: break-all;">${formUrl}</a>
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="color: #999; font-size: 12px;">
                  Este correo fue enviado por ${storeName}. Si no solicitaste este formulario, puedes ignorar este mensaje.
                </p>
              </div>
            `,
          );
          this.logger.log(
            `Preconsulta email sent to ${customer.email} for submission ${event.submission_id}`,
          );
        }
      } catch (error) {
        this.logger.error(`Failed to send preconsulta email: ${error.message}`);
      }
    }
  }

  @OnEvent('data_collection.submitted')
  async handleSubmissionSubmitted(event: {
    store_id: number;
    submission_id: number;
    booking_id?: number;
    customer_id?: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'data_collection_submitted',
      'Formulario de Preconsulta Completado',
      `Un cliente ha completado su formulario de preconsulta${event.booking_id ? ` para la reserva #${event.booking_id}` : ''}`,
      { submission_id: event.submission_id, booking_id: event.booking_id },
    );
  }

  @OnEvent('data_collection.prediagnosis_ready')
  async handlePrediagnosisReady(event: {
    submission_id: number;
    store_id?: number;
  }) {
    if (!event.store_id) return;
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'data_collection_prediagnosis_ready',
      'Prediagnóstico IA Listo',
      `El prediagnóstico IA está listo para revisión`,
      { submission_id: event.submission_id },
    );
  }

  @OnEvent('booking.checked_in')
  async handleBookingCheckedIn(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    provider_id?: number;
    source: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_arrival',
      'Cliente en sala de espera',
      `${event.customer_name} en sala de espera para ${event.service_name} (${event.booking_number})`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        customer_name: event.customer_name,
        service_name: event.service_name,
        provider_id: event.provider_id,
        source: event.source,
        kind: 'arrival',
      },
    );
  }

  @OnEvent('booking.confirmation_request')
  async handleBookingConfirmationRequest(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    booking_date: any;
    booking_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_confirmation_request',
      'Solicitud de Confirmación Enviada',
      `Se solicitó confirmación a ${event.customer_name} para ${event.service_name} (${event.booking_number})`,
      { booking_id: event.booking_id },
    );
  }

  @OnEvent('booking.auto_cancelled')
  async handleBookingAutoCancelled(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    reason: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_auto_cancelled',
      'Reserva Cancelada Automáticamente',
      `La reserva ${event.booking_number} de ${event.customer_name} fue cancelada por no confirmación`,
      { booking_id: event.booking_id, reason: event.reason },
    );
  }

  // ===== APPOINTMENT REDESIGN EVENTS (phase 1) =====

  /**
   * "Tu cita está por comenzar" — emitted by BookingProximityJob at T-30/T-15/T-5.
   * Reaches both staff (POS panel) and the customer (push/SSE).
   */
  @OnEvent('appointment.upcoming')
  async handleAppointmentUpcoming(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    proximity_minutes: number;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'appointment_upcoming',
      'Tu cita está por comenzar',
      `${event.customer_name}, tu reserva ${event.booking_number} de ${event.service_name} comienza en ${event.proximity_minutes} minutos (${event.start_time})`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        proximity_minutes: event.proximity_minutes,
        kind: 'proximity',
      },
    );
  }

  /**
   * Customer arrived at the venue (status arriving). Emitted by ReservationsService.checkIn.
   */
  @OnEvent('appointment.checked_in')
  async handleAppointmentCheckedIn(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    provider_id?: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'appointment_checked_in',
      'Cliente en sala de espera',
      `${event.customer_name} en sala de espera para ${event.service_name}`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        provider_id: event.provider_id,
        kind: 'arrival',
      },
    );
  }

  /**
   * Mirrors the queue promotion notification that
   * AppointmentQueueService.refreshAndBroadcastQueue emits directly via
   * notifications.createAndBroadcast. Other services emitting
   * 'appointment.queued' will also route here.
   */
  @OnEvent('appointment.queued')
  async handleAppointmentQueued(event: {
    store_id: number;
    booking_id: number;
    queue_position: number;
    customer_name: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'appointment_queued',
      'Tu turno se acerca',
      `${event.customer_name}, estás en la posición ${event.queue_position + 1} de la cola. Prepárate para tu cita.`,
      {
        booking_id: event.booking_id,
        queue_position: event.queue_position,
        kind: 'queue_promotion',
      },
    );
  }

  /**
   * Fired by ReservationsService.checkIn() whenever a booking gets a new
   * arrival_at. Triggers the smart queue recalculation + broadcast so the
   * customer promoted to rank 0 gets notified. Errors here must never crash
   * the listener chain — they're swallowed + logged.
   */
  @OnEvent('booking.arrival_recorded')
  async handleBookingArrivalRecorded(event: {
    store_id: number;
    booking_id: number;
    date: string;
  }) {
    try {
      await this.appointment_queue_service.refreshAndBroadcastQueue(
        event.store_id,
        event.date,
      );
    } catch (err: any) {
      this.logger.error(
        `[handleBookingArrivalRecorded] queue refresh failed for booking ${event.booking_id}: ${err.message}`,
      );
    }
  }

  /**
   * Fired by BookingConfirmationService.processToken when the double-validation
   * detects a slot conflict. The booking was confirmed anyway (decision: alert
   * staff to resolve manually) but they need a heads-up.
   */
  @OnEvent('booking.double_booking')
  async handleBookingDoubleBooking(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_attending',
      'Doble booking detectado',
      `Revisar reserva ${event.booking_number}: se confirmó pero el slot ya estaba ocupado. Resolver manualmente.`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        kind: 'double_booking',
      },
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private formatDate(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Build public form URL using the store's ecommerce domain.
   * Pattern from customer-queue QR generation.
   */
  private async buildPublicFormUrl(
    storeId: number,
    token: string,
  ): Promise<string> {
    try {
      // Prefer STORE_ECOMMERCE domain
      const ecommerceDomain =
        await this.global_prisma.domain_settings.findFirst({
          where: { store_id: storeId, app_type: 'STORE_ECOMMERCE' },
          select: { hostname: true },
        });
      if (ecommerceDomain?.hostname) {
        return `https://${ecommerceDomain.hostname}/preconsulta/${token}`;
      }

      // Fallback to primary domain
      const primaryDomain = await this.global_prisma.domain_settings.findFirst({
        where: { store_id: storeId, is_primary: true },
        select: { hostname: true },
      });
      if (primaryDomain?.hostname) {
        return `https://${primaryDomain.hostname}/preconsulta/${token}`;
      }
    } catch {
      // Fallback silently
    }

    return `https://vendix.com/preconsulta/${token}`;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Reschedule approval flow (appointment redesign phase 2)
  // ─────────────────────────────────────────────────────────────────────
  // Eventos nuevos: requested / approved / rejected / cancelled.
  // Cada uno dispara un in-app notification (broadcast al admin para
  // requested; targeted al customer para approved/rejected/cancelled)
  // y un email al customer cuando aplique.

  /**
   * Cliente pidió reagendar con aprobación — el admin debe decidir.
   * Broadcast a la tienda + email al admin con la info del cliente.
   */
  @OnEvent('booking.reschedule_requested')
  async handleBookingRescheduleRequested(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    request_id: number;
    requested_date: string;
    requested_start_time: string;
    requested_end_time: string;
    requested_by_customer_id: number | null;
    customer_name: string;
    service_name: string;
    reason: string | null;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_reschedule_requested',
      'Solicitud de reagenda',
      `${event.customer_name || 'Cliente'} pidió reagendar ${event.service_name || 'su reserva'} ` +
        `(${event.booking_number}) al ${event.requested_date} ${event.requested_start_time}`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        request_id: event.request_id,
        kind: 'reschedule_request',
      },
    );
  }

  /**
   * Admin aprobó la solicitud — el booking fue movido al slot solicitado.
   * Targeted al customer + email de confirmación.
   */
  @OnEvent('booking.reschedule_approved')
  async handleBookingRescheduleApproved(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    request_id: number;
    new_date: string;
    new_start_time: string;
    new_end_time: string;
    customer_id: number;
    decision_reason: string | null;
    decided_by_user_id: number;
  }) {
    await this.notifications_service.sendToUser(
      event.store_id,
      event.customer_id,
      'booking_reschedule_approved',
      'Tu reagenda fue aprobada',
      `Tu reserva ${event.booking_number} fue movida al ${event.new_date} a las ${event.new_start_time}`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        request_id: event.request_id,
        kind: 'reschedule_approved',
        new_date: event.new_date,
        new_start_time: event.new_start_time,
      },
    );

    // Email al customer (best-effort, no rompe el flow si falla).
    try {
      const customer = await this.global_prisma.users.findUnique({
        where: { id: event.customer_id },
        select: { email: true, first_name: true, last_name: true },
      });
      const store = await this.global_prisma.stores.findUnique({
        where: { id: event.store_id },
        select: { name: true },
      });
      if (customer?.email) {
        const fullName = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim();
        const subject = `Tu reagenda fue aprobada - ${store?.name ?? 'tu tienda'}`;
        const html = `
          <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">Tu reagenda fue aprobada</h2>
            <p>Hola ${fullName || ''},</p>
            <p>Tu solicitud de reagenda para la reserva <strong>${event.booking_number}</strong> fue aprobada.</p>
            <p><strong>Nuevo horario:</strong> ${event.new_date} a las ${event.new_start_time} - ${event.new_end_time}</p>
            ${event.decision_reason ? `<p><em>Nota del equipo:</em> ${event.decision_reason}</p>` : ''}
            <p>¡Te esperamos!</p>
          </div>`;
        // Appointment redesign phase 2 — send FROM the person who
        // actually decided (the admin/staff in session). If that lookup
        // misses, falls back to store owner / org admin / platform default.
        // `resolveFromForAction` is best-effort; returns null on error.
        const fromOverride = await this.resolveFromForAction(
          event.decided_by_user_id,
          event.store_id,
        );
        await this.email_service.sendEmail(
          customer.email,
          subject,
          html,
          undefined,
          fromOverride ?? undefined,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[handleBookingRescheduleApproved] email fallback failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Admin rechazó la solicitud — el booking se queda en su slot original.
   * Targeted al customer + email con la razón del rechazo.
   */
  @OnEvent('booking.reschedule_rejected')
  async handleBookingRescheduleRejected(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    request_id: number;
    customer_id: number;
    decision_reason: string;
    decided_by_user_id: number;
  }) {
    await this.notifications_service.sendToUser(
      event.store_id,
      event.customer_id,
      'booking_reschedule_rejected',
      'Tu reagenda fue rechazada',
      `Tu solicitud de reagenda para la reserva ${event.booking_number} fue rechazada. Razón: ${event.decision_reason}`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        request_id: event.request_id,
        kind: 'reschedule_rejected',
        decision_reason: event.decision_reason,
      },
    );

    try {
      const customer = await this.global_prisma.users.findUnique({
        where: { id: event.customer_id },
        select: { email: true, first_name: true, last_name: true },
      });
      const store = await this.global_prisma.stores.findUnique({
        where: { id: event.store_id },
        select: { name: true },
      });
      if (customer?.email) {
        const fullName = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim();
        const subject = `Tu reagenda fue rechazada - ${store?.name ?? 'tu tienda'}`;
        const html = `
          <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">Tu reagenda fue rechazada</h2>
            <p>Hola ${fullName || ''},</p>
            <p>Tu solicitud de reagenda para la reserva <strong>${event.booking_number}</strong> fue rechazada.</p>
            <p><strong>Razón:</strong> ${event.decision_reason}</p>
            <p>Si querés elegir otro horario, podés intentarlo de nuevo desde tu cuenta.</p>
          </div>`;
        // Appointment redesign phase 2 — send FROM the person who
        // actually decided (the admin/staff in session). If that lookup
        // misses, falls back to store owner / org admin / platform default.
        // `resolveFromForAction` is best-effort; returns null on error.
        const fromOverride = await this.resolveFromForAction(
          event.decided_by_user_id,
          event.store_id,
        );
        await this.email_service.sendEmail(
          customer.email,
          subject,
          html,
          undefined,
          fromOverride ?? undefined,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[handleBookingRescheduleRejected] email fallback failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * El cliente retiró su propia solicitud (o el admin la canceló).
   * Targeted al customer para confirmar la cancelación.
   */
  @OnEvent('booking.reschedule_cancelled')
  async handleBookingRescheduleCancelled(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    request_id: number;
    customer_id: number;
    cancelled_by_user_id: number | null;
  }) {
    await this.notifications_service.sendToUser(
      event.store_id,
      event.customer_id,
      'booking_reschedule_cancelled',
      'Solicitud cancelada',
      `Tu solicitud de reagenda para la reserva ${event.booking_number} fue cancelada.`,
      {
        booking_id: event.booking_id,
        booking_number: event.booking_number,
        request_id: event.request_id,
        kind: 'reschedule_cancelled',
      },
    );
  }
}

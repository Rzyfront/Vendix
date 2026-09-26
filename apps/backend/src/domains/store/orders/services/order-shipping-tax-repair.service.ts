import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { AuditService, AuditResource } from '@common/audit/audit.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  RepairShippingTaxDto,
  RepairShippingTaxAction,
} from '../dto/repair-shipping-tax.dto';
import {
  resolveInvoiceShippingTax,
  describeShippingTaxIncoherence,
} from '../../invoicing/invoicing.service';

/** Copia del impuesto del envío tal como queda tras la reparación. */
export interface RepairedShippingTaxCopy {
  shipping_tax_rate_id: number | null;
  shipping_tax_name: string | null;
  shipping_tax_type: string | null;
  shipping_tax_rate: number | null;
  shipping_tax_amount: number;
}

export interface RepairShippingTaxResult {
  order_id: number;
  action: RepairShippingTaxAction;
  shipping_tax: RepairedShippingTaxCopy;
  /** Eco de lectura: la reparación nunca los modifica. */
  shipping_cost: number;
  grand_total: number;
}

/** Factura que bloquea la reparación: emitida y vigente (no borrador). */
const LIVE_INVOICE_STATUSES = ['validated', 'sent', 'accepted'] as const;

/**
 * B5 — Repara la copia del impuesto del envío en órdenes ya despachadas.
 *
 * La guarda de facturación (`resolveInvoiceShippingTax`) manda hoy a
 * `assignShipping`, bloqueado justo en los estados donde se factura
 * (shipped/delivered/finished). Esta ruta es la salida real: completa la
 * copia desde su tarifa o la vacía, sin tocar `shipping_cost` ni
 * `grand_total`, para que la factura posterior se emita.
 *
 * Reglas (decisión del dueño):
 * - Permitida en cualquier estado salvo `cancelled`/`refunded`.
 * - Solo sin factura de venta vigente no borrador (409 si existe).
 * - `complete_rate` rellena name/type/rate desde `shipping_tax_rate_id`
 *   conservando el `amount`, y revalida el resultado con
 *   `resolveInvoiceShippingTax` antes de escribir (409 si queda incoherente,
 *   p.ej. `amount_not_below_cost`).
 * - `clear` deja la copia vacía y solo se permite si NO existe asiento de
 *   venta contabilizado con ese impuesto, sea cual sea su origen
 *   (`invoice.validated` / `payment.received` / `credit_sale.created`; 409
 *   si existe).
 * - Permiso `store:orders:update` (en el controlador), auditada con
 *   `auditService.logCustom`.
 */
@Injectable()
export class OrderShippingTaxRepairService {
  private readonly logger = new Logger(OrderShippingTaxRepairService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly auditService: AuditService,
  ) {}

  async repair(
    order_id: number,
    dto: RepairShippingTaxDto,
  ): Promise<RepairShippingTaxResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: {
        id: true,
        store_id: true,
        state: true,
        shipping_cost: true,
        grand_total: true,
        shipping_tax_rate_id: true,
        shipping_tax_name: true,
        shipping_tax_type: true,
        shipping_tax_rate: true,
        shipping_tax_amount: true,
      },
    });
    if (!order) {
      throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    }
    if (order.state === 'cancelled' || order.state === 'refunded') {
      throw new VendixHttpException(
        ErrorCodes.ORD_SHIPPING_TAX_REPAIR_BLOCKED_001,
        `La orden #${order.id} está ${order.state}: el impuesto del envío ya no se puede reparar.`,
        { order_id: order.id, state: order.state },
      );
    }

    const live_invoice = await this.prisma.invoices.findFirst({
      where: {
        order_id: order.id,
        invoice_type: 'sales_invoice',
        status: { in: [...LIVE_INVOICE_STATUSES] },
      },
      select: { id: true, invoice_number: true, status: true },
      orderBy: { id: 'desc' },
    });
    if (live_invoice) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CREATE_002,
        `La orden #${order.id} ya tiene la factura ${live_invoice.invoice_number} emitida: anúlala antes de reparar el impuesto del envío.`,
        {
          order_id: order.id,
          invoice_id: live_invoice.id,
          invoice_number: live_invoice.invoice_number,
          invoice_status: live_invoice.status,
        },
      );
    }

    const data =
      dto.action === 'clear'
        ? await this.buildClearData(order.id)
        : await this.buildCompleteRateData(order);

    // Paso 6 — `complete_rate` puede rellenar name/type/rate desde una
    // tarifa cuyo `amount` (conservado, nunca recalculado) ya no es coherente
    // con `shipping_cost` (p.ej. `shipping_tax_amount >= shipping_cost`). Se
    // revalida con la MISMA guarda que `createFromOrder` aplicará al facturar
    // (`resolveInvoiceShippingTax`) para no dejar "reparada" una copia que la
    // guarda de facturación seguiría rechazando — éxito falso.
    if (dto.action === 'complete_rate') {
      const projection = resolveInvoiceShippingTax({ ...order, ...data });
      if (!projection.applies && projection.reason !== 'none') {
        throw new VendixHttpException(
          ErrorCodes.ORD_SHIPPING_TAX_REPAIR_BLOCKED_001,
          `La orden #${order.id} quedaría con una copia de impuesto del envío incoherente: ${describeShippingTaxIncoherence(projection.reason)}.`,
          { order_id: order.id, reason: projection.reason },
        );
      }
    }

    const updated = await this.prisma.orders.updateMany({
      where: { id: order.id, store_id: order.store_id },
      // Solo columnas de la copia: `shipping_cost` y `grand_total` no se
      // tocan por decisión del dueño (la reparación no re-cobra).
      data,
    });
    if (updated.count === 0) {
      throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    }

    const after: RepairedShippingTaxCopy = {
      shipping_tax_rate_id:
        dto.action === 'clear' ? null : order.shipping_tax_rate_id,
      shipping_tax_name: (data.shipping_tax_name as string | null) ?? null,
      shipping_tax_type: (data.shipping_tax_type as string | null) ?? null,
      shipping_tax_rate:
        data.shipping_tax_rate == null
          ? null
          : Number(data.shipping_tax_rate),
      shipping_tax_amount:
        dto.action === 'clear' ? 0 : Number(order.shipping_tax_amount),
    };

    const context = RequestContextService.getContext();
    await this.auditService.logCustom(
      context?.user_id ?? 0,
      'order.shipping_tax.repaired',
      AuditResource.ORDERS,
      {
        order_id: order.id,
        store_id: order.store_id,
        action: dto.action,
        reason: dto.reason,
        before: {
          shipping_tax_rate_id: order.shipping_tax_rate_id,
          shipping_tax_name: order.shipping_tax_name,
          shipping_tax_type: order.shipping_tax_type,
          shipping_tax_rate:
            order.shipping_tax_rate == null
              ? null
              : Number(order.shipping_tax_rate),
          shipping_tax_amount: Number(order.shipping_tax_amount),
        },
        after,
      },
      order.id,
    );
    this.logger.log(
      `Impuesto del envío reparado (${dto.action}) en orden #${order.id}: ${dto.reason}`,
    );

    return {
      order_id: order.id,
      action: dto.action,
      shipping_tax: after,
      shipping_cost: Number(order.shipping_cost),
      grand_total: Number(order.grand_total),
    };
  }

  /**
   * `complete_rate`: name/type/rate desde la tarifa, `amount` intacto. La
   * tarifa puede ser de la tienda o global (`store_id` null), igual que al
   * vender — por eso se lee con `withoutScope()` y filtro explícito de
   * tenant, como `ShippingTaxService`.
   */
  private async buildCompleteRateData(order: {
    id: number;
    store_id: number;
    shipping_tax_rate_id: number | null;
  }): Promise<{
    shipping_tax_name: string;
    shipping_tax_type: 'iva' | 'inc';
    shipping_tax_rate: number;
  }> {
    if (order.shipping_tax_rate_id == null) {
      throw new VendixHttpException(
        ErrorCodes.ORD_SHIPPING_TAX_REPAIR_BLOCKED_001,
        `La orden #${order.id} no tiene tarifa de impuesto del envío: no hay desde dónde completar la copia (usa "clear" para vaciarla).`,
        { order_id: order.id, reason: 'missing_rate_id' },
      );
    }
    const rate = await this.prisma.withoutScope().tax_rates.findFirst({
      where: {
        id: order.shipping_tax_rate_id,
        OR: [{ store_id: order.store_id }, { store_id: null }],
      },
      select: {
        id: true,
        name: true,
        rate: true,
        tax_categories: { select: { tax_type: true } },
      },
    });
    if (!rate) {
      throw new VendixHttpException(
        ErrorCodes.ORD_SHIPPING_TAX_REPAIR_BLOCKED_001,
        `La tarifa ${order.shipping_tax_rate_id} del impuesto del envío ya no existe en esta tienda: no se puede completar la copia.`,
        {
          order_id: order.id,
          reason: 'rate_not_found',
          shipping_tax_rate_id: order.shipping_tax_rate_id,
        },
      );
    }
    const tax_type = rate.tax_categories?.tax_type ?? null;
    if (tax_type !== 'iva' && tax_type !== 'inc') {
      // Completar con un tipo fuera de iva/inc dejaría la copia igual de
      // incoherente ante la guarda (`unsupported_tax_type`): éxito falso.
      throw new VendixHttpException(
        ErrorCodes.ORD_SHIPPING_TAX_REPAIR_BLOCKED_001,
        `La tarifa "${rate.name}" no es IVA ni INC: completar la copia no la haría facturable (usa "clear" para vaciarla).`,
        {
          order_id: order.id,
          reason: 'rate_tax_type_not_supported',
          shipping_tax_rate_id: rate.id,
          tax_type,
        },
      );
    }
    return {
      shipping_tax_name: rate.name,
      shipping_tax_type: tax_type,
      shipping_tax_rate: Number(rate.rate),
    };
  }

  /**
   * `clear`: copia vacía, solo si NO existe asiento de venta contabilizado
   * con ese impuesto. El impuesto del envío puede haberse contabilizado por
   * tres orígenes distintos (OR), cada uno con su propia forma de
   * `source_id` (ver `vendix-auto-entries` / grep en
   * `accounting-events.listener.ts`):
   * - `invoice.validated` — nace al aceptar la factura de venta;
   *   `source_id` = id de la factura (`invoices.id`).
   * - `payment.received` — pago POS directo sin factura;
   *   `source_id` = id del pago (`payments.id`, filtrado por `order_id`).
   * - `credit_sale.created` — venta a crédito sin pago inmediato;
   *   `source_id` = id de la ORDEN misma (no hay fila hija propia).
   * Sobreviven a la anulación del documento que los originó: si cualquiera
   * existe y está `posted`, vaciar la copia reescribiría historia.
   */
  private async buildClearData(order_id: number): Promise<{
    shipping_tax_rate_id: null;
    shipping_tax_name: null;
    shipping_tax_type: null;
    shipping_tax_rate: null;
    shipping_tax_amount: number;
  }> {
    const [sales_invoices, order_payments] = await Promise.all([
      this.prisma.invoices.findMany({
        where: { order_id, invoice_type: 'sales_invoice' },
        select: { id: true },
      }),
      this.prisma.payments.findMany({
        where: { order_id },
        select: { id: true },
      }),
    ]);
    const invoice_ids = sales_invoices.map((row) => row.id);
    const payment_ids = order_payments.map((row) => row.id);

    const origins: Prisma.accounting_entriesWhereInput[] = [
      { source_type: 'credit_sale.created', source_id: order_id },
    ];
    if (invoice_ids.length > 0) {
      origins.push({
        source_type: 'invoice.validated',
        source_id: { in: invoice_ids },
      });
    }
    if (payment_ids.length > 0) {
      origins.push({
        source_type: 'payment.received',
        source_id: { in: payment_ids },
      });
    }

    const entry = await this.prisma.accounting_entries.findFirst({
      where: { status: 'posted', OR: origins },
      select: { id: true, entry_number: true, source_type: true },
    });
    if (entry) {
      throw new VendixHttpException(
        ErrorCodes.ORD_SHIPPING_TAX_REPAIR_BLOCKED_001,
        `La orden #${order_id} ya tiene el impuesto del envío contabilizado en el asiento ${entry.entry_number} (origen: ${entry.source_type}): no se puede vaciar la copia.`,
        {
          order_id,
          reason: 'posted_sale_entry',
          entry_id: entry.id,
          entry_number: entry.entry_number,
          source_type: entry.source_type,
        },
      );
    }
    return {
      shipping_tax_rate_id: null,
      shipping_tax_name: null,
      shipping_tax_type: null,
      shipping_tax_rate: null,
      shipping_tax_amount: 0,
    };
  }
}

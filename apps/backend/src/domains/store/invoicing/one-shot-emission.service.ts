import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  localDateString,
  resolveStoreTimezone,
} from 'src/common/utils/store-timezone.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PosFiscalEmissionService } from './pos/pos-fiscal-emission.service';
import { PosFiscalStatus } from './pos/pos-fiscal-status.interface';
import { assertNoActiveFinancialSplit } from '../orders/shared/financial-split-policy';
import { PaymentsService } from '../payments/payments.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { AccountsReceivableService } from '../accounts-receivable/accounts-receivable.service';
import { computeOrderUnpaidBalance } from './invoice-flow/invoice-flow.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import { InvoicingService, type CreateFromOrderOptions } from './invoicing.service';
import { EmitOrderCreditDto } from './dto/emit-order.dto';
import {
  describeHolderSource,
  evaluateOrderHolder,
  isCfOverridable,
} from './utils/order-acquirer-holder.util';
import { OrderLeaseService } from '../../../common/locks/order-lease.service';

/** A credit sale needs an identified holder: it is never issued as Consumidor final. */
export const CREDIT_FINAL_CONSUMER_MESSAGE =
  'Una venta a crédito no puede facturarse a Consumidor Final: completa los datos del cliente.';

/** Por qué una orden con saldo no puede facturarse a crédito (`null` = sí puede). */
export type CreditBlocker =
  | 'customer_required'
  | 'partial_payment'
  | 'order_state'
  | null;

export type OneShotEmissionState = 'issued' | 'pending' | 'failed';

/** Respuesta de los endpoints de facturación en un solo paso. */
export interface OneShotEmissionResult {
  state: OneShotEmissionState;
  invoice_id: number | null;
  invoice_number: string | null;
  /** Estado del documento (`accepted`, `rejected`, `validated`, `draft`…). */
  dian_status: string | null;
  message: string | null;
}

/**
 * Facturación en UN solo paso desde el detalle de la orden: crear + prevalidar
 * + transmitir. Reusa el motor idempotente del carril POS
 * (`PosFiscalEmissionService`), que NO depende del canal de la orden.
 *
 * Reintento: volver a llamar reusa el documento existente (rejected/failed →
 * se revalida/retransmite) sin crear otra fila ni consumir otro consecutivo.
 */
@Injectable()
export class OneShotEmissionService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly emission: PosFiscalEmissionService,
    private readonly receivables: AccountsReceivableService,
    // `OrderFlowModule` ↔ `PaymentsModule` ↔ `InvoicingModule` ya forman un
    // ciclo de módulos: se resuelve perezosamente en vez de importarlo.
    private readonly moduleRef: ModuleRef,
    private readonly invoicing: InvoicingService,
    private readonly lease: OrderLeaseService,
    private readonly invoice_flow: InvoiceFlowService,
  ) {}

  /**
   * Emite la factura de una orden bajo la lease por orden (S6b): si otra
   * operación —facturación masiva, transición, asignación a ruta— la está
   * procesando, lanza `ORDERS_BULK_LOCKED_001` sin tocar nada. La lease es
   * re-entrante, así que la facturación masiva (que ya la tiene) no se bloquea
   * a sí misma.
   *
   * `emit_options.force_final_consumer` sólo lo pasa la facturación masiva con
   * opt-in explícito: la factura sale a Consumidor final aunque la orden tenga
   * cliente, sin modificar la ficha.
   */
  async emitOrder(
    order_id: number,
    credit?: EmitOrderCreditDto,
    emit_options?: Pick<CreateFromOrderOptions, 'force_final_consumer'>,
  ): Promise<OneShotEmissionResult> {
    return this.lease.withLease(order_id, async () => {
      // S10: sólo se descarta el borrador que NACIÓ en este intento. Si la orden
      // ya traía un documento vivo (borrador colgado, validado…) se conserva.
      const prior = await this.prisma.invoices.findFirst({
        where: { order_id, financial_account_id: null, invoice_type: 'sales_invoice' },
        orderBy: { created_at: 'desc' },
        select: { id: true, status: true },
      });
      const had_live_document =
        !!prior && !['cancelled', 'voided'].includes(prior.status);
      const recreate = prior?.status === 'cancelled';
      const result = await this.emitOrderUnlocked(
        order_id,
        credit,
        emit_options,
        recreate,
      );
      if (result.state === 'failed' && !had_live_document) {
        await this.discardAttemptDraft(order_id);
      }
      return result;
    });
  }

  /**
   * Si el intento falló DESPUÉS de crear el borrador, no se deja colgado: se
   * descarta por la vía existente de la UI de facturación
   * (`InvoiceFlowService.cancel`, `draft → cancelled`, sin hard delete). Sólo
   * `draft`: un documento ya numerado/validado sigue vivo para reintentarse.
   */
  private async discardAttemptDraft(order_id: number): Promise<void> {
    try {
      const draft = await this.prisma.invoices.findFirst({
        where: {
          order_id,
          financial_account_id: null,
          invoice_type: 'sales_invoice',
          status: 'draft',
        },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });
      if (draft) await this.invoice_flow.cancel(draft.id);
    } catch {
      // Descartar es limpieza: su fallo nunca tapa el motivo real del intento.
    }
  }

  /** `emitForOrder` con la bandera `recreate_after_discard` cuando aplica. */
  private emitFor(
    order_id: number,
    recreate: boolean,
    ...args: [CreateFromOrderOptions?]
  ) {
    if (!recreate) return this.emission.emitForOrder(order_id, ...args);
    return this.emission.emitForOrder(order_id, {
      ...(args[0] ?? {}),
      recreate_after_discard: true,
    });
  }

  private async emitOrderUnlocked(
    order_id: number,
    credit?: EmitOrderCreditDto,
    emit_options?: Pick<CreateFromOrderOptions, 'force_final_consumer'>,
    recreate = false,
  ): Promise<OneShotEmissionResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: {
        id: true,
        store_id: true,
        state: true,
        customer_id: true,
        payment_form: true,
        grand_total: true,
        active_financial_split_id: true,
        payments: { select: { state: true, amount: true } },
        users: {
          select: {
            document_type: true,
            document_number: true,
            legal_name: true,
            first_name: true,
            last_name: true,
            verification_digit: true,
          },
        },
        invoice_data_requests: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            document_type: true,
            document_number: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });
    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_003,
        `No se encontró el pedido #${order_id} en esta tienda.`,
        { order_id },
      );
    }
    // Orden dividida: se factura por cuenta, nunca la orden completa.
    assertNoActiveFinancialSplit(order);

    // Titular: misma regla que `createFromOrder` y la vista previa masiva. Se
    // evalúa ANTES del saldo/crédito para no convertir una orden a crédito y
    // luego descubrir que la factura saldría a Consumidor final.
    const force = await this.resolveHolderGate(order, emit_options);
    // Borrador colgado de un intento anterior: su titular se re-sincroniza con
    // la evaluación actual (misma construcción que la creación) antes de numerar.
    await this.refreshHangingDraftHolder(order_id, force);

    // Plazo declarado: se valida antes de tocar la orden o la factura.
    const credit_options = credit
      ? await this.resolveCreditOptions(credit, order.store_id)
      : undefined;

    if (order.payment_form === '2') {
      // Ya es venta a crédito (conversión previa, hotel, POS): directo a emitir.
      // Si sigue en `created` (convertida antes de S8) pasa a `pending_payment`
      // con el mismo claim idempotente, para que sea despachable.
      if (order.state === 'created') await this.moveToPendingPayment(order);
      return this.toResult(
        await this.emitFor(
          order_id,
          recreate,
          force ? { ...(credit_options ?? {}), ...force } : credit_options,
        ),
      );
    }

    const { settled, remaining } = computeOrderUnpaidBalance(order);
    if (remaining.lessThan(0.01)) {
      return this.toResult(
        await this.emitFor(order_id, recreate, ...this.optsArg(undefined, force)),
      );
    }

    // Una factura ya numerada pasó esta puerta cuando se creó: reintentar su
    // transmisión no es «facturar sin cobrar» y no debe responder 409.
    const numbered = await this.prisma.invoices.findFirst({
      where: {
        order_id,
        financial_account_id: null,
        status: { in: ['validated', 'sent', 'accepted', 'rejected'] },
      },
      select: { id: true },
    });
    if (numbered) {
      return this.toResult(
        await this.emitFor(order_id, recreate, ...this.optsArg(undefined, force)),
      );
    }

    const blocker = this.resolveCreditBlocker(order, settled);
    if (!credit_options) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_ORDER_UNPAID_001,
        undefined,
        {
          order_id,
          remaining_balance: remaining.toFixed(2),
          credit_eligible: blocker === null,
          credit_blocker: blocker,
        },
      );
    }
    if (blocker) throw this.creditBlockerError(blocker, order_id);

    // Tienda que no emite: no se convierte nada. Pasar la orden a crédito y
    // abrir cartera para una factura que no va a salir dejaría una cuenta por
    // cobrar sin documento ni asiento; `emitForOrder` responde el motivo.
    const { eligible } = await this.invoicing.getElectronicEmissionEligibility();
    if (!eligible) return this.toResult(await this.emission.emitForOrder(order_id));

    await this.convertToCredit(order, remaining, credit_options);
    return this.toResult(
      await this.emitFor(
        order_id,
        recreate,
        ...this.optsArg(credit_options, force),
      ),
    );
  }

  /**
   * Bloquea (409 `INVOICING_HOLDER_INCOMPLETE_001`) una orden cuyo cliente o
   * datos de invitado caerían a Consumidor final sin que nadie lo pida.
   * Devuelve la opción `force_final_consumer` sólo cuando HAY un problema
   * sobrescribible Y el llamador lo aceptó explícitamente; con un titular
   * completo la bandera se ignora (nunca fuerza CF sobre un cliente bueno).
   *
   * También aplica a órdenes que ya son crédito (`payment_form '2'`): el
   * crédito nunca sale a Consumidor final (`cf_overridable: false`). No aplica
   * con factura ya numerada: su titular está congelado y el reintento no lo
   * cambia.
   */
  private async resolveHolderGate(
    order: {
      id: number;
      customer_id: number | null;
      payment_form: string | null;
      grand_total?: unknown;
      payments?: Array<{ state: string; amount: unknown }>;
      users?: Parameters<typeof evaluateOrderHolder>[0]['users'];
      invoice_data_requests?: Parameters<typeof evaluateOrderHolder>[0]['invoice_data_requests'];
    },
    emit_options?: Pick<CreateFromOrderOptions, 'force_final_consumer'>,
  ): Promise<Pick<CreateFromOrderOptions, 'force_final_consumer'> | undefined> {
    // El titular se evalúa mientras no exista un documento numerado, también
    // en órdenes que ya son crédito (`payment_form '2'`).
    const holder = evaluateOrderHolder(order);
    if (!holder.issue) return undefined;

    const numbered = await this.prisma.invoices.findFirst({
      where: {
        order_id: order.id,
        financial_account_id: null,
        status: { in: ['validated', 'sent', 'accepted', 'rejected'] },
      },
      select: { id: true },
    });
    if (numbered) return undefined;

    const overridable = isCfOverridable(holder.issue);
    if (overridable && emit_options?.force_final_consumer) {
      // Venta a crédito (ya crédito o con saldo): nunca sale a Consumidor final.
      const is_credit =
        order.payment_form === '2' ||
        computeOrderUnpaidBalance(order as any).remaining.greaterThanOrEqualTo(0.01);
      if (!is_credit) return { force_final_consumer: true };
      throw new VendixHttpException(
        ErrorCodes.INVOICING_HOLDER_INCOMPLETE_001,
        CREDIT_FINAL_CONSUMER_MESSAGE,
        {
          order_id: order.id,
          customer_id: order.customer_id,
          issue_code: holder.issue.code,
          missing_fields: holder.issue.missing_fields,
          message: CREDIT_FINAL_CONSUMER_MESSAGE,
          cf_overridable: false,
        },
      );
    }
    throw new VendixHttpException(
      ErrorCodes.INVOICING_HOLDER_INCOMPLETE_001,
      undefined,
      {
        order_id: order.id,
        customer_id: order.customer_id,
        customer_name: describeHolderSource(order),
        issue_code: holder.issue.code,
        missing_fields: holder.issue.missing_fields,
        message: holder.issue.message,
        cf_overridable: overridable,
      },
    );
  }

  /** Extra `emitForOrder` argument only when there is something to pass. */
  private optsArg(
    base: CreateFromOrderOptions | undefined,
    force: Pick<CreateFromOrderOptions, 'force_final_consumer'> | undefined,
  ): [CreateFromOrderOptions] | [] {
    if (!base && !force) return [];
    return [{ ...(base ?? {}), ...(force ?? {}) }];
  }

  /**
   * Cómo se tratará el pago de una orden al facturarla, con las MISMAS reglas
   * que `emitOrder` (sin duplicarlas): `paid`, `credit_existing` (ya es venta
   * a crédito), `to_credit` (sin cobrar y convertible) o `blocked` con el
   * motivo. Sólo lee; la facturación masiva la usa para su vista previa.
   */
  classifyOrderPayment(
    order: {
      state: string;
      customer_id: number | null;
      payment_form: string | null;
      grand_total: Prisma.Decimal | number | string | null;
      active_financial_split_id: number | null;
      payments?: ReadonlyArray<{ state: string | null; amount: Prisma.Decimal | number | string }> | null;
    },
    has_rejected_document = false,
  ): {
    payment: 'paid' | 'credit_existing' | 'to_credit' | 'blocked';
    blocked_code: 'partial_payment' | 'customer_required' | 'order_state' | 'split_active' | null;
  } {
    if (['cancelled', 'refunded'].includes(order.state)) {
      return { payment: 'blocked', blocked_code: 'order_state' };
    }
    if (order.active_financial_split_id) {
      return { payment: 'blocked', blocked_code: 'split_active' };
    }
    if (order.payment_form === '2') {
      return { payment: 'credit_existing', blocked_code: null };
    }
    const { settled, remaining } = computeOrderUnpaidBalance({
      grand_total: order.grand_total,
      payments: (order.payments ?? []).map((p) => ({ state: p.state, amount: p.amount })),
    });
    // Un documento numerado rechazado se reintenta tal cual (ver `emitOrder`).
    if (remaining.lessThan(0.01) || has_rejected_document) {
      return { payment: 'paid', blocked_code: null };
    }
    const blocker = this.resolveCreditBlocker(order, settled);
    if (blocker) return { payment: 'blocked', blocked_code: blocker };
    return { payment: 'to_credit', blocked_code: null };
  }

  private resolveCreditBlocker(
    order: {
      state: string;
      customer_id: number | null;
      payments?: ReadonlyArray<{ state: string | null }> | null;
    },
    settled: Prisma.Decimal,
  ): CreditBlocker {
    if (['cancelled', 'refunded'].includes(order.state)) return 'order_state';
    if (order.customer_id == null) return 'customer_required';
    // Un cobro en vuelo (Wompi pendiente, tarjeta autorizada) cuenta como
    // abono: si se confirma después quedarían caja Y cartera por la misma venta.
    const in_flight = (order.payments ?? []).some((payment) =>
      ['pending', 'authorized'].includes(String(payment.state)),
    );
    if (settled.greaterThan(0) || in_flight) return 'partial_payment';
    return null;
  }

  private creditBlockerError(blocker: Exclude<CreditBlocker, null>, order_id: number) {
    const entry = {
      customer_required: ErrorCodes.INVOICING_CREDIT_CUSTOMER_REQUIRED_001,
      partial_payment: ErrorCodes.INVOICING_CREDIT_PARTIAL_PAYMENT_001,
      order_state: ErrorCodes.INVOICING_CREDIT_ORDER_STATE_001,
    }[blocker];
    return new VendixHttpException(entry, undefined, {
      order_id,
      credit_blocker: blocker,
    });
  }

  /**
   * Valida el plazo contra el «hoy» DE LA TIENDA (no el del servidor: pasadas
   * las 19:00 en Colombia el día UTC ya es el siguiente) y lo deja listo para
   * la factura. El código de medio de pago debe ser un `MediosPago` de la DIAN.
   */
  private async resolveCreditOptions(
    credit: EmitOrderCreditDto,
    store_id: number,
  ): Promise<CreateFromOrderOptions> {
    const due = new Date(`${credit.due_date}T00:00:00.000Z`);
    if (
      Number.isNaN(due.getTime()) ||
      due.toISOString().slice(0, 10) !== credit.due_date
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CREDIT_DUE_DATE_001,
        `La fecha de vencimiento (${credit.due_date}) no es válida.`,
      );
    }
    const today = localDateString(
      new Date(),
      await resolveStoreTimezone(this.prisma, store_id),
    );
    if (credit.due_date < today) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CREDIT_DUE_DATE_001,
        undefined,
        { due_date: credit.due_date, today },
      );
    }
    return {
      due_date: due,
      ...(credit.payment_means_code
        ? { payment_means_code: credit.payment_means_code }
        : {}),
    };
  }

  /**
   * Orden sin cobrar → venta a crédito. Mismo modelo que el check-out del hotel:
   * `payment_form = '2'` + `remaining_balance`, y la cuenta por cobrar después
   * del commit. NO se emite `credit_sale.created`: con factura electrónica el
   * asiento (DR clientes / CR ingresos) lo genera la aceptación de la factura.
   */
  private async convertToCredit(
    order: { id: number; store_id: number; state: string },
    remaining: Prisma.Decimal,
    options: CreateFromOrderOptions,
  ): Promise<void> {
    if (order.state === 'draft') {
      // Mismo apartado de stock que el cobro: una orden facturada no puede
      // quedar sin existencias reservadas.
      await this.moduleRef
        .get(OrderFlowService, { strict: false })
        .promoteDraftForCreditInvoicing(order.id, order.store_id);
    }
    // Condicional: el doble clic no pisa una conversión que ya ocurrió.
    await this.prisma.orders.updateMany({
      where: {
        id: order.id,
        OR: [{ payment_form: null }, { payment_form: { not: '2' } }],
      },
      data: {
        payment_form: '2',
        remaining_balance: remaining.toNumber(),
        updated_at: new Date(),
      },
    });
    await this.moveToPendingPayment(order);
    // Idempotente por `source_id`: reintentos no duplican la cuenta por cobrar.
    await this.receivables.createCreditSaleFromEvent({
      order_id: order.id,
      total_amount: remaining.toNumber(),
      store_id: order.store_id,
      due_date: options.due_date,
    });
  }

  /**
   * `created` -> `pending_payment` con el mismo efecto que una venta a crédito
   * del POS: se reutiliza `PaymentsService.updateOrderPaymentStatus` (estado +
   * historial). La reclamación es condicional (`state = 'created'`) dentro de la
   * misma transacción: un reintento o doble clic no repite transición ni
   * historial, y una orden en otro estado no se toca. La facturación no crea
   * cuotas, por eso `credit_type` queda en `free` si estaba vacío.
   */
  private async moveToPendingPayment(order: {
    id: number;
    store_id: number;
    state: string;
  }): Promise<void> {
    await this.prisma.orders.updateMany({
      where: { id: order.id, credit_type: null },
      data: { credit_type: 'free', updated_at: new Date() },
    });
    // Un borrador ya fue promovido a `created` arriba.
    if (order.state !== 'draft' && order.state !== 'created') return;
    const payments = this.moduleRef.get(PaymentsService, { strict: false });
    const organization_id = RequestContextService.getOrganizationId() ?? null;
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claim = await tx.orders.updateMany({
        where: { id: order.id, state: 'created' },
        data: { state: 'pending_payment', updated_at: new Date() },
      });
      if (claim.count !== 1) return;
      await payments.updateOrderPaymentStatus(
        tx,
        order.id,
        'pending_payment',
        false,
        false,
        { fromState: 'created', storeId: order.store_id, organizationId: organization_id },
      );
    });
  }

  private async refreshHangingDraftHolder(
    order_id: number,
    force: Pick<CreateFromOrderOptions, 'force_final_consumer'> | undefined,
  ): Promise<void> {
    const draft = await this.prisma.invoices.findFirst({
      where: {
        order_id,
        financial_account_id: null,
        invoice_type: 'sales_invoice',
        status: 'draft',
      },
      select: { id: true },
    });
    if (draft) await this.invoicing.refreshDraftAcquirer(draft.id, order_id, force);
  }

  async emitFinancialAccount(account_id: number): Promise<OneShotEmissionResult> {
    return this.toResult(await this.emission.emitForFinancialAccount(account_id));
  }

  toResult(status: PosFiscalStatus): OneShotEmissionResult {
    const state: OneShotEmissionState =
      status.state === 'issued' || status.state === 'contingency'
        ? 'issued'
        : status.state === 'pending'
          ? 'pending'
          : 'failed'; // failed | not_applicable
    return {
      state,
      invoice_id: status.invoice_id,
      invoice_number: status.invoice_number,
      dian_status: status.invoice_status,
      message: status.message || null,
    };
  }
}

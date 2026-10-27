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
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { AccountsReceivableService } from '../accounts-receivable/accounts-receivable.service';
import { computeOrderUnpaidBalance } from './invoice-flow/invoice-flow.service';
import { InvoicingService, type CreateFromOrderOptions } from './invoicing.service';
import { EmitOrderCreditDto } from './dto/emit-order.dto';

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
  ) {}

  async emitOrder(
    order_id: number,
    credit?: EmitOrderCreditDto,
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

    // Plazo declarado: se valida antes de tocar la orden o la factura.
    const credit_options = credit
      ? await this.resolveCreditOptions(credit, order.store_id)
      : undefined;

    if (order.payment_form === '2') {
      // Ya es venta a crédito (conversión previa, hotel, POS): directo a emitir.
      return this.toResult(
        await this.emission.emitForOrder(order_id, credit_options),
      );
    }

    const { settled, remaining } = computeOrderUnpaidBalance(order);
    if (remaining.lessThan(0.01)) {
      return this.toResult(await this.emission.emitForOrder(order_id));
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
      return this.toResult(await this.emission.emitForOrder(order_id));
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
      await this.emission.emitForOrder(order_id, credit_options),
    );
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
    // Idempotente por `source_id`: reintentos no duplican la cuenta por cobrar.
    await this.receivables.createCreditSaleFromEvent({
      order_id: order.id,
      total_amount: remaining.toNumber(),
      store_id: order.store_id,
      due_date: options.due_date,
    });
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

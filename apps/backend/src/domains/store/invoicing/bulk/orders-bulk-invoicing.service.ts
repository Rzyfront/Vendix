import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCodes,
  FinancialSplitErrors,
  VendixHttpException,
  type ErrorCodeEntry,
} from 'src/common/errors';
import { OrderLeaseService } from 'src/common/locks/order-lease.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InvoicingService } from '../invoicing.service';
import { CREDIT_FINAL_CONSUMER_MESSAGE, OneShotEmissionService } from '../one-shot-emission.service';
import { evaluateOrderHolder, isUnidentifiedHolder } from '../utils/order-acquirer-holder.util';
import {
  BulkInvoiceBlockedCode,
  BulkInvoiceExecuteDto,
  BulkInvoicePreviewDto,
  BulkInvoicePreviewResult,
  BulkInvoicePreviewRow,
  BulkInvoiceResult,
  BulkInvoiceResultItem,
} from '../dto/bulk-invoice-orders.dto';

const FINAL_CONSUMER_NUMBER = '222222222222';
const SALE_DOCUMENT_TYPES = ['sales_invoice', 'export_invoice', 'pos_equivalent_document'];

const SKIP_REASONS: Record<BulkInvoiceBlockedCode, string> = {
  partial_payment:
    'La orden tiene un pago parcial: no se factura en lote. Cóbrala completa o resuélvela desde su detalle.',
  customer_required:
    'La orden no está cobrada y no tiene cliente: no se puede facturar a crédito sin cliente.',
  order_state: 'La orden está cancelada o reembolsada.',
  already_invoiced: 'La orden ya tiene factura electrónica.',
  split_active:
    'La orden tiene cuentas independientes: cada cuenta se factura por separado.',
  not_found: 'No se encontró la orden en esta tienda.',
  in_process:
    ErrorCodes.ORDERS_BULK_LOCKED_001.devMessage,
};

const BLOCKED_ERROR_ENTRY: Record<BulkInvoiceBlockedCode, ErrorCodeEntry> = {
  partial_payment: ErrorCodes.INVOICING_CREDIT_PARTIAL_PAYMENT_001,
  customer_required: ErrorCodes.INVOICING_CREDIT_CUSTOMER_REQUIRED_001,
  order_state: ErrorCodes.INVOICING_CREDIT_ORDER_STATE_001,
  already_invoiced: ErrorCodes.ORD_INVOICED_LOCKED_001,
  split_active: FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED,
  not_found: ErrorCodes.INVOICING_FIND_003,
  in_process: ErrorCodes.ORDERS_BULK_LOCKED_001,
};

interface BulkOrderRow {
  id: number;
  order_number: string;
  state: string;
  customer_id: number | null;
  payment_form: string | null;
  grand_total: Prisma.Decimal | number | string | null;
  active_financial_split_id: number | null;
  payments: Array<{
    state: string | null;
    amount: Prisma.Decimal | number | string;
    store_payment_method?: {
      system_payment_method?: { processing_mode?: string | null } | null;
    } | null;
  }>;
  users: Parameters<typeof evaluateOrderHolder>[0]['users'];
  invoice_data_requests: Parameters<typeof evaluateOrderHolder>[0]['invoice_data_requests'];
}

const emptyHolder = (): BulkInvoicePreviewRow['holder'] => ({
  rail: 'final_consumer',
  source: 'none',
  name: 'Consumidor final',
  document_type: '13',
  document_number: FINAL_CONSUMER_NUMBER,
  verification_digit: null,
});

/**
 * Facturación masiva de órdenes: vista previa (sólo lectura) y ejecución por
 * lotes de hasta 5. Reusa el motor de la facturación individual
 * (`OneShotEmissionService.emitOrder`: elegibilidad, conversión a crédito,
 * bloqueo) y la regla de titular de `createFromOrder`
 * (`evaluateOrderHolder`); aquí sólo se clasifica y se orquesta.
 *
 * Vive en el módulo de facturación (ruta `store/orders/bulk/invoice`) para no
 * crear un import directo Orders → OneShotEmissionService sobre el ciclo
 * Invoicing ↔ Orders.
 */
@Injectable()
export class OrdersBulkInvoicingService {
  private readonly logger = new Logger(OrdersBulkInvoicingService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly one_shot: OneShotEmissionService,
    private readonly invoicing: InvoicingService,
    private readonly lease: OrderLeaseService,
  ) {}

  async preview(dto: BulkInvoicePreviewDto): Promise<BulkInvoicePreviewResult> {
    const eligibility = await this.invoicing.getElectronicEmissionEligibility();
    const rows = await this.classify(dto.ids, { check_lease: true });
    const results = rows.map((row) =>
      eligibility.eligible
        ? row
        : {
            ...row,
            will_emit: false,
            skip_reason: row.skip_reason ?? eligibility.reason,
          },
    );

    const summary = {
      total: results.length,
      paid: results.filter((r) => r.payment === 'paid').length,
      credit_existing: results.filter((r) => r.payment === 'credit_existing').length,
      to_credit: results.filter((r) => r.payment === 'to_credit').length,
      final_consumer: results.filter(
        (r) => r.will_emit && r.holder.rail === 'final_consumer',
      ).length,
      blocked: results.filter(
        (r) => r.payment === 'blocked' || (r.holder_issue && !r.cf_overridable),
      ).length,
      cf_overridable: results.filter((r) => r.cf_overridable).length,
      will_emit: results.filter((r) => r.will_emit).length,
    };
    return {
      store_eligible: eligibility.eligible,
      store_blocker: eligibility.eligible ? null : eligibility.reason,
      summary,
      results,
    };
  }

  async execute(dto: BulkInvoiceExecuteDto): Promise<BulkInvoiceResult> {
    const results: BulkInvoiceResultItem[] = [];
    // Sequential on purpose: DIAN numbering stays ordered and a failure in
    // one order never stops the others.
    for (const item of dto.items) {
      try {
        results.push(await this.executeOne(item, dto.credit));
      } catch (error) {
        results.push(this.toErrorItem(item.order_id, error));
        this.logger.warn(
          `Bulk invoice failed for order ${item.order_id}: ${this.messageOf(error)}`,
        );
      }
    }
    const successful = results.filter((r) => r.status === 'ok').length;
    return {
      total: results.length,
      successful,
      failed: results.length - successful,
      results,
    };
  }

  private async executeOne(
    item: BulkInvoiceExecuteDto['items'][number],
    credit: BulkInvoiceExecuteDto['credit'],
  ): Promise<BulkInvoiceResultItem> {
    // The whole re-classify + emit runs under the per-order lease; the lease is
    // re-entrant, so `emitOrder` does not lock itself out.
    return this.lease.withLease(item.order_id, async () => {
      const [row] = await this.classify([item.order_id], { check_lease: false });

      if (row.blocked_code) {
        throw new VendixHttpException(
          BLOCKED_ERROR_ENTRY[row.blocked_code],
          row.skip_reason ?? undefined,
          { order_id: item.order_id, blocked_code: row.blocked_code },
        );
      }

      const override =
        item.allow_final_consumer === true &&
        row.holder_issue !== null &&
        row.cf_overridable;

      if (row.holder_issue && !override) {
        const code =
          row.holder_issue.code === 'document_type_required'
            ? ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED
            : ErrorCodes.INVOICING_BULK_HOLDER_INCOMPLETE_001;
        throw new VendixHttpException(code, row.skip_reason ?? row.holder_issue.message, {
          order_id: item.order_id,
          holder_issue: row.holder_issue.code,
        });
      }

      const effective_document = override
        ? FINAL_CONSUMER_NUMBER
        : row.holder.document_number;
      if (effective_document !== (item.expected_holder_document ?? '').trim()) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_BULK_HOLDER_CHANGED_001,
          undefined,
          { order_id: item.order_id },
        );
      }

      if (row.payment === 'to_credit' && !credit && !override) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_CREDIT_DUE_DATE_001,
          'La orden está sin cobrar: indica la fecha de vencimiento para facturarla a crédito.',
          { order_id: item.order_id },
        );
      }

      const emission = await this.one_shot.emitOrder(
        item.order_id,
        row.payment === 'to_credit' && !override ? credit : undefined,
        override ? { force_final_consumer: true } : undefined,
      );
      // S10: «Emitida y aceptada». Éxito sólo con la factura aceptada por la
      // DIAN; contingencia, en cola, enviada o rechazada se reportan como
      // fallidas con su motivo (el documento sigue vivo para reintentar).
      if (emission.state !== 'issued' || emission.dian_status !== 'accepted') {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_BULK_EMISSION_FAILED_001,
          emission.state === 'failed'
            ? (emission.message ?? undefined)
            : `La factura no quedó aceptada por la DIAN (estado: ${emission.dian_status ?? 'sin estado'}). ${emission.message ?? ''}`.trim(),
          {
            order_id: item.order_id,
            ...(emission.invoice_number ? { invoice_number: emission.invoice_number } : {}),
            ...(emission.dian_status ? { invoice_status: emission.dian_status } : {}),
          },
        );
      }
      return {
        id: item.order_id,
        status: 'ok' as const,
        ...(emission.invoice_number ? { invoice_number: emission.invoice_number } : {}),
        ...(emission.dian_status ? { invoice_status: emission.dian_status } : {}),
      };
    });
  }

  /** Same classification for preview and execute — one function, no drift. */
  private async classify(
    ids: number[],
    opts: { check_lease: boolean },
  ): Promise<BulkInvoicePreviewRow[]> {
    const unique_ids = [...new Set(ids)];
    const orders = (await this.prisma.orders.findMany({
      where: { id: { in: unique_ids } },
      select: {
        id: true,
        order_number: true,
        state: true,
        customer_id: true,
        payment_form: true,
        grand_total: true,
        active_financial_split_id: true,
        payments: {
          select: {
            state: true,
            amount: true,
            store_payment_method: {
              select: { system_payment_method: { select: { processing_mode: true } } },
            },
          },
        },
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
    })) as unknown as BulkOrderRow[];
    const documents = (await this.prisma.invoices.findMany({
      where: {
        order_id: { in: unique_ids },
        invoice_type: { in: SALE_DOCUMENT_TYPES as any },
        financial_account_id: null,
        status: { in: ['validated', 'sent', 'accepted', 'rejected'] },
      },
      select: { order_id: true, status: true },
    })) as unknown as Array<{ order_id: number; status: string }>;

    const by_id = new Map(orders.map((o) => [o.id, o]));
    const rows: BulkInvoicePreviewRow[] = [];
    for (const id of unique_ids) {
      const found = by_id.get(id);
      if (!found) {
        rows.push(this.blockedRow(id, '', '0.00', 'not_found'));
        continue;
      }
      const statuses = documents
        .filter((d) => d.order_id === id)
        .map((d) => String(d.status));
      const grand_total = new Prisma.Decimal(found.grand_total ?? 0).toFixed(2);

      if (statuses.some((s) => ['validated', 'sent', 'accepted'].includes(s))) {
        rows.push(this.blockedRow(id, found.order_number, grand_total, 'already_invoiced', found));
        continue;
      }
      if (opts.check_lease && (await this.lease.isHeld(id))) {
        rows.push(this.blockedRow(id, found.order_number, grand_total, 'in_process', found));
        continue;
      }

      const classification = this.one_shot.classifyOrderPayment(
        found,
        statuses.includes('rejected'),
      );
      if (classification.blocked_code) {
        rows.push(
          this.blockedRow(id, found.order_number, grand_total, classification.blocked_code, found),
        );
        continue;
      }

      const evaluated = evaluateOrderHolder(found);
      // Paid order of an unidentified buyer (Consumidor final, guest or customer
      // with only a name): `emitOrder` issues it to Consumidor final without
      // the opt-in, so it is not an issue here either.
      const holder =
        classification.payment === 'paid' && isUnidentifiedHolder(evaluated.issue)
          ? { ...evaluated, issue: null }
          : evaluated;
      const has_issue = holder.issue !== null;
      // An existing credit sale is never issued as Consumidor final. An unpaid
      // order (to_credit) can be: with the CF opt-in it goes out cash with
      // payment means «Acuerdo mutuo» (ZZZ) instead of becoming credit.
      const is_credit = classification.payment === 'credit_existing';
      const cf_overridable =
        has_issue && holder.issue!.code !== 'document_type_required' && !is_credit;
      rows.push({
        id,
        order_number: found.order_number,
        grand_total,
        payment: classification.payment,
        blocked_code: null,
        holder: {
          rail: holder.rail,
          source: holder.source,
          name: holder.name,
          document_type: holder.document_type,
          document_number: holder.document_number,
          verification_digit: holder.verification_digit,
        },
        holder_issue: holder.issue,
        cf_overridable,
        will_emit: !has_issue,
        skip_reason:
          is_credit && has_issue && holder.issue!.code !== 'document_type_required'
            ? CREDIT_FINAL_CONSUMER_MESSAGE
            : (holder.issue?.message ?? null),
      });
    }
    return rows;
  }

  private blockedRow(
    id: number,
    order_number: string,
    grand_total: string,
    blocked_code: BulkInvoiceBlockedCode,
    source_rows?: Parameters<typeof evaluateOrderHolder>[0],
  ): BulkInvoicePreviewRow {
    let holder = emptyHolder();
    if (source_rows) {
      const evaluated = evaluateOrderHolder(source_rows);
      holder = {
        rail: evaluated.rail,
        source: evaluated.source,
        name: evaluated.name,
        document_type: evaluated.document_type,
        document_number: evaluated.document_number,
        verification_digit: evaluated.verification_digit,
      };
    }
    return {
      id,
      order_number,
      grand_total,
      payment: 'blocked',
      blocked_code,
      holder,
      holder_issue: null,
      cf_overridable: false,
      will_emit: false,
      skip_reason: SKIP_REASONS[blocked_code],
    };
  }

  private messageOf(error: unknown): string {
    if (error instanceof VendixHttpException) {
      const body = error.getResponse() as { message?: string };
      return body?.message ?? error.message;
    }
    return error instanceof Error ? error.message : 'Error desconocido';
  }

  private toErrorItem(id: number, error: unknown): BulkInvoiceResultItem {
    const code =
      error instanceof VendixHttpException
        ? error.errorCode
        : 'INVOICING_BULK_ITEM_FAILED';
    return { id, status: 'error', code, message: this.messageOf(error) };
  }
}

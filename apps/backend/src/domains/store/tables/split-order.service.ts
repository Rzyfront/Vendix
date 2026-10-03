import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  VendixHttpException,
  ErrorCodes,
  FinancialSplitErrors,
} from 'src/common/errors';
import { resolveOrderLineTaxTotal } from '../taxes/utils/final-price.util';
import { buildShippingTaxBreakdownRow } from '../shipping/utils/shipping-tax.util';
import { allocateFinancialAccountShippingTax } from '../shipping/utils/financial-account-shipping-tax.util';
import {
  SplitByItemsDto,
  SplitByAmountDto,
  SplitPreviewDto,
  SplitAccountCustomerDto,
  CancelFinancialSplitDto,
} from './dto/split-order.dto';
import {
  allocateFinancialSplit,
  FinancialSplitSource,
  FinancialSplitRequest,
  FinancialSplitAllocation,
  FinancialSplitAllocationResult,
  SplitAllocationError,
  getCents,
} from './utils/split-allocation.util';

const RECEIVED = ['succeeded', 'captured'];
const RESERVED = ['pending', 'authorized'];
const VOID_INVOICES = ['cancelled', 'voided'];
/** Pagos que ya no cuentan: no hay dinero registrado ni en camino. */
const DEAD_PAYMENTS = ['failed', 'cancelled'];
/** Facturas de cuenta que aún no salieron hacia la DIAN: se descartan al quitar la división. */
const DISCARDABLE_INVOICES = ['draft', 'validated'];
const money = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

export interface SplitAccountSummary {
  id: number | null;
  ordinal: number;
  role: 'paid_original' | 'payable';
  label: string;
  customer_id: number | null;
  customer_alias: string | null;
  customer_name: string | null;
  payer: { customer_id: number | null; customer_alias: string | null };
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  shipping_cost: string;
  tip_amount: string;
  grand_total: string;
  paid_snapshot: string;
  total_paid: string;
  reserved_amount: string;
  remaining_balance: string;
  available_to_pay: string;
  payment_state: 'unpaid' | 'pending' | 'partial' | 'paid';
  invoice_id: number | null;
  invoice: SplitAccountInvoice | null;
  lines: SplitAccountLine[];
  payments: Array<{
    id: number;
    amount: string;
    state: string;
    payment_method_name: string | null;
    created_at: string | null;
    can_confirm: boolean;
    next_action: unknown;
  }>;
}

export interface SplitAccountInvoice {
  id: number;
  invoice_number: string | null;
  status: string;
  dian_status: string | null;
  grand_total: string;
}

export interface SplitAccountLine {
  id: number;
  order_item_id: number | null;
  product_name: string;
  variant_name: string | null;
  original_quantity: number | null;
  share_ratio: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

export interface SplitUndo {
  allowed: boolean;
  blockers: Array<{
    account_id: number;
    account_label: string;
    reason: 'payment_registered' | 'invoice_transmitted';
    amount: string | null;
  }>;
  invoices_to_discard: Array<{
    account_id: number;
    account_label: string;
    invoice_id: number;
    invoice_number: string | null;
  }>;
}

export interface SplitResult {
  source_order_id: number;
  split_group_id: number | null;
  mode: 'equal' | 'custom' | 'items' | null;
  undo: SplitUndo;
  source_version: string;
  currency: string;
  original_total: string;
  preserved_paid: string;
  pending_to_split: string;
  accounts: SplitAccountSummary[];
  retained_account: SplitAccountSummary | null;
  kitchen_fire: null;
}

/** Financial ledger only: never creates orders/items or calls stock or kitchen. */
@Injectable()
export class SplitOrderService {
  constructor(private readonly prisma: StorePrismaService) {}

  private context() {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id || !ctx.organization_id || !ctx.user_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return {
      ...ctx,
      store_id: ctx.store_id,
      organization_id: ctx.organization_id,
      user_id: ctx.user_id,
    };
  }

  private reject(
    message: string,
    code: keyof typeof FinancialSplitErrors = 'SPLIT_SOURCE_INCONSISTENT',
  ): never {
    throw new VendixHttpException(FinancialSplitErrors[code], message);
  }

  private async source(db: any, orderId: number) {
    const { store_id } = this.context();
    const order = await db.orders.findFirst({
      where: { id: orderId, store_id },
      include: {
        order_items: {
          where: { cancelled_at: null },
          orderBy: { id: 'asc' },
          include: { order_item_taxes: { orderBy: { id: 'asc' } } },
        },
        payments: { orderBy: { id: 'asc' } },
        invoices: {
          select: { id: true, status: true, financial_account_id: true },
        },
        refunds: { select: { id: true, state: true } },
        order_installments: { select: { id: true } },
      },
    });
    if (!order) throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_NOT_FOUND);
    const receivable = await db.accounts_receivable.findFirst({
      where: {
        store_id,
        source_id: orderId,
        source_type: { in: ['credit_sale', 'order'] },
      },
      select: { id: true },
    });
    return { ...order, has_receivable: !!receivable };
  }

  private async lockSource(tx: any, orderId: number) {
    const { store_id } = this.context();
    const rows = await tx.$queryRaw`
      SELECT id FROM orders WHERE id = ${orderId} AND store_id = ${store_id} FOR UPDATE
    `;
    if (!rows.length)
      throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_NOT_FOUND);
    return this.source(tx, orderId);
  }

  private ensureSplittable(order: any) {
    if (['cancelled', 'refunded'].includes(order.state)) {
      throw new VendixHttpException(
        ErrorCodes.SPLIT_ORDER_NOT_DRAFT,
        'Una orden cancelada o reembolsada no se puede dividir.',
      );
    }
    if (
      order.payment_form === '2' ||
      order.credit_type ||
      order.order_installments?.length ||
      order.has_receivable
    ) {
      this.reject(
        'La orden tiene crédito, cuotas o cartera materializada; no se puede dividir.',
      );
    }
    if (!order.order_items.length)
      throw new VendixHttpException(ErrorCodes.SPLIT_ORDER_EMPTY);
    if (
      (order.invoices ?? []).some(
        (invoice: any) => !VOID_INVOICES.includes(invoice.status),
      )
    ) {
      this.reject(
        'La orden tiene un documento fiscal vigente; no se puede dividir.',
      );
    }
    if ((order.refunds ?? []).length)
      this.reject(
        'La orden tiene devoluciones; requiere conciliación antes de dividir.',
      );
    if (
      order.payments.some((payment: any) => RESERVED.includes(payment.state))
    ) {
      this.reject(
        'Confirma o cancela los pagos pendientes antes de dividir el saldo.',
      );
    }
    if (
      order.payments.some((payment: any) =>
        ['refunded', 'partially_refunded', 'disputed'].includes(payment.state),
      )
    ) {
      this.reject(
        'La orden tiene pagos reversados o en disputa; requiere conciliación.',
      );
    }
  }

  private kernelSource(order: any): FinancialSplitSource {
    const paid = order.payments
      .filter((p: any) => RECEIVED.includes(p.state))
      .reduce(
        (sum: Prisma.Decimal, p: any) => sum.plus(money(p.amount)),
        money(0),
      );
    return {
      subtotal_amount: order.subtotal_amount,
      discount_amount: order.discount_amount ?? 0,
      tax_amount: order.tax_amount ?? 0,
      shipping_cost: order.shipping_cost ?? 0,
      tip_amount: order.tip_amount ?? 0,
      grand_total: order.grand_total,
      paid_total: paid,
      items: order.order_items.map((item: any) => {
        const rows = item.order_item_taxes ?? [];
        const scalarTax = resolveOrderLineTaxTotal(item);
        if (
          (scalarTax > 0 && !rows.length) ||
          rows.some((tax: any) => money(tax.tax_amount).gt(0) && !tax.tax_type)
        ) {
          this.reject(
            'La orden no conserva un desglose fiscal tipado; requiere conciliación antes de dividir.',
          );
        }
        const taxes = rows;
        return {
          id: item.id,
          subtotal_amount: item.total_price,
          taxes: taxes.map((tax: any) => ({
            tax_rate_id: tax.tax_rate_id ?? null,
            tax_name: tax.tax_name,
            tax_rate: tax.tax_rate,
            tax_type: tax.tax_type ?? null,
            tax_amount: tax.tax_amount,
            is_inclusive: !!tax.is_inclusive,
            is_compound: tax.is_compound ?? false,
          })),
        };
      }),
    };
  }

  private version(order: any): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          id: order.id,
          currency: order.currency,
          source: this.kernelSource(order),
          shipping_tax: {
            rate_id: order.shipping_tax_rate_id ?? null,
            name: order.shipping_tax_name ?? null,
            type: order.shipping_tax_type ?? null,
            rate: String(order.shipping_tax_rate ?? 0),
            amount: String(order.shipping_tax_amount ?? 0),
          },
          customer_id: order.customer_id,
          customer_alias: order.customer_alias,
          payment_form: order.payment_form,
          credit_type: order.credit_type,
          item_snapshots: order.order_items.map((item: any) => ({
            id: item.id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: String(item.unit_price),
            weight: item.weight == null ? null : String(item.weight),
            weight_unit: item.weight_unit,
            sale_unit_code_snapshot: item.sale_unit_code_snapshot,
            sale_quantity_snapshot: item.sale_quantity_snapshot,
          })),
          payments: order.payments.map((p: any) => ({
            id: p.id,
            amount: String(p.amount),
            state: p.state,
          })),
          invoices: order.invoices ?? [],
          refunds: order.refunds ?? [],
        }),
      )
      .digest('hex');
  }

  private calculate(
    order: any,
    request: FinancialSplitRequest,
  ): FinancialSplitAllocationResult {
    try {
      const allocation = allocateFinancialSplit(this.kernelSource(order), request);
      this.ensureShippingTaxProjects(order, allocation);
      return allocation;
    } catch (error) {
      if (error instanceof SplitAllocationError) this.reject(error.message);
      throw error;
    }
  }

  /** The invoice and journal share this allocator. Reject before creating any
   * account if a malformed copy or tiny cent allocation would omit shipping tax. */
  private ensureShippingTaxProjects(
    order: any,
    allocation: FinancialSplitAllocationResult,
  ): void {
    const tax = getCents(order.shipping_tax_amount ?? 0, 'shipping_tax_amount');
    if (tax < 0n) {
      this.reject('La copia del impuesto del envío es negativa; revisa la tarifa antes de dividir.');
    }
    if (tax === 0n) return;
    const shipping = getCents(order.shipping_cost ?? 0, 'shipping_cost');
    const row = buildShippingTaxBreakdownRow(order);
    if (!row || row.tax_rate <= 0 || shipping <= tax) {
      this.reject(
        'La copia del impuesto del envío es incoherente; revisa la tarifa antes de dividir.',
      );
    }
    const portions = [
      ...(allocation.retained_account ? [allocation.retained_account] : []),
      ...allocation.accounts,
    ];
    const siblings = portions.map((portion, index) => ({
      id: index + 1,
      shipping_cost: portion.shipping_cost,
    }));
    const projected = siblings.reduce((sum, sibling) => {
      const share = allocateFinancialAccountShippingTax({
        ...sibling,
        split: { source_order: order, accounts: siblings },
      });
      return sum + (share?.amount ?? 0n);
    }, 0n);
    if (projected !== tax) {
      this.reject(
        'El impuesto del envío no se puede repartir entre estas cuentas sin perder centavos; ajusta el reparto.',
      );
    }
  }

  private async validatePayers(
    db: any,
    payers: SplitAccountCustomerDto[] | undefined,
    count: number,
  ) {
    if (payers && payers.length !== count)
      this.reject('Debe indicar un titular por cuenta.');
    const { organization_id } = this.context();
    for (const payer of payers ?? []) {
      if (payer.customer_id != null && payer.customer_alias?.trim()) {
        this.reject('Elige cliente o alias, no ambos.');
      }
      if (payer.customer_id != null) {
        const customer = await db.users.findFirst({
          where: { id: payer.customer_id, organization_id },
          select: { id: true },
        });
        if (!customer)
          this.reject('El cliente no pertenece a esta organización.');
      }
    }
  }

  async preview(orderId: number, dto: SplitPreviewDto): Promise<SplitResult> {
    const order = await this.source(this.prisma, orderId);
    if (order.active_financial_split_id)
      this.reject(
        'La orden ya tiene una división activa.',
        'SPLIT_ALREADY_ACTIVE',
      );
    this.ensureSplittable(order);
    const allocation = this.calculate(order, dto);
    await this.validatePayers(
      this.prisma,
      dto.accounts,
      allocation.accounts.length,
    );
    return this.previewResult(order, allocation, dto.accounts, dto.mode);
  }

  async splitByItems(
    orderId: number,
    dto: SplitByItemsDto,
  ): Promise<SplitResult> {
    return this.confirm(orderId, { ...dto, mode: 'items' });
  }

  async splitByAmount(
    orderId: number,
    dto: SplitByAmountDto,
  ): Promise<SplitResult> {
    return this.confirm(orderId, { ...dto, mode: dto.mode ?? 'equal' });
  }

  private async confirm(
    orderId: number,
    dto: SplitPreviewDto,
  ): Promise<SplitResult> {
    if (!dto.source_version || !dto.idempotency_key) {
      this.reject(
        'Confirma la vista previa enviando source_version e idempotency_key.',
      );
    }
    const { store_id, user_id } = this.context();
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          mode: dto.mode,
          n_splits: dto.n_splits ?? null,
          amounts: dto.amounts?.map((value) => money(value).toFixed(2)) ?? null,
          item_groups:
            dto.item_groups?.map((group) =>
              [...group.order_item_ids].sort((a, b) => a - b),
            ) ?? null,
          accounts:
            dto.accounts?.map((account) => ({
              label: account.label?.trim() || null,
              customer_id: account.customer_id ?? null,
              customer_alias: account.customer_alias?.trim() || null,
            })) ?? null,
        }),
      )
      .digest('hex');
    return this.prisma
      .$transaction(async (tx: any) => {
        const order = await this.lockSource(tx, orderId);
        const existing = await tx.order_financial_splits.findFirst({
          where: { store_id, idempotency_key: dto.idempotency_key },
        });
        if (existing) {
          if (
            existing.source_order_id !== orderId ||
            existing.source_version !== dto.source_version ||
            existing.state !== 'active' ||
            existing.request_hash !== requestHash
          ) {
            this.reject(
              'La clave de idempotencia ya se usó para otra versión o división.',
              'SPLIT_IDEMPOTENCY_CONFLICT',
            );
          }
          const response = await this.readGroup(tx, order, existing.id);
          if (!response) this.reject('La división ya no está disponible.');
          return response;
        }
        if (order.active_financial_split_id)
          this.reject(
            'La orden ya tiene una división activa.',
            'SPLIT_ALREADY_ACTIVE',
          );
        this.ensureSplittable(order);
        if (this.version(order) !== dto.source_version)
          this.reject(
            'La cuenta cambió; vuelve a generar la vista previa.',
            'SPLIT_SOURCE_CONFLICT',
          );
        const allocation = this.calculate(order, dto);
        await this.validatePayers(tx, dto.accounts, allocation.accounts.length);
        const last = await tx.order_financial_splits.findFirst({
          where: { store_id, source_order_id: orderId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const group = await tx.order_financial_splits.create({
          data: {
            store_id,
            source_order_id: orderId,
            version: (last?.version ?? 0) + 1,
            mode: dto.mode,
            state: 'active',
            source_version: dto.source_version,
            idempotency_key: dto.idempotency_key,
            request_hash: requestHash,
            original_total: allocation.original_total,
            paid_total_snapshot: allocation.preserved_paid,
            remaining_total: allocation.pending_to_split,
            original_payment_ids: order.payments
              .filter((p: any) => RECEIVED.includes(p.state))
              .map((p: any) => p.id),
            created_by: user_id,
          },
        });
        if (allocation.retained_account) {
          await this.persistAccount(
            tx,
            group.id,
            order,
            allocation.retained_account,
            0,
            'paid_original',
            {
              label: 'Abonos anteriores',
              customer_id: order.customer_id ?? null,
              customer_alias: order.customer_id
                ? null
                : (order.customer_alias ?? null),
            },
          );
        }
        for (let index = 0; index < allocation.accounts.length; index++) {
          await this.persistAccount(
            tx,
            group.id,
            order,
            allocation.accounts[index],
            index + 1,
            'payable',
            dto.accounts?.[index],
          );
        }
        const claimed = await tx.orders.updateMany({
          where: { id: orderId, store_id, active_financial_split_id: null },
          data: {
            active_financial_split_id: group.id,
            total_paid: allocation.preserved_paid,
            remaining_balance: allocation.pending_to_split,
          },
        });
        if (claimed.count !== 1)
          this.reject(
            'La orden cambió mientras se dividía; recarga la vista previa.',
            'SPLIT_SOURCE_CONFLICT',
          );
        return (await this.readGroup(tx, order, group.id))!;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          JSON.stringify(error.meta?.target ?? '').includes('idempotency')
        ) {
          this.reject(
            'La clave de idempotencia ya se usó para otra versión o división.',
            'SPLIT_IDEMPOTENCY_CONFLICT',
          );
        }
        throw error;
      });
  }

  private async persistAccount(
    tx: any,
    splitId: number,
    order: any,
    allocation: FinancialSplitAllocation,
    ordinal: number,
    role: 'paid_original' | 'payable',
    payer?: SplitAccountCustomerDto,
  ) {
    const { lines, ...totals } = allocation;
    const account = await tx.order_financial_accounts.create({
      data: {
        store_id: order.store_id,
        split_id: splitId,
        ordinal,
        role,
        state: 'active',
        label: payer?.label?.trim() || `Cuenta ${ordinal}`,
        customer_id: payer?.customer_id ?? null,
        customer_alias: payer?.customer_id
          ? null
          : payer?.customer_alias?.trim() || null,
        ...totals,
        paid_snapshot:
          role === 'paid_original' ? allocation.grand_total : '0.00',
      },
    });
    for (const line of lines) {
      const source = order.order_items.find(
        (item: any) => item.id === line.source_order_item_id,
      );
      const snapshot = source
        ? {
            id: source.id,
            product_id: source.product_id,
            product_variant_id: source.product_variant_id,
            product_name: source.product_name,
            quantity: source.quantity,
            unit_price: String(source.unit_price),
            total_price: String(source.total_price),
            price_unit_quantity: source.price_unit_quantity,
            weight: source.weight == null ? null : String(source.weight),
            weight_unit: source.weight_unit,
            sale_unit_code_snapshot: source.sale_unit_code_snapshot,
            sale_quantity_snapshot:
              source.sale_quantity_snapshot == null
                ? null
                : String(source.sale_quantity_snapshot),
          }
        : { kind: line.kind, source_order_id: order.id };
      const persisted = await tx.order_financial_lines.create({
        data: {
          store_id: order.store_id,
          account_id: account.id,
          source_order_item_id: line.source_order_item_id ?? null,
          kind: line.kind,
          description:
            source?.product_name ??
            (line.kind === 'shipping' ? 'Envío' : 'Propina'),
          source_snapshot: JSON.parse(JSON.stringify(snapshot)),
          subtotal_amount: line.subtotal_amount,
          discount_amount: line.discount_amount,
          tax_amount: line.tax_amount,
          total_amount: line.total_amount,
        },
      });
      for (const tax of line.taxes) {
        await tx.order_financial_line_taxes.create({
          data: {
            ...tax,
            is_compound: tax.is_compound ?? false,
            store_id: order.store_id,
            line_id: persisted.id,
          },
        });
      }
    }
  }

  /**
   * Regla de «Quitar división»: sólo bloquean los pagos de cuentas NUEVAS
   * (la retenida «Abonos anteriores» son pagos previos que se quedan en la
   * orden) y las facturas de cuenta ya transmitidas. Borradores/validadas se
   * descartan junto con la división.
   */
  private buildUndo(accounts: any[], payments: any[], invoices: any[]): SplitUndo {
    const blockers: SplitUndo['blockers'] = [];
    const toDiscard: SplitUndo['invoices_to_discard'] = [];
    for (const account of accounts) {
      if (account.role !== 'payable') continue;
      const live = payments.filter(
        (p) =>
          p.financial_account_id === account.id &&
          !DEAD_PAYMENTS.includes(p.state),
      );
      if (live.length) {
        blockers.push({
          account_id: account.id,
          account_label: account.label,
          reason: 'payment_registered',
          amount: live
            .reduce((sum, p) => sum.plus(money(p.amount)), money(0))
            .toFixed(2),
        });
      }
    }
    for (const account of accounts) {
      for (const invoice of invoices.filter(
        (i) => i.financial_account_id === account.id,
      )) {
        if (VOID_INVOICES.includes(invoice.status)) continue;
        if (DISCARDABLE_INVOICES.includes(invoice.status)) {
          toDiscard.push({
            account_id: account.id,
            account_label: account.label,
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number ?? null,
          });
        } else {
          blockers.push({
            account_id: account.id,
            account_label: account.label,
            reason: 'invoice_transmitted',
            amount: null,
          });
        }
      }
    }
    return {
      allowed: blockers.length === 0,
      blockers,
      invoices_to_discard: toDiscard,
    };
  }

  private mapLine(line: any): SplitAccountLine {
    const snap = (line.source_snapshot ?? {}) as any;
    const item = line.source_order_item;
    const subtotal = money(line.subtotal_amount);
    const itemTotal = money(snap.total_price ?? item?.total_price ?? 0);
    const ratio = itemTotal.gt(0)
      ? Prisma.Decimal.min(1, Prisma.Decimal.max(0, subtotal.div(itemTotal)))
      : money(1);
    return {
      id: line.id,
      order_item_id: line.source_order_item_id ?? null,
      product_name: item?.product_name ?? snap.product_name ?? line.description,
      variant_name: item?.variant_attributes ?? null,
      original_quantity: snap.quantity ?? item?.quantity ?? null,
      share_ratio: ratio.toDecimalPlaces(6).toString(),
      subtotal: subtotal.toFixed(2),
      discount: money(line.discount_amount).toFixed(2),
      tax: money(line.tax_amount).toFixed(2),
      total: money(line.total_amount).toFixed(2),
    };
  }

  private summary(
    account: any,
    payments: any[] = [],
    invoice: any | null = null,
    lines: any[] = [],
  ): SplitAccountSummary {
    const received = payments
      .filter((p) => RECEIVED.includes(p.state))
      .reduce(
        (sum, p) => sum.plus(money(p.amount)),
        money(account.paid_snapshot),
      );
    const reserved = payments
      .filter((p) => RESERVED.includes(p.state))
      .reduce((sum, p) => sum.plus(money(p.amount)), money(0));
    const remaining = Prisma.Decimal.max(
      0,
      money(account.grand_total).minus(received),
    );
    return {
      id: account.id ?? null,
      ordinal: account.ordinal,
      role: account.role,
      label: account.label,
      customer_id: account.customer_id ?? null,
      customer_alias: account.customer_alias ?? null,
      customer_name:
        account.customer?.legal_name ||
        [account.customer?.first_name, account.customer?.last_name]
          .filter(Boolean)
          .join(' ') ||
        null,
      payer: {
        customer_id: account.customer_id ?? null,
        customer_alias: account.customer_alias ?? null,
      },
      ...Object.fromEntries(
        [
          'subtotal_amount',
          'discount_amount',
          'tax_amount',
          'shipping_cost',
          'tip_amount',
          'grand_total',
          'paid_snapshot',
        ].map((key) => [key, money(account[key]).toFixed(2)]),
      ),
      total_paid: received.toFixed(2),
      reserved_amount: reserved.toFixed(2),
      remaining_balance: remaining.toFixed(2),
      available_to_pay: Prisma.Decimal.max(
        0,
        remaining.minus(reserved),
      ).toFixed(2),
      payment_state: remaining.eq(0)
        ? 'paid'
        : received.gt(0)
          ? 'partial'
          : reserved.gt(0)
            ? 'pending'
            : 'unpaid',
      invoice_id: invoice?.id ?? null,
      invoice: invoice
        ? {
            id: invoice.id,
            invoice_number: invoice.invoice_number ?? null,
            status: invoice.status,
            dian_status: invoice.dian_status ?? null,
            grand_total: money(invoice.total_amount).toFixed(2),
          }
        : null,
      lines: lines.map((l) => this.mapLine(l)),
      payments: payments.map((p) => ({
        id: p.id,
        amount: money(p.amount).toFixed(2),
        state: p.state,
        payment_method_name:
          p.store_payment_method?.display_name ??
          p.store_payment_method?.system_payment_method?.display_name ??
          null,
        created_at: p.created_at ? new Date(p.created_at).toISOString() : null,
        can_confirm:
          p.state === 'pending' &&
          p.store_payment_method?.system_payment_method?.processing_mode ===
            'DIRECT' &&
          ['cash', 'card', 'bank_transfer'].includes(
            p.store_payment_method?.system_payment_method?.type,
          ),
        next_action: p.gateway_response?.nextAction ?? null,
      })),
    } as SplitAccountSummary;
  }

  private previewResult(
    order: any,
    result: FinancialSplitAllocationResult,
    payers?: SplitAccountCustomerDto[],
    mode: SplitResult['mode'] = null,
  ): SplitResult {
    return {
      source_order_id: order.id,
      split_group_id: null,
      mode,
      undo: { allowed: false, blockers: [], invoices_to_discard: [] },
      source_version: this.version(order),
      currency: order.currency ?? 'COP',
      original_total: result.original_total,
      preserved_paid: result.preserved_paid,
      pending_to_split: result.pending_to_split,
      accounts: result.accounts.map((a, index) =>
        this.summary({
          ...a,
          ordinal: index + 1,
          role: 'payable',
          label: payers?.[index]?.label?.trim() || `Cuenta ${index + 1}`,
          customer_id: payers?.[index]?.customer_id ?? null,
          customer_alias: payers?.[index]?.customer_alias?.trim() || null,
          paid_snapshot: 0,
        }),
      ),
      retained_account: result.retained_account
        ? this.summary({
            ...result.retained_account,
            ordinal: 0,
            role: 'paid_original',
            label: 'Abonos anteriores',
            customer_id: order.customer_id,
            customer_alias: order.customer_alias,
            paid_snapshot: result.retained_account.grand_total,
          })
        : null,
      kitchen_fire: null,
    };
  }

  private async readGroup(
    db: any,
    order: any,
    groupId: number,
  ): Promise<SplitResult | null> {
    const group = await db.order_financial_splits.findFirst({
      where: {
        id: groupId,
        store_id: this.context().store_id,
        source_order_id: order.id,
      },
      include: {
        accounts: {
          orderBy: { ordinal: 'asc' },
          include: {
            customer: {
              select: { first_name: true, last_name: true, legal_name: true },
            },
          },
        },
      },
    });
    if (!group || group.state !== 'active') return null;
    const ids = group.accounts.map((account: any) => account.id);
    const payments = await db.payments.findMany({
      where: { order_id: order.id, financial_account_id: { in: ids } },
      orderBy: { id: 'asc' },
      include: {
        store_payment_method: { include: { system_payment_method: true } },
      },
    });
    const invoices = await db.invoices.findMany({
      where: {
        order_id: order.id,
        financial_account_id: { in: ids },
        status: { notIn: VOID_INVOICES },
      },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        dian_status: true,
        total_amount: true,
        financial_account_id: true,
      },
      orderBy: { id: 'asc' },
    });
    const lines = await db.order_financial_lines.findMany({
      where: { account_id: { in: ids } },
      orderBy: { id: 'asc' },
      include: {
        source_order_item: {
          select: {
            product_name: true,
            variant_attributes: true,
            quantity: true,
            total_price: true,
          },
        },
      },
    });
    const accounts = group.accounts.map((account: any) =>
      this.summary(
        account,
        payments.filter((p: any) => p.financial_account_id === account.id),
        invoices
          .filter((i: any) => i.financial_account_id === account.id)
          .pop() ?? null,
        lines.filter(
          (l: any) => l.account_id === account.id && l.kind === 'item',
        ),
      ),
    );
    return {
      source_order_id: order.id,
      split_group_id: group.id,
      mode: group.mode ?? null,
      undo: this.buildUndo(group.accounts, payments, invoices),
      source_version: group.source_version,
      currency: order.currency ?? 'COP',
      original_total: money(group.original_total).toFixed(2),
      preserved_paid: money(group.paid_total_snapshot).toFixed(2),
      pending_to_split: money(group.remaining_total).toFixed(2),
      accounts: accounts.filter(
        (a: SplitAccountSummary) => a.role === 'payable',
      ),
      retained_account:
        accounts.find((a: SplitAccountSummary) => a.role === 'paid_original') ??
        null,
      kitchen_fire: null,
    };
  }

  async getSplit(orderId: number): Promise<SplitResult | null> {
    const order = await this.source(this.prisma, orderId);
    return order.active_financial_split_id
      ? this.readGroup(this.prisma, order, order.active_financial_split_id)
      : null;
  }

  async cancel(
    orderId: number,
    dto: CancelFinancialSplitDto,
  ): Promise<{ cancelled: true }> {
    const { store_id } = this.context();
    return this.prisma.$transaction(async (tx: any) => {
      const order = await this.lockSource(tx, orderId);
      const group = await tx.order_financial_splits.findFirst({
        where: {
          id: order.active_financial_split_id ?? -1,
          source_order_id: orderId,
          store_id,
          state: 'active',
        },
        include: { accounts: true },
      });
      if (!group || group.source_version !== dto.source_version)
        this.reject(
          'La división cambió; recarga las cuentas.',
          'SPLIT_SOURCE_CONFLICT',
        );
      const accountIds: number[] = group.accounts.map((a: any) => a.id);
      const payments = await tx.payments.findMany({
        where: { financial_account_id: { in: accountIds } },
        select: { financial_account_id: true, state: true, amount: true },
      });
      const invoices = await tx.invoices.findMany({
        where: {
          financial_account_id: { in: accountIds },
          status: { notIn: VOID_INVOICES },
        },
        select: {
          id: true,
          invoice_number: true,
          status: true,
          financial_account_id: true,
        },
      });
      const undo = this.buildUndo(group.accounts, payments, invoices);
      if (!undo.allowed) {
        const first = undo.blockers[0];
        this.reject(
          first.reason === 'payment_registered'
            ? `No se puede quitar la división: ${first.account_label} ya tiene un pago registrado.`
            : `No se puede quitar la división: la factura de ${first.account_label} ya fue enviada a la DIAN.`,
          'SPLIT_CANCEL_BLOCKED',
        );
      }
      if (undo.invoices_to_discard.length) {
        // Se descarta aquí (draft/validated -> cancelled, la misma transición
        // de «Descartar borrador») y no con InvoiceFlowService.cancel porque
        // éste usa su propio cliente Prisma, fuera de esta transacción: un
        // rollback dejaría las facturas descartadas con la división vigente.
        // Un borrador/validada nunca transmitida no afecta libros, por eso se
        // omite el chequeo de periodo fiscal de ese método (privado).
        const discardIds = undo.invoices_to_discard.map((i) => i.invoice_id);
        const discarded = await tx.invoices.updateMany({
          where: {
            id: { in: discardIds },
            store_id,
            financial_account_id: { in: accountIds },
            status: { in: DISCARDABLE_INVOICES },
          },
          data: { status: 'cancelled' },
        });
        if (discarded.count !== discardIds.length) {
          this.reject(
            'La división cambió; recarga las cuentas.',
            'SPLIT_SOURCE_CONFLICT',
          );
        }
      }
      await tx.order_financial_accounts.updateMany({
        where: { split_id: group.id, store_id },
        data: { state: 'cancelled' },
      });
      await tx.order_financial_splits.updateMany({
        where: { id: group.id, store_id, state: 'active' },
        data: { state: 'cancelled' },
      });
      await tx.orders.updateMany({
        where: { id: orderId, store_id, active_financial_split_id: group.id },
        data: { active_financial_split_id: null },
      });
      return { cancelled: true as const };
    });
  }

  async updateCustomer(
    orderId: number,
    accountId: number,
    dto: SplitAccountCustomerDto,
  ): Promise<SplitResult> {
    const { store_id } = this.context();
    await this.prisma.$transaction(async (tx: any) => {
      const order = await this.lockSource(tx, orderId);
      const account = await tx.order_financial_accounts.findFirst({
        where: {
          id: accountId,
          store_id,
          split_id: order.active_financial_split_id ?? -1,
          state: 'active',
        },
      });
      if (!account)
        throw new VendixHttpException(
          FinancialSplitErrors.SPLIT_ACCOUNT_NOT_FOUND,
        );
      await this.validatePayers(tx, [dto], 1);
      if (
        account.role === 'paid_original' ||
        (await tx.payments.count({
          where: {
            financial_account_id: accountId,
            state: { in: [...RECEIVED, ...RESERVED] },
          },
        })) ||
        (await tx.invoices.count({
          where: {
            financial_account_id: accountId,
            status: { notIn: VOID_INVOICES },
          },
        }))
      ) {
        this.reject(
          'El titular queda fijado al cobrar o facturar la cuenta.',
          'SPLIT_ACCOUNT_LOCKED',
        );
      }
      await tx.order_financial_accounts.updateMany({
        where: { id: accountId, store_id },
        data: {
          ...(dto.label !== undefined
            ? { label: dto.label?.trim() || `Cuenta ${account.ordinal}` }
            : {}),
          ...(dto.customer_id !== undefined || dto.customer_alias !== undefined
            ? {
                customer_id: dto.customer_id ?? null,
                customer_alias: dto.customer_id
                  ? null
                  : dto.customer_alias?.trim() || null,
              }
            : {}),
        },
      });
    });
    return (await this.getSplit(orderId))!;
  }
}

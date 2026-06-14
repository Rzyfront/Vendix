import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AccountMappingService } from '../account-mappings/account-mapping.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { FiscalGateService } from '@common/services/fiscal-gate.service';
import { TaxBreakdownItem } from '@common/interfaces/tax-breakdown.interface';
import { WithholdingLine } from '@common/interfaces/withholding-breakdown.interface';

export interface AutoEntryEventData {
  source_type: string;
  source_id: number;
  organization_id: number;
  store_id?: number;
  accounting_entity_id?: number;
  entry_date: Date;
  description: string;
  lines: (AutoEntryLine | null)[];
  user_id?: number;
}

export interface AutoEntryLine {
  account_code: string;
  description?: string;
  debit_amount: number;
  credit_amount: number;
}

/**
 * AutoEntryService - Hub for automatic journal entry creation.
 *
 * This service listens to events from other modules (invoicing, payments,
 * expenses, payroll, orders, refunds, purchases, inventory) and creates
 * corresponding journal entries automatically.
 *
 * Account codes are resolved via AccountMappingService which supports
 * store-level overrides, organization-level mappings, and PUC defaults.
 */
@Injectable()
export class AutoEntryService {
  private readonly logger = new Logger(AutoEntryService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly account_mapping_service: AccountMappingService,
    private readonly fiscal_scope_service: FiscalScopeService,
    private readonly fiscal_gate: FiscalGateService,
  ) {}

  /**
   * Resolve a single account line using AccountMappingService.
   */
  private async resolveAccountLine(
    org_id: number,
    mapping_key: string,
    description: string,
    debit_amount: number,
    credit_amount: number,
    store_id?: number,
  ): Promise<AutoEntryLine | null> {
    const mapping = await this.account_mapping_service.getMapping(
      org_id,
      mapping_key,
      store_id,
    );
    if (!mapping) return null;
    return {
      account_code: mapping.account_code,
      description,
      debit_amount,
      credit_amount,
    };
  }

  /**
   * Build one journal line per fiscal tax type from a typed `tax_breakdown`,
   * routing each type to its own mapping key (`<prefix>.<type>_<suffix>`, e.g.
   * `invoice.validated.inc_payable` → 2436). This is what separates IVA, INC and
   * ICA into distinct PUC accounts instead of collapsing everything into 2408.
   *
   * Resilience guarantees (so the entry always balances):
   * - If `breakdown` is absent/empty, falls back to a single line on `legacyKey`
   *   for the scalar `total` (back-compat with flows that don't emit a breakdown).
   * - If a per-type mapping is missing (e.g. the Step 8 seed hasn't run yet),
   *   falls back to `legacyKey` for that line so the amount is never dropped.
   *
   * @param suffix logical role of the line (`payable` for sales, `deductible` for purchases)
   * @param side which column carries the amount (`credit` for payable, `debit` for deductible)
   */
  private async resolveTaxLines(params: {
    organization_id: number;
    store_id?: number;
    prefix: string; // e.g. 'invoice.validated'
    suffix: 'payable' | 'deductible';
    side: 'credit' | 'debit';
    total: number; // scalar fallback total
    breakdown?: TaxBreakdownItem[];
    legacyKey: string; // e.g. 'invoice.validated.vat_payable'
    label: string;
  }): Promise<(AutoEntryLine | null)[]> {
    const {
      organization_id,
      store_id,
      prefix,
      suffix,
      side,
      total,
      breakdown,
      legacyKey,
      label,
    } = params;

    const makeLine = (amount: number, key: string, desc: string) =>
      this.resolveAccountLine(
        organization_id,
        key,
        desc,
        side === 'debit' ? amount : 0,
        side === 'credit' ? amount : 0,
        store_id,
      );

    if (breakdown && breakdown.length > 0) {
      const out: (AutoEntryLine | null)[] = [];
      for (const item of breakdown) {
        const amount = Number(item.tax_amount || 0);
        if (amount <= 0) continue;
        const typed_key = `${prefix}.${item.tax_type}_${suffix}`;
        const desc = `${label} (${item.tax_type.toUpperCase()})`;
        let line = await makeLine(amount, typed_key, desc);
        if (!line) {
          // Per-type mapping not configured: keep the entry balanced via legacy key.
          line = await makeLine(amount, legacyKey, desc);
        }
        out.push(line);
      }
      return out;
    }

    // No typed breakdown: single legacy line for the scalar total.
    if (total > 0) {
      return [await makeLine(total, legacyKey, label)];
    }
    return [];
  }

  /**
   * Build one journal line per withholding line carried on a typed
   * `withholding_breakdown` (Block B). Mirrors `resolveTaxLines`, but routes via
   * the withholding `account_role` mapping key (`withholding.<role>.<type>_<suffix>`)
   * and honors a per-concept PUC leaf override.
   *
   * Account resolution per line (mirrors how a posted line is validated later in
   * `createAutoEntry`, which checks the `account_code` exists in
   * `chart_of_accounts` for the org/entity):
   *   1. PREFER `line.account_code` (raw PUC leaf from `withholding_concepts`)
   *      when present AND it resolves to an existing chart_of_accounts account
   *      for the org. This is the per-concept override (e.g. 236515 honorarios).
   *   2. ELSE fall back to the dual-source mapping via
   *      `AccountMappingService.getMapping(org, line.account_role, store_id)`,
   *      which resolves store override → org base → DEFAULT_ACCOUNT_MAPPINGS.
   *
   * Side:
   *   - practiced (retenedor) → liability credit (2365/2367/2368) → `side='credit'`
   *   - suffered  (retenido)  → asset debit (1355xx)              → `side='debit'`
   *
   * Empty/undefined breakdown → returns `[]` (zero lines), guaranteeing zero
   * regression for flows that don't carry a breakdown yet.
   */
  private async resolveWithholdingLines(params: {
    organization_id: number;
    store_id?: number;
    breakdown?: WithholdingLine[];
    side: 'debit' | 'credit';
  }): Promise<(AutoEntryLine | null)[]> {
    const { organization_id, store_id, breakdown, side } = params;
    if (!breakdown || breakdown.length === 0) return [];

    const out: (AutoEntryLine | null)[] = [];
    for (const item of breakdown) {
      const amount = Number(item.amount || 0);
      if (amount <= 0) continue;

      const desc = `Retención ${item.withholding_type.toUpperCase()} (${item.concept_code})`;

      // 1. Per-concept PUC leaf override — only when it actually exists in the
      //    org's chart_of_accounts (the same validation createAutoEntry applies).
      let account_code: string | null = null;
      if (item.account_code) {
        const exists = await this.accountCodeExistsForOrg(
          organization_id,
          item.account_code,
        );
        if (exists) account_code = item.account_code;
      }

      // 2. Fallback to the dual-source mapping key (default leaf or override).
      if (!account_code) {
        const mapping = await this.account_mapping_service.getMapping(
          organization_id,
          item.account_role,
          store_id,
        );
        account_code = mapping?.account_code ?? null;
      }

      if (!account_code) {
        // No resolvable account: skip the line (createAutoEntry would reject it).
        out.push(null);
        continue;
      }

      out.push({
        account_code,
        description: desc,
        debit_amount: side === 'debit' ? amount : 0,
        credit_amount: side === 'credit' ? amount : 0,
      });
    }
    return out;
  }

  /**
   * Returns true when a raw PUC leaf code exists in `chart_of_accounts` for the
   * organization (any of its accounting entities). Used to validate a
   * per-concept withholding `account_code` override before preferring it over
   * the mapping-key default.
   */
  private async accountCodeExistsForOrg(
    organization_id: number,
    code: string,
  ): Promise<boolean> {
    const account = await this.prisma.chart_of_accounts.findFirst({
      where: { organization_id, code },
      select: { id: true },
    });
    return !!account;
  }

  /**
   * Create an automatic journal entry from event data.
   * Validates accounts exist, finds the appropriate fiscal period,
   * creates a balanced entry and auto-posts it.
   */
  async createAutoEntry(event_data: AutoEntryEventData) {
    const {
      source_type,
      source_id,
      organization_id,
      store_id,
      accounting_entity_id,
      entry_date,
      description,
      lines,
      user_id,
    } = event_data;

    // Default ESTRICTO: no materializar entidades/asientos contables si el área
    // `accounting` no está activa para la organización. Red de seguridad para
    // orígenes que no pasen por AccountingEventsListener (que ya gatea antes).
    const accounting_enabled = await this.fiscal_gate.isAreaEnabled(
      organization_id,
      store_id ?? null,
      'accounting',
    );
    if (!accounting_enabled) {
      this.logger.warn(
        `Skipping auto-entry for ${source_type} #${source_id}: accounting area inactive for organization #${organization_id}`,
      );
      return null;
    }

    const accounting_entity = accounting_entity_id
      ? await this.prisma.withoutScope().accounting_entities.findFirst({
          where: {
            id: accounting_entity_id,
            organization_id,
            is_active: true,
          },
        })
      : await this.fiscal_scope_service.resolveAccountingEntityForFiscal({
          organization_id,
          store_id,
        });

    if (!accounting_entity) {
      throw new Error(
        `Unable to resolve accounting entity for organization #${organization_id}`,
      );
    }

    if (
      store_id &&
      accounting_entity.scope === 'STORE' &&
      accounting_entity.store_id !== store_id
    ) {
      throw new Error(
        `Accounting entity #${accounting_entity.id} does not belong to store #${store_id}`,
      );
    }

    // Filter out null lines (from unconfigured mappings)
    const valid_lines = lines.filter(Boolean) as AutoEntryLine[];

    // Need at least 2 lines for a valid entry (debit + credit)
    if (valid_lines.length < 2) {
      this.logger.warn(
        `Skipping auto-entry for ${source_type} #${source_id}: insufficient configured mappings (${valid_lines.length} lines)`,
      );
      return null;
    }

    // Validate lines balance
    const total_debit = valid_lines.reduce(
      (sum, l) => sum + Number(l.debit_amount),
      0,
    );
    const total_credit = valid_lines.reduce(
      (sum, l) => sum + Number(l.credit_amount),
      0,
    );

    if (Math.abs(total_debit - total_credit) > 0.001) {
      this.logger.error(
        `Auto-entry balance error for ${source_type}#${source_id}: ` +
          `debit=${total_debit}, credit=${total_credit}`,
      );
      throw new Error(
        `Auto-entry lines do not balance: debit=${total_debit}, credit=${total_credit}`,
      );
    }

    // Find the open fiscal period for the entry date
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: {
        organization_id,
        OR: [
          { accounting_entity_id: accounting_entity.id },
          { accounting_entity_id: null },
        ],
        status: 'open',
        start_date: { lte: entry_date },
        end_date: { gte: entry_date },
      },
      orderBy: { accounting_entity_id: 'desc' },
    });

    if (!fiscal_period) {
      this.logger.error(
        `No open fiscal period found for date ${entry_date.toISOString()} ` +
          `in organization #${organization_id}`,
      );
      throw new Error(
        `No open fiscal period found for date ${entry_date.toISOString()}`,
      );
    }

    // Resolve account codes to IDs
    const account_codes = valid_lines.map((l) => l.account_code);
    const accounts = await this.prisma.chart_of_accounts.findMany({
      where: {
        organization_id,
        OR: [
          { accounting_entity_id: accounting_entity.id },
          { accounting_entity_id: null },
        ],
        code: { in: account_codes },
      },
      orderBy: { accounting_entity_id: 'desc' },
    });

    const account_map = new Map<string, any>();
    for (const account of accounts as any[]) {
      const current = account_map.get(account.code);
      if (!current || account.accounting_entity_id === accounting_entity.id) {
        account_map.set(account.code, account);
      }
    }

    // Validate all account codes exist
    for (const code of account_codes) {
      if (!account_map.has(code)) {
        this.logger.error(
          `Account code '${code}' not found for auto-entry ${source_type}#${source_id}`,
        );
        throw new Error(
          `Account code '${code}' not found in chart of accounts`,
        );
      }
    }

    // Map entry type from source_type
    const entry_type_map: Record<string, string> = {
      'invoice.validated': 'auto_invoice',
      'credit_note.accepted': 'auto_return',
      'support_document.accepted': 'auto_purchase',
      'payment.received': 'auto_payment',
      'expense.approved': 'auto_expense',
      'expense.paid': 'auto_expense',
      'payroll.approved': 'auto_payroll',
      'payroll.paid': 'auto_payroll',
      'order.completed': 'auto_inventory',
      'production.completed': 'auto_inventory',
      'refund.completed': 'auto_return',
      'purchase_order.received': 'auto_purchase',
      'purchase_order.payment': 'auto_purchase',
      'inventory.adjusted': 'auto_inventory',
      'credit_sale.created': 'auto_invoice', // Uses auto_invoice type (revenue recognition without payment)
      installment_payment: 'auto_installment_payment',
      'layaway.payment': 'auto_payment',
      'layaway.completed': 'auto_payment',
      'depreciation.monthly': 'auto_depreciation',
      'disposal.fixed_asset': 'auto_depreciation',
      'withholding.applied': 'auto_expense',
      payroll_item: 'auto_payroll',
      'settlement.paid': 'auto_payroll',
      ar_write_off: 'adjustment',
      ap_payment: 'auto_purchase',
      ap_write_off: 'adjustment',
      commission: 'auto_expense',
      stock_transfer: 'auto_inventory',
      'intercompany_transfer.shipped': 'auto_inventory',
      'intercompany_transfer.received': 'auto_inventory',
      cash_register_opened: 'adjustment',
      cash_register_closed: 'adjustment',
      cash_register_movement: 'adjustment',
      'expense.refunded': 'auto_expense',
      'expense.cancelled': 'auto_expense',
    };
    const entry_type = entry_type_map[source_type] || 'manual';

    // Generate entry number
    const year = new Date().getFullYear();
    const prefix = `AE-${year}-`;
    const latest = await this.prisma.accounting_entries.findFirst({
      where: {
        organization_id,
        accounting_entity_id: accounting_entity.id,
        entry_number: { startsWith: prefix },
      },
      orderBy: { entry_number: 'desc' },
    });

    let sequence = 1;
    if (latest) {
      const last_number = parseInt(latest.entry_number.replace(prefix, ''), 10);
      if (!isNaN(last_number)) {
        sequence = last_number + 1;
      }
    }
    const entry_number = `${prefix}${String(sequence).padStart(6, '0')}`;

    const existing_entry = await this.prisma.accounting_entries.findFirst({
      where: {
        organization_id,
        source_type,
        source_id,
        accounting_entity_id: accounting_entity.id,
      },
    });
    if (existing_entry) {
      this.logger.warn(
        `Skipping duplicate auto-entry for ${source_type}#${source_id} ` +
          `(entry #${existing_entry.id})`,
      );
      return existing_entry;
    }

    // Create the entry and lines in a transaction, auto-posted
    const entry = await this.prisma.$transaction(async (tx: any) => {
      const created_entry = await tx.accounting_entries.create({
        data: {
          organization_id,
          store_id: store_id || null,
          accounting_entity_id: accounting_entity.id,
          entry_number,
          entry_type: entry_type as any,
          status: 'posted',
          fiscal_period_id: fiscal_period.id,
          entry_date,
          description,
          source_type,
          source_id,
          total_debit: new Prisma.Decimal(total_debit),
          total_credit: new Prisma.Decimal(total_credit),
          created_by_user_id: user_id || null,
          posted_by_user_id: user_id || null,
          posted_at: new Date(),
        },
      });

      await tx.accounting_entry_lines.createMany({
        data: valid_lines.map((line) => {
          const account: any = account_map.get(line.account_code);
          return {
            entry_id: created_entry.id,
            account_id: account.id,
            description: line.description || null,
            debit_amount: new Prisma.Decimal(line.debit_amount),
            credit_amount: new Prisma.Decimal(line.credit_amount),
          };
        }),
      });

      if (
        source_type === 'invoice.validated' ||
        source_type === 'credit_note.accepted' ||
        source_type === 'support_document.accepted'
      ) {
        await tx.invoices.updateMany({
          where: {
            id: source_id,
            organization_id,
            accounting_entity_id: accounting_entity.id,
          },
          data: {
            accounting_entry_id: created_entry.id,
            accounting_status: 'posted',
          },
        });
        await tx.fiscal_transmissions.updateMany({
          where: {
            source_type: 'invoice',
            source_id,
            accounting_entity_id: accounting_entity.id,
          },
          data: { accounting_status: 'posted' },
        });
      }

      if (source_type === 'payroll.approved') {
        await tx.payroll_runs.updateMany({
          where: {
            id: source_id,
            organization_id,
            accounting_entity_id: accounting_entity.id,
          },
          data: {
            accounting_entry_id: created_entry.id,
            accounting_status: 'posted',
          },
        });
        await tx.payroll_items.updateMany({
          where: {
            payroll_run_id: source_id,
            accounting_entity_id: accounting_entity.id,
            dian_status: 'accepted',
          },
          data: { accounting_status: 'posted' },
        });
      }

      return created_entry;
    });

    this.logger.log(
      `Auto journal entry created: ${entry_number} for ${source_type}#${source_id} ` +
        `(debit=${total_debit}, credit=${total_credit})`,
    );

    return entry;
  }

  // ===== Event Handler Methods =====
  // These can be called directly by other services or wired via @OnEvent()

  /**
   * Fiscal invoice acceptance: Debit Accounts Receivable, Credit Revenue + VAT Payable.
   * Mapping/source keys keep the legacy invoice.validated name for compatibility.
   */
  async onInvoiceValidated(data: {
    invoice_id: number;
    organization_id: number;
    store_id?: number;
    subtotal: number;
    tax_amount: number;
    tax_breakdown?: TaxBreakdownItem[];
    withholding_breakdown?: WithholdingLine[];
    total: number;
    user_id?: number;
    accounting_entity_id?: number;
  }) {
    // Caso 2 (retenido): the customer withholds part of the payment. Recognize
    // the withholding as an asset (1355) at revenue recognition and reduce the
    // receivable by the same amount. Empty breakdown → identical to legacy.
    const wh_total = (data.withholding_breakdown ?? []).reduce(
      (sum, l) => sum + Number(l.amount || 0),
      0,
    );
    const accounts_receivable = Math.max(0, Number(data.total || 0) - wh_total);
    const lines: (AutoEntryLine | null)[] = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'invoice.validated.accounts_receivable',
        'Accounts Receivable',
        accounts_receivable,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'invoice.validated.revenue',
        'Revenue',
        0,
        data.subtotal,
        data.store_id,
      ),
    ]);

    lines.push(
      ...(await this.resolveTaxLines({
        organization_id: data.organization_id,
        store_id: data.store_id,
        prefix: 'invoice.validated',
        suffix: 'payable',
        side: 'credit',
        total: data.tax_amount,
        breakdown: data.tax_breakdown,
        legacyKey: 'invoice.validated.vat_payable',
        label: 'VAT Payable',
      })),
    );

    // Caso 2: asset debit per withholding type (135510/135515/135517).
    lines.push(
      ...(await this.resolveWithholdingLines({
        organization_id: data.organization_id,
        store_id: data.store_id,
        breakdown: data.withholding_breakdown,
        side: 'debit',
      })),
    );

    return this.createAutoEntry({
      source_type: 'invoice.validated',
      source_id: data.invoice_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      accounting_entity_id: data.accounting_entity_id,
      entry_date: new Date(),
      description: `Invoice validated #${data.invoice_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * Credit note acceptance (nota crédito DIAN): mirror reversal of the sale
   * entry posted by `onInvoiceValidated`.
   *
   *   DR 4175 Devoluciones en Ventas (subtotal)
   *   DR 2408/2436/2412 tax liability per typed `tax_breakdown`
   *   CR 1305 Cuentas por Cobrar (total)
   *
   * Tax routing reuses `resolveTaxLines` with `side='debit'` so each fiscal
   * type reverses its own liability account (`credit_note.accepted.<type>_payable`).
   * Rows without a typed mapping (or breakdown-less events) fall back to the
   * IVA key, matching the `tax_type null → iva` contract of buildTaxBreakdown.
   */
  async onCreditNoteAccepted(data: {
    invoice_id: number;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    subtotal: number;
    tax_amount: number;
    tax_breakdown?: TaxBreakdownItem[];
    total: number;
    user_id?: number;
  }) {
    const lines: (AutoEntryLine | null)[] = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'credit_note.accepted.sales_returns',
        'Devoluciones en Ventas (nota crédito)',
        data.subtotal,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'credit_note.accepted.accounts_receivable',
        'Cuentas por Cobrar (reversa nota crédito)',
        0,
        data.total,
        data.store_id,
      ),
    ]);

    lines.push(
      ...(await this.resolveTaxLines({
        organization_id: data.organization_id,
        store_id: data.store_id,
        prefix: 'credit_note.accepted',
        suffix: 'payable',
        side: 'debit',
        total: data.tax_amount,
        breakdown: data.tax_breakdown,
        legacyKey: 'credit_note.accepted.iva_payable',
        label: 'Impuesto por Pagar (reversa nota crédito)',
      })),
    );

    return this.createAutoEntry({
      source_type: 'credit_note.accepted',
      source_id: data.invoice_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      accounting_entity_id: data.accounting_entity_id,
      entry_date: new Date(),
      description: `Credit note accepted #${data.invoice_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * Support document acceptance: debit purchase/expense and deductible VAT,
   * credit supplier payable and withholding payable when applicable.
   */
  async onSupportDocumentAccepted(data: {
    invoice_id: number;
    organization_id: number;
    store_id?: number;
    accounting_entity_id?: number;
    subtotal: number;
    discount_amount?: number;
    tax_amount: number;
    withholding_amount?: number;
    withholding_breakdown?: WithholdingLine[];
    total: number;
    user_id?: number;
  }) {
    const purchase_base = Math.max(
      0,
      Number(data.subtotal || 0) - Number(data.discount_amount || 0),
    );

    // Typed breakdown (Block C1) takes precedence over the scalar amount: it
    // splits the single 2365 credit into per-type liability lines (2365/2367/
    // 2368) and uses its summed amount to reduce accounts payable.
    const has_breakdown =
      !!data.withholding_breakdown && data.withholding_breakdown.length > 0;
    const breakdown_total = has_breakdown
      ? data.withholding_breakdown!.reduce(
          (sum, l) => sum + Number(l.amount || 0),
          0,
        )
      : 0;
    const withholding = has_breakdown
      ? breakdown_total
      : Math.max(0, Number(data.withholding_amount || 0));
    const accounts_payable = Math.max(0, Number(data.total || 0) - withholding);
    const lines: (AutoEntryLine | null)[] = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'support_document.accepted.expense',
        'Support Document Purchase/Expense',
        purchase_base,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'support_document.accepted.accounts_payable',
        'Accounts Payable',
        0,
        accounts_payable,
        data.store_id,
      ),
    ]);

    if (data.tax_amount > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'support_document.accepted.vat_deductible',
          'Deductible VAT',
          data.tax_amount,
          0,
          data.store_id,
        ),
      );
    }

    if (has_breakdown) {
      // Per-type withholding credits (practiced → liability credit).
      lines.push(
        ...(await this.resolveWithholdingLines({
          organization_id: data.organization_id,
          store_id: data.store_id,
          breakdown: data.withholding_breakdown,
          side: 'credit',
        })),
      );
    } else if (withholding > 0) {
      // Legacy scalar path (back-compat): single 2365 credit.
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'support_document.accepted.withholding_payable',
          'Withholding Payable',
          0,
          withholding,
          data.store_id,
        ),
      );
    }

    return this.createAutoEntry({
      source_type: 'support_document.accepted',
      source_id: data.invoice_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      accounting_entity_id: data.accounting_entity_id,
      entry_date: new Date(),
      description: `Support document accepted #${data.invoice_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * Resolve the cash/bank mapping key based on payment method.
   * cash/efectivo → payment.received.cash (1105)
   * transfer/card/other → payment.received.bank (1110)
   */
  private resolveCashBankKey(payment_method?: string): string {
    if (!payment_method) return 'payment.received.cash';
    const method = payment_method.toLowerCase();
    const is_cash = method.includes('cash') || method.includes('efectivo');
    return is_cash ? 'payment.received.cash' : 'payment.received.bank';
  }

  /**
   * payment.received:
   * - WITH invoice: Debit Cash/Bank, Credit Accounts Receivable (invoice already recognized revenue)
   * - WITHOUT invoice (POS direct sale): Debit Cash/Bank, Credit Revenue + VAT if applicable
   */
  async onPaymentReceived(data: {
    payment_id: number;
    organization_id: number;
    store_id?: number;
    order_id?: number;
    order_number?: string;
    payment_method?: string;
    amount: number;
    subtotal_amount?: number;
    tax_amount?: number;
    tax_breakdown?: TaxBreakdownItem[];
    withholding_breakdown?: WithholdingLine[];
    discount_amount?: number;
    user_id?: number;
  }) {
    // Check if this payment's order has an associated invoice
    let has_invoice = false;
    if (data.order_id) {
      const invoice = await this.prisma.invoices.findFirst({
        where: {
          order_id: data.order_id,
          status: { notIn: ['cancelled', 'voided'] },
        },
        select: { id: true },
      });
      has_invoice = !!invoice;
    }

    const payment_desc = data.payment_method
      ? `Pago ${data.payment_method}`
      : 'Pago recibido';
    const order_ref = data.order_number ? ` - Orden ${data.order_number}` : '';

    const cash_bank_key = this.resolveCashBankKey(data.payment_method);
    let lines: (AutoEntryLine | null)[];

    if (has_invoice) {
      // Invoice exists: Debit Cash/Bank, Credit AR (invoice.validated already recognized revenue+IVA)
      lines = await Promise.all([
        this.resolveAccountLine(
          data.organization_id,
          cash_bank_key,
          `${payment_desc}${order_ref}`,
          data.amount,
          0,
          data.store_id,
        ),
        this.resolveAccountLine(
          data.organization_id,
          'payment.received.accounts_receivable',
          `Recaudo CxC${order_ref}`,
          0,
          data.amount,
          data.store_id,
        ),
      ]);
    } else {
      // No invoice (POS direct sale): Debit Cash/Bank + Discount, Credit Revenue + VAT
      const tax = Number(data.tax_amount || 0);
      const discount = Number(data.discount_amount || 0);
      const subtotal =
        data.subtotal_amount != null
          ? Number(data.subtotal_amount)
          : data.amount + discount - tax; // fallback: derive subtotal from amount + discount - tax

      lines = [
        await this.resolveAccountLine(
          data.organization_id,
          cash_bank_key,
          `${payment_desc}${order_ref}`,
          data.amount,
          0,
          data.store_id,
        ),
      ];

      // Discount line (debit contra-revenue account 4175)
      if (discount > 0) {
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payment.received.sales_discount',
            `Descuento en venta${order_ref}`,
            discount,
            0,
            data.store_id,
          ),
        );
      }

      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'payment.received.revenue',
          `Venta directa${order_ref}`,
          0,
          subtotal,
          data.store_id,
        ),
      );

      // Separate tax lines per fiscal type (IVA→2408, INC→2436, ICA→241205)
      lines.push(
        ...(await this.resolveTaxLines({
          organization_id: data.organization_id,
          store_id: data.store_id,
          prefix: 'payment.received',
          suffix: 'payable',
          side: 'credit',
          total: tax,
          breakdown: data.tax_breakdown,
          legacyKey: 'payment.received.vat_payable',
          label: `IVA venta directa${order_ref}`,
        })),
      );

      // Caso 2 (retenido) on POS-direct sale: asset 1355 debit; revenue stays
      // gross, cash stays net-received, so debits (cash + 1355) = credits.
      lines.push(
        ...(await this.resolveWithholdingLines({
          organization_id: data.organization_id,
          store_id: data.store_id,
          breakdown: data.withholding_breakdown,
          side: 'debit',
        })),
      );
    }

    const description = has_invoice
      ? `Recaudo factura - Pago #${data.payment_id}${order_ref}`
      : `Venta POS #${data.payment_id}${order_ref}`;

    return this.createAutoEntry({
      source_type: 'payment.received',
      source_id: data.payment_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * credit_sale.created: Debit Accounts Receivable, Credit Revenue + VAT Payable
   * For POS credit sales (requires_payment = false)
   */
  async onCreditSaleCreated(data: {
    order_id: number;
    organization_id: number;
    store_id?: number;
    order_number?: string;
    subtotal_amount: number;
    tax_amount: number;
    tax_breakdown?: TaxBreakdownItem[];
    withholding_breakdown?: WithholdingLine[];
    discount_amount?: number;
    total_amount: number;
    user_id?: number;
  }) {
    const order_ref = data.order_number ? ` - Orden ${data.order_number}` : '';
    const discount = Number(data.discount_amount || 0);

    // Caso 2 (retenido): reduce receivable by withholding, recognize asset 1355.
    const wh_total = (data.withholding_breakdown ?? []).reduce(
      (sum, l) => sum + Number(l.amount || 0),
      0,
    );
    const accounts_receivable = Math.max(
      0,
      Number(data.total_amount || 0) - wh_total,
    );

    const lines: (AutoEntryLine | null)[] = [
      await this.resolveAccountLine(
        data.organization_id,
        'credit_sale.created.accounts_receivable',
        `CxC venta a crédito${order_ref}`,
        accounts_receivable,
        0,
        data.store_id,
      ),
    ];

    // Discount line (debit contra-revenue account 4175)
    if (discount > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'credit_sale.created.sales_discount',
          `Descuento venta a crédito${order_ref}`,
          discount,
          0,
          data.store_id,
        ),
      );
    }

    lines.push(
      await this.resolveAccountLine(
        data.organization_id,
        'credit_sale.created.revenue',
        `Ingreso venta a crédito${order_ref}`,
        0,
        data.subtotal_amount,
        data.store_id,
      ),
    );

    lines.push(
      ...(await this.resolveTaxLines({
        organization_id: data.organization_id,
        store_id: data.store_id,
        prefix: 'credit_sale.created',
        suffix: 'payable',
        side: 'credit',
        total: data.tax_amount,
        breakdown: data.tax_breakdown,
        legacyKey: 'credit_sale.created.vat_payable',
        label: `IVA venta a crédito${order_ref}`,
      })),
    );

    // Caso 2: asset debit per withholding type (135510/135515/135517).
    lines.push(
      ...(await this.resolveWithholdingLines({
        organization_id: data.organization_id,
        store_id: data.store_id,
        breakdown: data.withholding_breakdown,
        side: 'debit',
      })),
    );

    return this.createAutoEntry({
      source_type: 'credit_sale.created',
      source_id: data.order_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Venta a crédito #${data.order_id}${order_ref}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * expense.approved: Debit Expense account, Credit Accounts Payable
   */
  async onExpenseApproved(data: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'expense.approved.expense',
        'Expense',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'expense.approved.accounts_payable',
        'Accounts Payable',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'expense.approved',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Expense approved #${data.expense_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * expense.paid: Debit Accounts Payable, Credit Cash/Bank
   */
  async onExpensePaid(data: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'expense.paid.accounts_payable',
        'Accounts Payable',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'expense.paid.cash',
        'Cash/Bank',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'expense.paid',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Expense paid #${data.expense_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * payroll.approved: Debit Payroll Expense + SS (split by cost center), Credit Salaries Payable + Health + Pension
   *
   * Cost center mapping:
   *   administrative → 5105 (Gastos de Personal - Admin)
   *   operational    → 7205 (Mano de Obra Directa - Costo)
   *   sales          → 5205 (Gastos de Personal - Ventas)
   *
   * Liability accounts (credit side) are shared across all cost centers.
   */
  async onPayrollApproved(data: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    total_earnings: number;
    total_employer_costs: number;
    total_deductions: number;
    total_net_pay: number;
    health_deduction: number;
    pension_deduction: number;
    accounting_entity_id?: number;
    user_id?: number;
    cost_center_breakdown?: Record<
      string,
      { earnings: number; employer_costs: number }
    >;
  }) {
    const lines: (AutoEntryLine | null)[] = [];

    // === DEBIT LINES ===
    if (
      data.cost_center_breakdown &&
      Object.keys(data.cost_center_breakdown).length > 0
    ) {
      for (const [cc, amounts] of Object.entries(data.cost_center_breakdown)) {
        if (amounts.earnings > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              `payroll.approved.payroll_expense.${cc}`,
              `Gasto nómina (${cc})`,
              amounts.earnings,
              0,
              data.store_id,
            ),
          );
        }
        if (amounts.employer_costs > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              `payroll.approved.social_security.${cc}`,
              `Seguridad social (${cc})`,
              amounts.employer_costs,
              0,
              data.store_id,
            ),
          );
        }
      }
    } else {
      if (data.total_earnings > 0) {
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.payroll_expense',
            'Gasto nómina',
            data.total_earnings,
            0,
            data.store_id,
          ),
        );
      }
      if (data.total_employer_costs > 0) {
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.social_security',
            'Seguridad social',
            data.total_employer_costs,
            0,
            data.store_id,
          ),
        );
      }
    }

    // === CREDIT LINES ===
    if (data.total_net_pay > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'payroll.approved.salaries_payable',
          'Salarios por pagar',
          0,
          data.total_net_pay,
          data.store_id,
        ),
      );
    }

    if (data.health_deduction > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'payroll.approved.health_payable',
          'EPS por pagar',
          0,
          data.health_deduction,
          data.store_id,
        ),
      );
    }

    if (data.pension_deduction > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'payroll.approved.pension_payable',
          'Pensión por pagar',
          0,
          data.pension_deduction,
          data.store_id,
        ),
      );
    }

    // Withholdings = total debits - (net_pay + health + pension)
    const total_debits = data.total_earnings + data.total_employer_costs;
    const remaining =
      total_debits -
      (data.total_net_pay + data.health_deduction + data.pension_deduction);
    if (remaining > 0.001) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'payroll.approved.withholdings',
          'Retenciones y deducciones',
          0,
          remaining,
          data.store_id,
        ),
      );
    }

    return this.createAutoEntry({
      source_type: 'payroll.approved',
      source_id: data.payroll_run_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      accounting_entity_id: data.accounting_entity_id,
      entry_date: new Date(),
      description: `Nómina Aprobada - Run #${data.payroll_run_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * payroll.paid: Individual journal entries per employee (detail breakdown).
   * Creates one entry per payroll_item with full earnings/deductions/provisions/employer_costs detail.
   */
  async onPayrollPaid(data: {
    payroll_run_id: number;
    organization_id: number;
    store_id?: number;
    user_id?: number;
    payroll_items: Array<{
      payroll_item_id: number;
      employee_id: number;
      cost_center: string;
      earnings: {
        base_salary: number;
        transport_subsidy: number;
        total: number;
      } | null;
      deductions: {
        health: number;
        pension: number;
        retention: number;
        advance_deduction: number;
        total: number;
      } | null;
      employer_costs: {
        health: number;
        pension: number;
        arl: number;
        sena: number;
        icbf: number;
        compensation_fund: number;
        total: number;
      } | null;
      provisions: {
        severance: number;
        severance_interest: number;
        vacation: number;
        bonus: number;
        total: number;
      } | null;
      net_pay: number;
    }>;
  }): Promise<{ created: number; failed: number; errors: string[] }> {
    const result = { created: 0, failed: 0, errors: [] as string[] };

    for (const item of data.payroll_items) {
      try {
        const e = item.earnings ?? {
          base_salary: 0,
          transport_subsidy: 0,
          total: 0,
        };
        const d = item.deductions ?? {
          health: 0,
          pension: 0,
          retention: 0,
          advance_deduction: 0,
          total: 0,
        };
        const ec = item.employer_costs ?? {
          health: 0,
          pension: 0,
          arl: 0,
          sena: 0,
          icbf: 0,
          compensation_fund: 0,
          total: 0,
        };
        const p = item.provisions ?? {
          severance: 0,
          severance_interest: 0,
          vacation: 0,
          bonus: 0,
          total: 0,
        };
        const cost_center = item.cost_center || 'administrative';

        const lines: (AutoEntryLine | null)[] = [];

        // === DEBIT LINES: earnings ===
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            `payroll.approved.payroll_expense.${cost_center}`,
            'Sueldo básico',
            e.base_salary,
            0,
            data.store_id,
          ),
        );

        if (e.transport_subsidy > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.transport_subsidy',
              'Aux. transporte',
              e.transport_subsidy,
              0,
              data.store_id,
            ),
          );
        }

        // === DEBIT LINES: provisions (gasto) ===
        if (p.severance > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.provision_severance',
              'Gasto cesantías',
              p.severance,
              0,
              data.store_id,
            ),
          );
        }
        if (p.severance_interest > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.provision_severance_interest',
              'Gasto int. cesantías',
              p.severance_interest,
              0,
              data.store_id,
            ),
          );
        }
        if (p.vacation > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.provision_vacation',
              'Gasto vacaciones',
              p.vacation,
              0,
              data.store_id,
            ),
          );
        }
        if (p.bonus > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.provision_bonus',
              'Gasto prima',
              p.bonus,
              0,
              data.store_id,
            ),
          );
        }

        // === DEBIT LINES: aportes patronales (gasto) ===
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.health_employer',
            'EPS empleador',
            ec.health,
            0,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.pension_employer',
            'AFP empleador',
            ec.pension,
            0,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.arl_expense',
            'ARL',
            ec.arl,
            0,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.sena_expense',
            'SENA',
            ec.sena,
            0,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.icbf_expense',
            'ICBF',
            ec.icbf,
            0,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.compensation_fund_expense',
            'Caja compensación',
            ec.compensation_fund,
            0,
            data.store_id,
          ),
        );

        // === CREDIT LINES: deducciones empleado ===
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.health_payable',
            'EPS empleado',
            0,
            d.health,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.pension_payable',
            'AFP empleado',
            0,
            d.pension,
            data.store_id,
          ),
        );

        if (d.retention > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.withholdings',
              'Retención',
              0,
              d.retention,
              data.store_id,
            ),
          );
        }

        if (d.advance_deduction > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.advance_deduction',
              'Anticipo descuento',
              0,
              d.advance_deduction,
              data.store_id,
            ),
          );
        }

        // === CREDIT LINES: nómina por pagar ===
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.salaries_payable',
            'Nómina por pagar',
            0,
            item.net_pay,
            data.store_id,
          ),
        );

        // === CREDIT LINES: provisiones por pagar ===
        if (p.severance > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.liability_severance',
              'Cesantías por pagar',
              0,
              p.severance,
              data.store_id,
            ),
          );
        }
        if (p.severance_interest > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.liability_severance_interest',
              'Intereses cesantías por pagar',
              0,
              p.severance_interest,
              data.store_id,
            ),
          );
        }
        if (p.vacation > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.liability_vacation',
              'Vacaciones por pagar',
              0,
              p.vacation,
              data.store_id,
            ),
          );
        }
        if (p.bonus > 0) {
          lines.push(
            await this.resolveAccountLine(
              data.organization_id,
              'payroll.approved.liability_bonus',
              'Prima por pagar',
              0,
              p.bonus,
              data.store_id,
            ),
          );
        }

        // === CREDIT LINES: aportes patronales por pagar ===
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.health_employer_payable',
            'EPS empleador por pagar',
            0,
            ec.health,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.pension_employer_payable',
            'AFP empleador por pagar',
            0,
            ec.pension,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.arl_payable',
            'ARL por pagar',
            0,
            ec.arl,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.sena_payable',
            'SENA por pagar',
            0,
            ec.sena,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.icbf_payable',
            'ICBF por pagar',
            0,
            ec.icbf,
            data.store_id,
          ),
        );
        lines.push(
          await this.resolveAccountLine(
            data.organization_id,
            'payroll.approved.compensation_fund_payable',
            'Caja comp. por pagar',
            0,
            ec.compensation_fund,
            data.store_id,
          ),
        );

        await this.createAutoEntry({
          source_type: 'payroll_item',
          source_id: item.payroll_item_id,
          organization_id: data.organization_id,
          store_id: data.store_id,
          entry_date: new Date(),
          description: `Nómina Pago Empleado #${item.employee_id} - Run #${data.payroll_run_id}`,
          lines,
          user_id: data.user_id,
        });

        result.created++;
      } catch (err) {
        result.failed++;
        result.errors.push(`Employee #${item.employee_id}: ${err.message}`);
        this.logger.error(
          `Failed to create entry for employee #${item.employee_id}: ${err.message}`,
        );
      }
    }

    return result;
  }

  /**
   * order.completed: Debit COGS, Credit Inventory
   */
  async onOrderCompleted(data: {
    order_id: number;
    organization_id: number;
    store_id?: number;
    total_cost: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'order.completed.cogs',
        'Cost of Goods Sold',
        data.total_cost,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'order.completed.inventory',
        'Inventory',
        0,
        data.total_cost,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'order.completed',
      source_id: data.order_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Order completed #${data.order_id} - COGS`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * production.completed (Restaurant Suite Fase C)
   *
   * Sub-recipe batch production is a value transfer between inventory
   * buckets: raw ingredients leave the warehouse, the finished batch
   * enters it. The entry is balanced (DR 1435 finished goods =
   * CR 1435 ingredients) using the FIFO-weighted unit_cost returned by
   * the production service.
   *
   * Source uniqueness uses `(source_type='production.completed',
   * source_id=production_order_id)` so re-deliveries of the same event
   * never produce a second journal entry.
   */
  async onProductionCompleted(data: {
    production_order_id: number;
    organization_id: number;
    store_id?: number;
    product_name: string;
    produced_qty: number;
    produced_unit_cost: number;
    total_cost: number;
    user_id?: number;
  }) {
    const totalValue = Number(data.total_cost || 0);
    if (totalValue <= 0) {
      this.logger.log(
        `Skipping production.completed auto-entry for order #${data.production_order_id}: total_cost is 0`,
      );
      return null;
    }

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'production.completed.finished_goods',
        `Productos terminados – ${data.product_name} (${data.produced_qty})`,
        totalValue,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'production.completed.ingredient_consumed',
        `Insumos consumidos – ${data.product_name} (${data.produced_qty})`,
        0,
        totalValue,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'production.completed',
      source_id: data.production_order_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Producción completada #${data.production_order_id} – ${data.product_name}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * kitchen.fired (Restaurant Suite Fase D)
   *
   * Fire-to-kitchen event. Restaurant flow moves the COGS recognition
   * from "at sale/payment" to "at fire" — the moment the kitchen
   * receives the order. The journal entry mirrors `onOrderCompleted`
   * (DR 6135 / CR 1435) but is fired by `KitchenFireService` with the
   * REAL FIFO cost snapshot returned by the recipe explosion (i.e.
   * after merma + yield + sub-recipe resolution).
   *
   * The amount and currency belong to the per-kitchen-fire batch, not
   * the order, so we use the kitchen_ticket_id as `source_id`. Re-firing
   * the same item is impossible: `KitchenFireService` flips
   * `order_items.inventory_consumed_at_fire=true` and skips the item on
   * subsequent calls, so this listener will only ever be invoked once
   * per order_item.
   *
   * If `total_cost <= 0` (e.g. the product is a combo with no recipe),
   * the auto-entry is skipped and a debug line is logged — the fire
   * itself still succeeds.
   */
  async onKitchenFired(data: {
    kitchen_ticket_id: number;
    order_id: number;
    organization_id: number;
    store_id?: number;
    total_cost: number;
    consumed_line_count: number;
    user_id?: number;
  }) {
    const totalValue = Number(data.total_cost || 0);
    if (totalValue <= 0) {
      this.logger.log(
        `Skipping kitchen.fired auto-entry for ticket #${data.kitchen_ticket_id}: total_cost is 0 (no recipe or empty BOM)`,
      );
      return null;
    }

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'kitchen.fired.cogs',
        `COGS fire-to-kitchen (orden #${data.order_id}, ${data.consumed_line_count} líneas)`,
        totalValue,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'kitchen.fired.inventory',
        `Inventario consumido en cocina (orden #${data.order_id})`,
        0,
        totalValue,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'kitchen.fired',
      source_id: data.kitchen_ticket_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Fire-to-kitchen ticket #${data.kitchen_ticket_id} – orden #${data.order_id} (${data.consumed_line_count} líneas)`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * refund.completed: Debit Revenue + VAT (reversal), Credit Cash/Bank
   * For 'refund' type: reverse revenue + IVA, credit cash
   * For 'replacement' type: no accounting entry (only inventory movement)
   * For 'credit' type: reverse revenue + IVA, credit customer credit (future Phase 2)
   */
  async onRefundCompleted(data: {
    refund_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    tax_amount?: number;
    tax_breakdown?: TaxBreakdownItem[];
    return_type?: string;
    user_id?: number;
  }) {
    // Replacements only move inventory — no financial entry needed
    if (data.return_type === 'replacement') {
      this.logger.log(
        `Skipping accounting entry for replacement return #${data.refund_id}`,
      );
      return null;
    }

    const tax = Number(data.tax_amount || 0);
    const revenue_amount = tax > 0 ? data.amount - tax : data.amount;

    const lines: (AutoEntryLine | null)[] = [
      await this.resolveAccountLine(
        data.organization_id,
        'refund.completed.revenue',
        'Ingresos (reversa)',
        revenue_amount,
        0,
        data.store_id,
      ),
    ];

    // Reverse tax per fiscal type (debit side): IVA→2408, INC→2436, ICA→241205
    lines.push(
      ...(await this.resolveTaxLines({
        organization_id: data.organization_id,
        store_id: data.store_id,
        prefix: 'refund.completed',
        suffix: 'payable',
        side: 'debit',
        total: tax,
        breakdown: data.tax_breakdown,
        legacyKey: 'refund.completed.vat_payable',
        label: 'IVA (reversa devolución)',
      })),
    );

    // Credit: Cash/Bank for the total refund amount
    lines.push(
      await this.resolveAccountLine(
        data.organization_id,
        'refund.completed.cash',
        'Reembolso al cliente',
        0,
        data.amount,
        data.store_id,
      ),
    );

    return this.createAutoEntry({
      source_type: 'refund.completed',
      source_id: data.refund_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Devolución #${data.refund_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * purchase_order.received: Debit Inventory, Credit Accounts Payable
   */
  async onPurchaseOrderReceived(data: {
    purchase_order_id: number;
    organization_id: number;
    store_id?: number;
    total_amount: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'purchase_order.received.inventory',
        'Inventory',
        data.total_amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'purchase_order.received.accounts_payable',
        'Accounts Payable',
        0,
        data.total_amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'purchase_order.received',
      source_id: data.purchase_order_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Purchase order received #${data.purchase_order_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * purchase_order.payment: Debit Accounts Payable, Credit Cash/Bank
   */
  async onPurchaseOrderPayment(data: {
    purchase_order_id: number;
    organization_id: number;
    amount: number;
    payment_method: string;
    user_id?: number;
  }) {
    // Resolve cash/bank key based on payment method
    const method = (data.payment_method || '').toLowerCase();
    const is_cash = method.includes('cash') || method.includes('efectivo');
    const cash_bank_key = is_cash
      ? 'purchase_order.payment.cash_bank'
      : 'purchase_order.payment.cash_bank';

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'purchase_order.payment.accounts_payable',
        'Proveedores - Pago OC',
        data.amount,
        0,
      ),
      this.resolveAccountLine(
        data.organization_id,
        cash_bank_key,
        `Pago OC #${data.purchase_order_id}`,
        0,
        data.amount,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'purchase_order.payment',
      source_id: data.purchase_order_id,
      organization_id: data.organization_id,
      entry_date: new Date(),
      description: `Pago orden de compra #${data.purchase_order_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * inventory.adjusted: Debit/Credit Inventory vs Shrinkage based on quantity_change direction
   */
  async onInventoryAdjusted(data: {
    adjustment_id: number;
    organization_id: number;
    store_id?: number;
    cost_amount: number;
    quantity_change: number;
    user_id?: number;
  }) {
    let lines: (AutoEntryLine | null)[];

    if (data.quantity_change < 0) {
      // Shrinkage: DR Shrinkage, CR Inventory
      lines = await Promise.all([
        this.resolveAccountLine(
          data.organization_id,
          'inventory.adjusted.shrinkage',
          'Inventory Shrinkage',
          data.cost_amount,
          0,
          data.store_id,
        ),
        this.resolveAccountLine(
          data.organization_id,
          'inventory.adjusted.inventory',
          'Inventory',
          0,
          data.cost_amount,
          data.store_id,
        ),
      ]);
    } else {
      // Surplus: DR Inventory, CR Shrinkage
      lines = await Promise.all([
        this.resolveAccountLine(
          data.organization_id,
          'inventory.adjusted.inventory',
          'Inventory',
          data.cost_amount,
          0,
          data.store_id,
        ),
        this.resolveAccountLine(
          data.organization_id,
          'inventory.adjusted.shrinkage',
          'Inventory Surplus',
          0,
          data.cost_amount,
          data.store_id,
        ),
      ]);
    }

    return this.createAutoEntry({
      source_type: 'inventory.adjusted',
      source_id: data.adjustment_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Inventory adjustment #${data.adjustment_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== CREDIT INSTALLMENT PAYMENTS =====

  /**
   * installment_payment.received: DR Caja/Banco → CR Cuentas por Cobrar
   * Each installment payment reduces the customer's accounts receivable.
   */
  async onInstallmentPaymentReceived(data: {
    credit_id: number;
    installment_id: number;
    payment_id: number;
    amount: number;
    store_id: number;
    organization_id: number;
    store_payment_method_id?: number;
    credit_number: string;
    installment_number: number;
    customer_id: number;
    order_id: number;
    user_id?: number;
  }) {
    // Resolve payment method to determine cash vs bank
    let payment_method_name: string | undefined;
    if (data.store_payment_method_id) {
      const spm = await this.prisma.store_payment_methods.findUnique({
        where: { id: data.store_payment_method_id },
        include: { system_payment_method: { select: { name: true } } },
      });
      payment_method_name = spm?.system_payment_method?.name;
    }

    const cash_bank_key = this.resolveCashBankKey(payment_method_name);
    const cuota_ref = `Cuota #${data.installment_number} - Crédito ${data.credit_number}`;

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        cash_bank_key,
        `Abono ${cuota_ref}`,
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'installment_payment.received.accounts_receivable',
        `Recaudo CxC ${cuota_ref}`,
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'installment_payment',
      source_id: data.payment_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Abono cuota #${data.installment_number} - Crédito ${data.credit_number}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== LAYAWAY (PLAN SEPARÉ) =====

  /**
   * layaway.payment: DR Caja/Banco → CR Anticipos de Clientes (2805)
   * El pago entra como anticipo, NO como ingreso.
   */
  async onLayawayPaymentReceived(data: {
    payment_id: number;
    plan_number: string;
    organization_id: number;
    store_id?: number;
    amount: number;
    payment_method?: string;
    user_id?: number;
  }) {
    const is_cash =
      !data.payment_method ||
      data.payment_method.toLowerCase().includes('cash') ||
      data.payment_method.toLowerCase().includes('efectivo');
    const cash_bank_key = is_cash
      ? 'layaway.payment.cash'
      : 'layaway.payment.bank';

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        cash_bank_key,
        `Pago separé ${data.plan_number}`,
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'layaway.payment.customer_advance',
        `Anticipo separé ${data.plan_number}`,
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'layaway.payment',
      source_id: data.payment_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Pago de plan separé ${data.plan_number}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * layaway.completed: DR Anticipos de Clientes → CR Ingresos por Ventas
   * Al completar el pago total, los anticipos se reconocen como ingreso.
   */
  async onLayawayCompleted(data: {
    plan_id: number;
    plan_number: string;
    organization_id: number;
    store_id?: number;
    total_amount: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'layaway.completed.customer_advance',
        `Anticipo liquidado - separé ${data.plan_number}`,
        data.total_amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'layaway.completed.revenue',
        `Ingreso por venta - separé ${data.plan_number}`,
        0,
        data.total_amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'layaway.completed',
      source_id: data.plan_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Plan separé completado ${data.plan_number}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== FIXED ASSETS - DEPRECIATION =====

  /**
   * depreciation.posted: DR Gasto por Depreciación (5199) / CR Depreciación Acumulada (1592)
   */
  async onDepreciationPosted(data: {
    asset_id: number;
    asset_number: string;
    organization_id: number;
    store_id?: number;
    amount: number;
    period_date: Date;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'depreciation.monthly.depreciation_expense',
        `Gasto depreciación ${data.asset_number}`,
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'depreciation.monthly.accumulated_depreciation',
        `Depreciación acumulada ${data.asset_number}`,
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'depreciation.monthly',
      source_id: data.asset_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: data.period_date,
      description: `Depreciación mensual - ${data.asset_number}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * disposal.fixed_asset: Removes asset from books and recognizes gain/loss.
   *
   * DR Depreciación Acumulada (1592) — reversa accumulated
   * DR Caja (1105) — if disposal_amount > 0
   * DR Pérdida (5310) — if loss
   * CR Propiedad Planta y Equipo (1520) — original cost
   * CR Utilidad (4245) — if gain
   */
  async onFixedAssetDisposed(data: {
    asset_id: number;
    asset_number: string;
    organization_id: number;
    store_id?: number;
    acquisition_cost: number;
    accumulated_depreciation: number;
    disposal_amount: number;
    book_value: number;
    gain_loss: number;
    user_id?: number;
  }) {
    const lines: (AutoEntryLine | null)[] = [];

    // DR: Reverse accumulated depreciation
    if (data.accumulated_depreciation > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'disposal.fixed_asset.accumulated_depreciation',
          `Dep. acumulada baja ${data.asset_number}`,
          data.accumulated_depreciation,
          0,
          data.store_id,
        ),
      );
    }

    // DR: Cash received from disposal
    if (data.disposal_amount > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'disposal.fixed_asset.cash',
          `Venta activo ${data.asset_number}`,
          data.disposal_amount,
          0,
          data.store_id,
        ),
      );
    }

    // DR: Loss on disposal (if gain_loss < 0)
    if (data.gain_loss < 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'disposal.fixed_asset.loss',
          `Pérdida baja ${data.asset_number}`,
          Math.abs(data.gain_loss),
          0,
          data.store_id,
        ),
      );
    }

    // CR: Remove asset cost
    lines.push(
      await this.resolveAccountLine(
        data.organization_id,
        'disposal.fixed_asset.asset_cost',
        `Baja activo ${data.asset_number}`,
        0,
        data.acquisition_cost,
        data.store_id,
      ),
    );

    // CR: Gain on disposal (if gain_loss > 0)
    if (data.gain_loss > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'disposal.fixed_asset.gain',
          `Utilidad venta ${data.asset_number}`,
          0,
          data.gain_loss,
          data.store_id,
        ),
      );
    }

    return this.createAutoEntry({
      source_type: 'disposal.fixed_asset',
      source_id: data.asset_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Baja de activo fijo ${data.asset_number}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * withholding.applied: Debit Expense (base), Credit Withholding Payable + Accounts Payable (net)
   * Retención en la Fuente applied to a purchase/invoice
   */
  async onWithholdingApplied(data: {
    organization_id: number;
    store_id?: number;
    invoice_id: number;
    base_amount: number;
    withholding_amount: number;
    net_amount: number;
    concept_name: string;
    supplier_name: string;
    withholding_breakdown?: WithholdingLine[];
    user_id?: number;
  }) {
    const has_breakdown =
      !!data.withholding_breakdown && data.withholding_breakdown.length > 0;
    const breakdown_total = has_breakdown
      ? data.withholding_breakdown!.reduce(
          (sum, l) => sum + Number(l.amount || 0),
          0,
        )
      : 0;
    // When a typed breakdown is present, the withheld total is the sum of its
    // lines and the supplier net is derived from base - sum (so the entry stays
    // balanced regardless of the scalar net_amount passed in).
    const withheld = has_breakdown
      ? breakdown_total
      : Number(data.withholding_amount || 0);
    const net_amount = has_breakdown
      ? Math.max(0, Number(data.base_amount || 0) - withheld)
      : data.net_amount;

    const lines: (AutoEntryLine | null)[] = [
      // DR: Expense / Purchase (base amount)
      await this.resolveAccountLine(
        data.organization_id,
        'withholding.applied.expense',
        `Compra/Gasto - ${data.supplier_name}`,
        data.base_amount,
        0,
        data.store_id,
      ),
    ];

    if (has_breakdown) {
      // CR: per-type withholding payable (practiced → liability credit).
      lines.push(
        ...(await this.resolveWithholdingLines({
          organization_id: data.organization_id,
          store_id: data.store_id,
          breakdown: data.withholding_breakdown,
          side: 'credit',
        })),
      );
    } else {
      // Legacy scalar path: single 2365 credit.
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'withholding.applied.withholding_payable',
          `Retención ${data.concept_name} - ${data.supplier_name}`,
          0,
          withheld,
          data.store_id,
        ),
      );
    }

    // CR: Accounts Payable (net amount after retention)
    lines.push(
      await this.resolveAccountLine(
        data.organization_id,
        'withholding.applied.accounts_payable',
        `Proveedor neto ${data.supplier_name}`,
        0,
        net_amount,
        data.store_id,
      ),
    );

    return this.createAutoEntry({
      source_type: 'withholding.applied',
      source_id: data.invoice_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Retención ${data.concept_name} - ${data.supplier_name}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * settlement.paid: Debit Provisions (Cesantías, Intereses, Prima, Vacaciones, Salario Pendiente, Indemnización)
   * Credit Health Payable, Pension Payable, Bank (net settlement)
   *
   * PUC colombiano:
   * DB 2610 Cesantías por Pagar
   * DB 2615 Intereses sobre Cesantías
   * DB 2620 Prima de Servicios por Pagar
   * DB 2625 Vacaciones por Pagar
   * DB 5105 Gastos de Personal (salario pendiente + indemnización)
   * CR 2370 Retenciones y Aportes de Nómina (salud + pensión)
   * CR 1110 Bancos (neto)
   */
  async onSettlementPaid(data: {
    settlement_id: number;
    settlement_number: string;
    organization_id: number;
    store_id?: number;
    employee_name: string;
    severance: number;
    severance_interest: number;
    bonus: number;
    vacation: number;
    pending_salary: number;
    indemnification: number;
    health_deduction: number;
    pension_deduction: number;
    net_settlement: number;
    user_id?: number;
  }) {
    const lines: (AutoEntryLine | null)[] = [];
    const desc = (concept: string) =>
      `${concept} - ${data.employee_name} (${data.settlement_number})`;

    // DEBIT lines (provisions and expenses)
    if (data.severance > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.severance',
          desc('Cesantías'),
          data.severance,
          0,
          data.store_id,
        ),
      );
    }
    if (data.severance_interest > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.severance_interest',
          desc('Intereses Cesantías'),
          data.severance_interest,
          0,
          data.store_id,
        ),
      );
    }
    if (data.bonus > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.bonus',
          desc('Prima Proporcional'),
          data.bonus,
          0,
          data.store_id,
        ),
      );
    }
    if (data.vacation > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.vacation',
          desc('Vacaciones Proporcionales'),
          data.vacation,
          0,
          data.store_id,
        ),
      );
    }
    if (data.pending_salary > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.pending_salary',
          desc('Salario Pendiente'),
          data.pending_salary,
          0,
          data.store_id,
        ),
      );
    }
    if (data.indemnification > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.indemnification',
          desc('Indemnización'),
          data.indemnification,
          0,
          data.store_id,
        ),
      );
    }

    // CREDIT lines (deductions + bank)
    const total_social_deductions =
      data.health_deduction + data.pension_deduction;
    if (total_social_deductions > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.social_deductions',
          desc('Retenciones Salud y Pensión'),
          0,
          total_social_deductions,
          data.store_id,
        ),
      );
    }
    if (data.net_settlement > 0) {
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'settlement.paid.bank',
          desc('Pago Liquidación'),
          0,
          data.net_settlement,
          data.store_id,
        ),
      );
    }

    return this.createAutoEntry({
      source_type: 'settlement.paid',
      source_id: data.settlement_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Liquidación pagada ${data.settlement_number} - ${data.employee_name}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== CASH REGISTER =====

  /**
   * cash_register.opened: DR Caja → CR Banco/Fondo Base
   * Opening a cash register session with initial cash.
   */
  async onCashRegisterOpened(data: {
    session_id: number;
    organization_id: number;
    store_id: number;
    opening_amount: number;
    user_id: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'cash_register.opened.cash',
        'Caja (apertura)',
        data.opening_amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'cash_register.opened.cash_base',
        'Fondo base (apertura)',
        0,
        data.opening_amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'cash_register_opened',
      source_id: data.session_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Apertura caja registradora - Sesión #${data.session_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * cash_register.closed: DR Banco → CR Caja + Sobrante/Faltante
   * Closing a cash register session, recording any surplus or shortage.
   */
  async onCashRegisterClosed(data: {
    session_id: number;
    organization_id: number;
    store_id: number;
    expected_amount: number;
    actual_amount: number;
    difference: number;
    user_id: number;
  }) {
    const lines: any[] = [];

    // DR Banco (consignación del cierre)
    lines.push(
      await this.resolveAccountLine(
        data.organization_id,
        'cash_register.closed.bank',
        'Banco (cierre caja)',
        data.actual_amount,
        0,
        data.store_id,
      ),
    );

    // CR Caja (sale dinero de caja)
    lines.push(
      await this.resolveAccountLine(
        data.organization_id,
        'cash_register.closed.cash',
        'Caja (cierre)',
        0,
        data.expected_amount,
        data.store_id,
      ),
    );

    // Difference handling: positive = surplus (sobrante), negative = shortage (faltante)
    if (data.difference > 0.01) {
      // Surplus: CR Otros Ingresos
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'cash_register.closed.surplus',
          'Sobrante de caja',
          0,
          data.difference,
          data.store_id,
        ),
      );
    } else if (data.difference < -0.01) {
      // Shortage: DR Faltantes
      lines.push(
        await this.resolveAccountLine(
          data.organization_id,
          'cash_register.closed.shortage',
          'Faltante de caja',
          Math.abs(data.difference),
          0,
          data.store_id,
        ),
      );
    }

    return this.createAutoEntry({
      source_type: 'cash_register_closed',
      source_id: data.session_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Cierre caja registradora - Sesión #${data.session_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * cash_register.movement: Manual cash in/out
   * cash_in: DR Caja → CR Otro (fuente)
   * cash_out: DR Otro (destino) → CR Caja
   */
  async onCashRegisterMovement(data: {
    movement_id: number;
    organization_id: number;
    store_id: number;
    type: 'cash_in' | 'cash_out';
    amount: number;
    reference?: string;
    user_id: number;
  }) {
    const is_cash_in = data.type === 'cash_in';
    const desc = is_cash_in ? 'Ingreso manual a caja' : 'Retiro manual de caja';

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'cash_register.movement.cash',
        `Caja (${desc.toLowerCase()})`,
        is_cash_in ? data.amount : 0,
        is_cash_in ? 0 : data.amount,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'cash_register.movement.other',
        `${desc}${data.reference ? ` - ${data.reference}` : ''}`,
        is_cash_in ? 0 : data.amount,
        is_cash_in ? data.amount : 0,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'cash_register_movement',
      source_id: data.movement_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `${desc} #${data.movement_id}${data.reference ? ` - ${data.reference}` : ''}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== ACCOUNTS RECEIVABLE =====

  /**
   * ar.written_off: DR Deudas Incobrables → CR Cuentas por Cobrar
   * Write-off of uncollectable accounts receivable.
   */
  async onArWrittenOff(data: {
    ar_id: number;
    organization_id: number;
    store_id: number;
    amount: number;
    document_number?: string;
    user_id: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'ar.write_off.bad_debt',
        'Deudas Incobrables',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'ar.write_off.accounts_receivable',
        'Cuentas por Cobrar (castigo)',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'ar_write_off',
      source_id: data.ar_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Castigo CxC${data.document_number ? ` - Doc ${data.document_number}` : ''} #${data.ar_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== ACCOUNTS PAYABLE =====

  /**
   * ap.payment_registered: DR Cuentas por Pagar → CR Caja/Banco
   * Payment of an accounts payable record.
   */
  async onApPaymentRegistered(data: {
    ap_id: number;
    organization_id: number;
    store_id: number;
    amount: number;
    payment_method?: string;
    document_number?: string;
    user_id: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'ap.payment.accounts_payable',
        'Cuentas por Pagar (pago)',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'ap.payment.cash_bank',
        'Banco (pago CxP)',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'ap_payment',
      source_id: data.ap_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Pago CxP${data.document_number ? ` - Doc ${data.document_number}` : ''} #${data.ap_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * ap.written_off: DR Cuentas por Pagar → CR Otros Ingresos
   * Write-off of an accounts payable (supplier forgave the debt).
   */
  async onApWrittenOff(data: {
    ap_id: number;
    organization_id: number;
    store_id: number;
    amount: number;
    document_number?: string;
    user_id: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'ap.write_off.accounts_payable',
        'Cuentas por Pagar (castigo)',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'ap.write_off.other_income',
        'Otros Ingresos (castigo CxP)',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'ap_write_off',
      source_id: data.ap_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Castigo CxP${data.document_number ? ` - Doc ${data.document_number}` : ''} #${data.ap_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== COMMISSIONS =====

  /**
   * commission.calculated: DR Gasto por Comisiones → CR Comisiones por Pagar
   * When a commission is calculated for a salesperson.
   */
  async onCommissionCalculated(data: {
    payment_id: number;
    organization_id: number;
    store_id: number;
    commission_amount: number;
    rule_id: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'commission.calculated.expense',
        'Gasto por Comisiones',
        data.commission_amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'commission.calculated.payable',
        'Comisiones por Pagar',
        0,
        data.commission_amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'commission',
      source_id: data.payment_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Comisión calculada - Pago #${data.payment_id} (Regla #${data.rule_id})`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== WALLET =====

  async onWalletCredited(data: {
    wallet_id: number;
    organization_id: number;
    store_id: number;
    amount: number;
    reference_type: string;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'wallet.topup.cash_bank',
        'Caja/Banco (recarga wallet)',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'wallet.topup.customer_advance',
        'Anticipos de Clientes (wallet)',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'wallet.credited',
      source_id: data.wallet_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Recarga wallet #${data.wallet_id} - ${data.reference_type}`,
      lines,
      user_id: data.user_id,
    });
  }

  async onWalletDebited(data: {
    wallet_id: number;
    organization_id: number;
    store_id: number;
    amount: number;
    reference_type: string;
    order_id?: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'wallet.debit.customer_advance',
        'Anticipos de Clientes (uso wallet)',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'wallet.debit.revenue',
        'Ingresos (pago con wallet)',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'wallet.debited',
      source_id: data.wallet_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Pago con wallet #${data.wallet_id}${data.order_id ? ` - Orden #${data.order_id}` : ''}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== STOCK TRANSFERS =====

  /**
   * stock_transfer.completed: DR Inventario Destino → CR Inventario Origen
   * Inter-location stock transfer at cost.
   */
  async onStockTransferCompleted(data: {
    transfer_id: number;
    transfer_number: string;
    organization_id: number;
    store_id?: number;
    from_store_id?: number;
    to_store_id?: number;
    from_location_id: number;
    to_location_id: number;
    total_cost: number;
    user_id?: number;
  }) {
    if (data.total_cost <= 0) return; // Skip zero-cost transfers

    const isIntercompany =
      await this.fiscal_scope_service.isIntercompanyTransfer({
        organization_id: data.organization_id,
        from_store_id: data.from_store_id,
        to_store_id: data.to_store_id,
      });
    if (isIntercompany) {
      return this.onIntercompanyStockTransferCompleted(data);
    }

    const fiscalScope = await this.fiscal_scope_service.getFiscalScope(
      data.organization_id,
    );
    this.logger.debug(
      `Stock transfer #${data.transfer_id} is not intercompany (fiscal_scope=${fiscalScope}, from_store=${data.from_store_id ?? 'n/a'}, to_store=${data.to_store_id ?? 'n/a'})`,
    );

    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'stock_transfer.completed.inventory_destination',
        `Inventario destino (transferencia ${data.transfer_number})`,
        data.total_cost,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'stock_transfer.completed.inventory_origin',
        `Inventario origen (transferencia ${data.transfer_number})`,
        0,
        data.total_cost,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'stock_transfer',
      source_id: data.transfer_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Transferencia de inventario ${data.transfer_number}`,
      lines,
      user_id: data.user_id,
    });
  }

  private async onIntercompanyStockTransferCompleted(data: {
    transfer_id: number;
    transfer_number: string;
    organization_id: number;
    from_store_id?: number;
    to_store_id?: number;
    total_cost: number;
    user_id?: number;
  }) {
    if (!data.from_store_id || !data.to_store_id) {
      throw new Error(
        'Intercompany transfer requires source and destination store ids',
      );
    }

    const shipped_lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'intercompany_transfer.shipped.receivable',
        `Cuenta por cobrar intercompany (${data.transfer_number})`,
        data.total_cost,
        0,
        data.from_store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'intercompany_transfer.shipped.inventory',
        `Inventario transferido (${data.transfer_number})`,
        0,
        data.total_cost,
        data.from_store_id,
      ),
    ]);

    const received_lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'intercompany_transfer.received.inventory',
        `Inventario recibido (${data.transfer_number})`,
        data.total_cost,
        0,
        data.to_store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'intercompany_transfer.received.payable',
        `Cuenta por pagar intercompany (${data.transfer_number})`,
        0,
        data.total_cost,
        data.to_store_id,
      ),
    ]);

    const shipped_entry = await this.createAutoEntry({
      source_type: 'intercompany_transfer.shipped',
      source_id: data.transfer_id,
      organization_id: data.organization_id,
      store_id: data.from_store_id,
      entry_date: new Date(),
      description: `Transferencia intercompany enviada ${data.transfer_number}`,
      lines: shipped_lines,
      user_id: data.user_id,
    });

    const received_entry = await this.createAutoEntry({
      source_type: 'intercompany_transfer.received',
      source_id: data.transfer_id,
      organization_id: data.organization_id,
      store_id: data.to_store_id,
      entry_date: new Date(),
      description: `Transferencia intercompany recibida ${data.transfer_number}`,
      lines: received_lines,
      user_id: data.user_id,
    });

    if (!shipped_entry || !received_entry) return null;

    const receivableMapping = await this.account_mapping_service.getMapping(
      data.organization_id,
      'intercompany_transfer.shipped.receivable',
      data.from_store_id,
    );
    if (!receivableMapping) {
      throw new Error('Missing intercompany receivable mapping');
    }

    const receivableAccount = await this.prisma
      .withoutScope()
      .chart_of_accounts.findFirst({
        where: {
          organization_id: data.organization_id,
          code: receivableMapping.account_code,
          OR: [
            { accounting_entity_id: shipped_entry.accounting_entity_id },
            { accounting_entity_id: null },
          ],
        },
        orderBy: { accounting_entity_id: 'desc' },
      });
    if (!receivableAccount) {
      throw new Error(
        `Intercompany account ${receivableMapping.account_code} not found`,
      );
    }

    const intercompany_transaction = await this.prisma
      .withoutScope()
      .intercompany_transactions.create({
        data: {
          organization_id: data.organization_id,
          origin: 'stock_transfer',
          source_type: 'stock_transfer',
          source_id: data.transfer_id,
          status: 'open',
          from_store_id: data.from_store_id,
          to_store_id: data.to_store_id,
          entry_id: shipped_entry.id,
          counterpart_entry_id: received_entry.id,
          account_id: receivableAccount.id,
          amount: new Prisma.Decimal(data.total_cost),
        },
      });

    return {
      shipped_entry,
      received_entry,
      intercompany_transaction,
    };
  }

  async onExpenseRefunded(data: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    const reversalPaymentLines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'expense.refunded.cash',
        'Caja/Banco (Reembolso)',
        0,
        data.amount,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'expense.refunded.accounts_payable',
        'Proveedores (Reversión pago)',
        data.amount,
        0,
        data.store_id,
      ),
    ]);

    await this.createAutoEntry({
      source_type: 'expense.refunded',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Reversión pago gasto #${data.expense_id}`,
      lines: reversalPaymentLines,
      user_id: data.user_id,
    });

    const reversalApprovalLines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'expense.refunded.accounts_payable',
        'Proveedores (Reversión aprobación)',
        0,
        data.amount,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'expense.refunded.expense',
        'Gastos Diversos (Reversión)',
        data.amount,
        0,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'expense.refunded',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Reversión aprobación gasto #${data.expense_id}`,
      lines: reversalApprovalLines,
      user_id: data.user_id,
    });
  }

  async onExpenseCancelled(data: {
    expense_id: number;
    organization_id: number;
    store_id?: number;
    amount: number;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'expense.cancelled.accounts_payable',
        'Proveedores (Cancelación)',
        data.amount,
        0,
        data.store_id,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'expense.cancelled.expense',
        'Gastos Diversos (Cancelación)',
        0,
        data.amount,
        data.store_id,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'expense.cancelled',
      source_id: data.expense_id,
      organization_id: data.organization_id,
      store_id: data.store_id,
      entry_date: new Date(),
      description: `Cancelación gasto #${data.expense_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  // ===== SAAS PLATFORM AUTO-ENTRIES (RNC-MF-3) =====
  // These three handlers are dispatched by AccountingEventsListener for events
  // emitted against the Vendix platform organization (VENDIX_ADMIN). They are
  // intentionally decoupled from `PlatformOrgService` — the listener resolves
  // the platform context and passes the resolved `organization_id` as
  // `data.organization_id`. `entry_date` is sourced from the event payload so
  // back-fills post the entry in the original fiscal period.

  /**
   * saas_refund: Vendix refunds a tenant — reverses SaaS revenue.
   *   DR 4175 Devoluciones en Ventas (SaaS)
   *   CR 1110 Bancos (reembolso)
   */
  async onSaasRefund(data: {
    refund_event_id: number;
    organization_id: number;
    amount: number;
    entry_date: Date;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'saas_refund.revenue',
        'Devoluciones en Ventas (SaaS refund)',
        data.amount,
        0,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'saas_refund.cash_bank',
        'Bancos (reembolso SaaS)',
        0,
        data.amount,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'saas_refund',
      source_id: data.refund_event_id,
      organization_id: data.organization_id,
      entry_date: data.entry_date,
      description: `Reembolso SaaS #${data.refund_event_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * saas_bad_debt: Wompi declines a SaaS charge — provisions bad debt.
   *   DR 5295 Gasto Incobrable SaaS
   *   CR 1305 CxC SaaS (provisión)
   */
  async onSaasPaymentFailed(data: {
    payment_id: number;
    organization_id: number;
    amount: number;
    entry_date: Date;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'saas_bad_debt.expense',
        'Gasto Incobrable SaaS',
        data.amount,
        0,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'saas_bad_debt.receivable',
        'CxC SaaS (provisión incobrable)',
        0,
        data.amount,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'saas_bad_debt',
      source_id: data.payment_id,
      organization_id: data.organization_id,
      entry_date: data.entry_date,
      description: `Provisión incobrable SaaS — Pago #${data.payment_id}`,
      lines,
      user_id: data.user_id,
    });
  }

  /**
   * saas_partner_payout: Vendix pays a partner commission batch — settles payable.
   *   DR 2335 CxP Comisiones Partners
   *   CR 1110 Bancos (pago)
   */
  async onPartnerPayoutPaid(data: {
    batch_id: number;
    organization_id: number;
    amount: number;
    entry_date: Date;
    user_id?: number;
  }) {
    const lines = await Promise.all([
      this.resolveAccountLine(
        data.organization_id,
        'saas_partner_payout.commissions_payable',
        `CxP Comisiones Partners — Batch #${data.batch_id}`,
        data.amount,
        0,
      ),
      this.resolveAccountLine(
        data.organization_id,
        'saas_partner_payout.cash_bank',
        `Bancos (pago comisiones batch #${data.batch_id})`,
        0,
        data.amount,
      ),
    ]);

    return this.createAutoEntry({
      source_type: 'saas_partner_payout',
      source_id: data.batch_id,
      organization_id: data.organization_id,
      entry_date: data.entry_date,
      description: `Pago comisiones partner — Batch #${data.batch_id}`,
      lines,
      user_id: data.user_id,
    });
  }
}

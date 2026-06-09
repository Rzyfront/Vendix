import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  tax_declaration_status_enum,
  tax_declaration_type_enum,
  withholding_type_enum,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import {
  buildDateRangeFilter,
  resolveFiscalPeriodRange,
} from './fiscal-period.util';
import {
  CreateTaxDeclarationDraftDto,
  FiscalListQueryDto,
  MarkFiscalSubmittedDto,
} from '../dto/fiscal-operations.dto';
import { FiscalAuditService } from './fiscal-audit.service';

interface DeclarationCalculation {
  totals: Record<string, number>;
  lines: Prisma.tax_declaration_linesCreateManyInput[];
  rules_snapshot: Prisma.InputJsonObject;
  source_snapshot: Prisma.InputJsonObject;
  validation_summary: Prisma.InputJsonObject;
}

const LOCKED_DECLARATION_STATUSES: tax_declaration_status_enum[] = [
  'approved',
  'submitted',
  'accepted',
  'paid',
];

const TERMINAL_DECLARATION_STATUSES: tax_declaration_status_enum[] = [
  'accepted',
  'paid',
  'voided',
];

const DECLARATION_STATUS_TRANSITIONS: Record<
  tax_declaration_status_enum,
  tax_declaration_status_enum[]
> = {
  draft: ['calculating', 'ready', 'needs_review', 'voided'],
  calculating: ['ready', 'needs_review', 'voided'],
  ready: ['needs_review', 'approved', 'voided'],
  needs_review: ['ready', 'approved', 'voided'],
  approved: ['submitted', 'voided'],
  submitted: ['accepted', 'rejected', 'paid'],
  rejected: ['ready', 'submitted', 'voided'],
  accepted: ['paid'],
  paid: [],
  voided: [],
};

@Injectable()
export class TaxDeclarationDraftService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly audit: FiscalAuditService,
  ) {}

  async list(contexts: FiscalOperationsContext[], query: FiscalListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: Prisma.tax_declaration_draftsWhereInput = {
      ...this.whereForContexts(contexts),
      ...(query.period_year ? { period_year: query.period_year } : {}),
      ...(query.period_month ? { period_month: query.period_month } : {}),
      ...(query.store_id ? { store_id: query.store_id } : {}),
      ...(query.accounting_entity_id
        ? { accounting_entity_id: query.accounting_entity_id }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.tax_declaration_drafts.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ period_end: 'desc' }, { id: 'desc' }],
        include: {
          accounting_entity: true,
          store: true,
          obligation: true,
          evidence: true,
        },
      }),
      this.prisma.tax_declaration_drafts.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(contexts: FiscalOperationsContext[], id: number) {
    const draft = await this.prisma.tax_declaration_drafts.findFirst({
      where: { ...this.whereForContexts(contexts), id },
      include: {
        accounting_entity: true,
        store: true,
        obligation: true,
        evidence: true,
        lines: { orderBy: { id: 'asc' }, take: 100 },
      },
    });

    if (!draft) throw new NotFoundException('Tax declaration draft not found');
    return draft;
  }

  async getLines(contexts: FiscalOperationsContext[], id: number) {
    await this.findOne(contexts, id);
    return this.prisma.tax_declaration_lines.findMany({
      where: { declaration_id: id },
      orderBy: { id: 'asc' },
    });
  }

  async createDraft(
    context: FiscalOperationsContext,
    dto: CreateTaxDeclarationDraftDto,
  ) {
    const period = resolveFiscalPeriodRange(dto);
    const calculation = await this.calculate(
      context,
      dto.declaration_type,
      period,
    );
    const existing = await this.prisma.tax_declaration_drafts.findFirst({
      where: {
        accounting_entity_id: context.accounting_entity_id,
        declaration_type: dto.declaration_type,
        period_year: period.period_year,
        period_month: period.period_month,
        period_quarter: period.period_quarter,
        status: { notIn: LOCKED_DECLARATION_STATUSES },
      },
      orderBy: { id: 'desc' },
    });

    const draft = await this.prisma.$transaction(async (tx) => {
      const data = this.buildDraftData(context, dto, period, calculation);
      const draft = existing
        ? await tx.tax_declaration_drafts.update({
            where: { id: existing.id },
            data: { ...data, status: 'ready' },
          })
        : await tx.tax_declaration_drafts.create({
            data: { ...data, status: 'ready' },
          });

      await tx.tax_declaration_lines.deleteMany({
        where: { declaration_id: draft.id },
      });

      if (calculation.lines.length > 0) {
        await tx.tax_declaration_lines.createMany({
          data: calculation.lines.map((line) => ({
            ...line,
            declaration_id: draft.id,
          })),
        });
      }

      return tx.tax_declaration_drafts.findUnique({
        where: { id: draft.id },
        include: { lines: true, obligation: true, evidence: true },
      });
    });

    if (draft) {
      await this.audit.logForResource(draft, {
        event_type: existing
          ? 'fiscal.declaration.refreshed'
          : 'fiscal.declaration.generated',
        resource_type: 'tax_declaration_draft',
        declaration_id: draft.id,
        obligation_id: draft.obligation_id,
        previous_status: existing?.status,
        new_status: draft.status,
        metadata: {
          declaration_type: dto.declaration_type,
          period_year: period.period_year,
          period_month: period.period_month,
          period_quarter: period.period_quarter,
          line_count: calculation.lines.length,
          total_payable: Number(draft.total_payable || 0),
        },
      });
    }

    return draft;
  }

  async recalculateDraft(contexts: FiscalOperationsContext[], id: number) {
    const draft = await this.findOne(contexts, id);
    if (LOCKED_DECLARATION_STATUSES.includes(draft.status)) {
      throw new BadRequestException(
        'Approved/submitted declarations cannot be recalculated in place',
      );
    }

    const context = contexts.find(
      (item) => item.accounting_entity_id === draft.accounting_entity_id,
    );
    if (!context) throw new NotFoundException('Fiscal context not found');

    const recalculated = await this.createDraft(context, {
      declaration_type: draft.declaration_type,
      period_year: draft.period_year,
      period_month: draft.period_month ?? undefined,
      period_quarter: draft.period_quarter ?? undefined,
      obligation_id: draft.obligation_id ?? undefined,
      store_id: draft.store_id ?? undefined,
    });
    if (recalculated) {
      await this.audit.logForResource(recalculated, {
        event_type: 'fiscal.declaration.recalculated',
        resource_type: 'tax_declaration_draft',
        declaration_id: recalculated.id,
        obligation_id: recalculated.obligation_id,
        previous_status: draft.status,
        new_status: recalculated.status,
      });
    }
    return recalculated;
  }

  async approveDraft(contexts: FiscalOperationsContext[], id: number) {
    const draft = await this.findOne(contexts, id);
    if (draft.status === 'approved') return draft;
    this.assertStatusTransition(draft.status, 'approved');
    if (draft.status !== 'ready' && draft.status !== 'needs_review') {
      throw new BadRequestException('Only ready drafts can be approved');
    }

    const approved = await this.prisma.tax_declaration_drafts.update({
      where: { id },
      data: {
        status: 'approved',
        approved_at: new Date(),
        approved_by_user_id: RequestContextService.getUserId(),
      },
    });
    await this.audit.logForResource(approved, {
      event_type: 'fiscal.declaration.approved',
      resource_type: 'tax_declaration_draft',
      declaration_id: approved.id,
      obligation_id: approved.obligation_id,
      previous_status: draft.status,
      new_status: approved.status,
    });
    return approved;
  }

  async voidDraft(
    contexts: FiscalOperationsContext[],
    id: number,
    reason?: string,
  ) {
    const draft = await this.findOne(contexts, id);
    this.assertStatusTransition(draft.status, 'voided');
    if (draft.status === 'accepted' || draft.status === 'paid') {
      throw new BadRequestException(
        'Accepted or paid declarations cannot be voided',
      );
    }

    const voided = await this.prisma.tax_declaration_drafts.update({
      where: { id: draft.id },
      data: {
        status: 'voided',
        notes: reason ?? draft.notes,
      },
    });
    await this.audit.logForResource(voided, {
      event_type: 'fiscal.declaration.voided',
      resource_type: 'tax_declaration_draft',
      declaration_id: voided.id,
      obligation_id: voided.obligation_id,
      previous_status: draft.status,
      new_status: voided.status,
      metadata: { reason },
    });
    return voided;
  }

  async markSubmitted(
    contexts: FiscalOperationsContext[],
    id: number,
    dto: MarkFiscalSubmittedDto,
  ) {
    const draft = await this.findOne(contexts, id);
    this.assertStatusTransition(draft.status, 'submitted');
    await this.assertEvidenceForDeclaration(
      draft,
      dto.evidence_id,
      'submitted',
    );
    const submitted = await this.prisma.tax_declaration_drafts.update({
      where: { id },
      data: {
        status: 'submitted',
        submitted_at: new Date(dto.submitted_at),
        notes: dto.notes,
        evidence_id: dto.evidence_id,
      },
    });
    await this.audit.logForResource(submitted, {
      event_type: 'fiscal.declaration.submitted',
      resource_type: 'tax_declaration_draft',
      declaration_id: submitted.id,
      obligation_id: submitted.obligation_id,
      evidence_id: submitted.evidence_id,
      previous_status: draft.status,
      new_status: submitted.status,
      metadata: {
        submitted_at: dto.submitted_at,
        external_reference: dto.external_reference,
        notes: dto.notes,
      },
    });
    return submitted;
  }

  async markAccepted(contexts: FiscalOperationsContext[], id: number) {
    const draft = await this.findOne(contexts, id);
    this.assertStatusTransition(draft.status, 'accepted');
    await this.assertEvidenceForDeclaration(draft, undefined, 'accepted');
    const accepted = await this.prisma.tax_declaration_drafts.update({
      where: { id },
      data: { status: 'accepted', accepted_at: new Date() },
    });
    await this.audit.logForResource(accepted, {
      event_type: 'fiscal.declaration.accepted',
      resource_type: 'tax_declaration_draft',
      declaration_id: accepted.id,
      obligation_id: accepted.obligation_id,
      previous_status: draft.status,
      new_status: accepted.status,
    });
    return accepted;
  }

  private buildDraftData(
    context: FiscalOperationsContext,
    dto: CreateTaxDeclarationDraftDto,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
    calculation: DeclarationCalculation,
  ): Prisma.tax_declaration_draftsUncheckedCreateInput {
    return {
      organization_id: context.organization_id,
      store_id: context.store_id,
      accounting_entity_id: context.accounting_entity_id,
      obligation_id: dto.obligation_id,
      declaration_type: dto.declaration_type,
      period_year: period.period_year,
      period_month: period.period_month,
      period_quarter: period.period_quarter,
      period_start: period.period_start,
      period_end: period.period_end,
      currency: 'COP',
      gross_base_amount: calculation.totals.gross_base_amount ?? 0,
      taxable_base_amount: calculation.totals.taxable_base_amount ?? 0,
      exempt_amount: calculation.totals.exempt_amount ?? 0,
      excluded_amount: calculation.totals.excluded_amount ?? 0,
      generated_tax_amount: calculation.totals.generated_tax_amount ?? 0,
      deductible_tax_amount: calculation.totals.deductible_tax_amount ?? 0,
      withholding_amount: calculation.totals.withholding_amount ?? 0,
      balance_due: calculation.totals.balance_due ?? 0,
      balance_favor: calculation.totals.balance_favor ?? 0,
      penalties_amount: 0,
      interest_amount: 0,
      total_payable: calculation.totals.total_payable ?? 0,
      rules_snapshot: calculation.rules_snapshot,
      source_snapshot: calculation.source_snapshot,
      validation_summary: calculation.validation_summary,
      created_by_user_id: RequestContextService.getUserId(),
    };
  }

  private async calculate(
    context: FiscalOperationsContext,
    type: tax_declaration_type_enum,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    if (type === 'vat') return this.calculateVat(context, period);
    if (type === 'inc') return this.calculateInc(context, period);
    if (type === 'withholding' || type === 'reteiva' || type === 'reteica') {
      return this.calculateWithholding(context, type, period);
    }
    if (type === 'ica') return this.calculateIca(context, period);
    if (type === 'exogenous') return this.calculateExogenous(context, period);
    return this.calculateIncomePreclose(context, period);
  }

  private async calculateVat(
    context: FiscalOperationsContext,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    const invoices = await this.prisma.invoices.findMany({
      where: {
        accounting_entity_id: context.accounting_entity_id,
        issue_date: buildDateRangeFilter(
          period.period_start,
          period.period_end,
        ),
        status: { notIn: ['cancelled', 'voided'] },
      },
      include: { invoice_taxes: true, supplier: true },
      orderBy: { issue_date: 'asc' },
    });

    let generated = 0;
    let deductible = 0;
    let taxableBase = 0;
    const lines: Prisma.tax_declaration_linesCreateManyInput[] = [];
    const requiresDianAcceptance = (invoiceType: string) =>
      [
        'sales_invoice',
        'debit_note',
        'credit_note',
        'purchase_invoice',
        'support_document',
        'support_adjustment_note',
      ].includes(invoiceType);
    const isAcceptedForTax = (invoice: (typeof invoices)[number]) =>
      !requiresDianAcceptance(invoice.invoice_type) ||
      invoice.dian_status === 'accepted' ||
      invoice.dian_status === 'not_applicable';
    const nonAccepted = invoices.filter(
      (invoice) => !isAcceptedForTax(invoice),
    );

    for (const invoice of invoices) {
      if (!isAcceptedForTax(invoice)) continue;

      const sign =
        invoice.invoice_type === 'credit_note' ||
        invoice.invoice_type === 'support_adjustment_note'
          ? -1
          : 1;
      const isSale = [
        'sales_invoice',
        'debit_note',
        'export_invoice',
        'credit_note',
      ].includes(invoice.invoice_type);
      // Only IVA rows feed the VAT declaration. INC/ICA/withholding live in
      // their own declarations now that invoice_taxes carries tax_type. Legacy
      // untyped rows (tax_type IS NULL) default to IVA for back-compat.
      const invoiceTax =
        invoice.invoice_taxes
          .filter((tax) => ((tax as any).tax_type ?? 'iva') === 'iva')
          .reduce((sum, tax) => sum + Number(tax.tax_amount || 0), 0) * sign;
      const invoiceBase = Number(invoice.subtotal_amount || 0) * sign;
      taxableBase += invoiceBase;

      if (isSale) generated += invoiceTax;
      else deductible += invoiceTax;

      lines.push({
        declaration_id: 0,
        line_type: isSale ? 'vat_generated' : 'vat_deductible',
        source_type: 'invoice',
        source_id: invoice.id,
        third_party_id: invoice.supplier_id ?? invoice.customer_id ?? undefined,
        third_party_name:
          invoice.customer_name ?? invoice.supplier?.name ?? undefined,
        third_party_tax_id:
          invoice.customer_tax_id ?? invoice.supplier?.tax_id ?? undefined,
        description: `${invoice.invoice_type} ${invoice.invoice_number}`,
        base_amount: invoiceBase,
        tax_amount: invoiceTax,
        metadata: {
          dian_status: invoice.dian_status,
          issue_date: invoice.issue_date,
        },
      });
    }

    const balance = generated - deductible;
    return {
      totals: {
        gross_base_amount: taxableBase,
        taxable_base_amount: taxableBase,
        generated_tax_amount: generated,
        deductible_tax_amount: deductible,
        balance_due: Math.max(balance, 0),
        balance_favor: Math.max(balance * -1, 0),
        total_payable: Math.max(balance, 0),
      },
      lines,
      rules_snapshot: await this.resolveRulesSnapshot(
        context,
        'vat',
        period.period_year,
      ),
      source_snapshot: {
        invoice_count: invoices.length,
        counted_invoice_ids: lines
          .map((line) => line.source_id)
          .filter((id): id is number => typeof id === 'number'),
        skipped_invoice_ids: nonAccepted.map((invoice) => invoice.id),
      },
      validation_summary: {
        warnings: nonAccepted.map((invoice) => ({
          code: 'DIAN_NOT_ACCEPTED',
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          invoice_type: invoice.invoice_type,
          dian_status: invoice.dian_status,
        })),
      },
    };
  }

  /**
   * Impuesto Nacional al Consumo (INC) declaration. INC is a sales-side
   * consumption tax (not deductible like IVA), so it only accrues on sale
   * documents. Reads the typed `inc` rows from invoice_taxes using each row's
   * own taxable_amount as the base (more precise than the invoice subtotal,
   * since INC usually applies to a subset of lines).
   */
  private async calculateInc(
    context: FiscalOperationsContext,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    const invoices = await this.prisma.invoices.findMany({
      where: {
        accounting_entity_id: context.accounting_entity_id,
        invoice_type: {
          in: ['sales_invoice', 'debit_note', 'credit_note', 'export_invoice'],
        },
        issue_date: buildDateRangeFilter(
          period.period_start,
          period.period_end,
        ),
        status: { notIn: ['cancelled', 'voided'] },
      },
      include: { invoice_taxes: true, supplier: true },
      orderBy: { issue_date: 'asc' },
    });

    const requiresDianAcceptance = (invoiceType: string) =>
      ['sales_invoice', 'debit_note', 'credit_note'].includes(invoiceType);
    const isAcceptedForTax = (invoice: (typeof invoices)[number]) =>
      !requiresDianAcceptance(invoice.invoice_type) ||
      invoice.dian_status === 'accepted' ||
      invoice.dian_status === 'not_applicable';
    const nonAccepted = invoices.filter(
      (invoice) => !isAcceptedForTax(invoice),
    );

    let generated = 0;
    let taxableBase = 0;
    const lines: Prisma.tax_declaration_linesCreateManyInput[] = [];

    for (const invoice of invoices) {
      if (!isAcceptedForTax(invoice)) continue;
      const sign =
        invoice.invoice_type === 'credit_note' ||
        invoice.invoice_type === 'support_adjustment_note'
          ? -1
          : 1;

      const incRows = invoice.invoice_taxes.filter(
        (tax) => (tax as any).tax_type === 'inc',
      );
      if (incRows.length === 0) continue;

      const incTax =
        incRows.reduce((sum, tax) => sum + Number(tax.tax_amount || 0), 0) *
        sign;
      const incBase =
        incRows.reduce(
          (sum, tax) => sum + Number(tax.taxable_amount || 0),
          0,
        ) * sign;

      generated += incTax;
      taxableBase += incBase;

      lines.push({
        declaration_id: 0,
        line_type: 'inc_generated',
        source_type: 'invoice',
        source_id: invoice.id,
        third_party_id: invoice.customer_id ?? undefined,
        third_party_name: invoice.customer_name ?? undefined,
        third_party_tax_id: invoice.customer_tax_id ?? undefined,
        description: `${invoice.invoice_type} ${invoice.invoice_number}`,
        base_amount: incBase,
        tax_amount: incTax,
        metadata: {
          dian_status: invoice.dian_status,
          issue_date: invoice.issue_date,
        },
      });
    }

    return {
      totals: {
        gross_base_amount: taxableBase,
        taxable_base_amount: taxableBase,
        generated_tax_amount: generated,
        balance_due: Math.max(generated, 0),
        balance_favor: Math.max(generated * -1, 0),
        total_payable: Math.max(generated, 0),
      },
      lines,
      rules_snapshot: await this.resolveRulesSnapshot(
        context,
        'inc',
        period.period_year,
      ),
      source_snapshot: {
        invoice_count: invoices.length,
        counted_invoice_ids: lines
          .map((line) => line.source_id)
          .filter((id): id is number => typeof id === 'number'),
        skipped_invoice_ids: nonAccepted.map((invoice) => invoice.id),
      },
      validation_summary: {
        warnings: nonAccepted.map((invoice) => ({
          code: 'DIAN_NOT_ACCEPTED',
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          invoice_type: invoice.invoice_type,
          dian_status: invoice.dian_status,
        })),
      },
    };
  }

  private async calculateWithholding(
    context: FiscalOperationsContext,
    type: tax_declaration_type_enum,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    // La declaración de retención en la fuente (DIAN form 350) reporta SOLO lo
    // que YO PRACTIQUÉ (role='practiced'). Las retenciones que me practicaron
    // (role='suffered') son un crédito a mi favor — NO son obligación de pago
    // mía y por tanto NO deben entrar al balance_due/total_payable de esta
    // declaración. Se filtran de raíz aquí.
    const calculations = await this.prisma.withholding_calculations.findMany({
      where: {
        accounting_entity_id: context.accounting_entity_id,
        role: 'practiced',
        created_at: buildDateRangeFilter(
          period.period_start,
          period.period_end,
        ),
      },
      include: { concept: true, supplier: true, invoice: true },
      orderBy: { created_at: 'asc' },
    });

    // Mapeo declaración -> tipo de retención. `withholding` (retefuente,
    // form 350) corresponde al withholding_type 'retefuente'.
    const targetWithholdingType: withholding_type_enum =
      type === 'reteiva'
        ? 'reteiva'
        : type === 'reteica'
          ? 'reteica'
          : 'retefuente';

    const filtered = calculations.filter((calculation) => {
      // Fuente confiable: el withholding_type tipado en la fila. Si está
      // ausente (filas legacy), se cae a la heurística histórica por nombre
      // de concepto para no perder retenciones ya registradas.
      if (calculation.withholding_type) {
        return calculation.withholding_type === targetWithholdingType;
      }
      const conceptName =
        `${calculation.concept.code} ${calculation.concept.name}`.toLowerCase();
      if (type === 'reteiva') return conceptName.includes('iva');
      if (type === 'reteica') return conceptName.includes('ica');
      return !conceptName.includes('iva') && !conceptName.includes('ica');
    });

    const withholding = filtered.reduce(
      (sum, item) => sum + Number(item.withholding_amount || 0),
      0,
    );
    const base = filtered.reduce(
      (sum, item) => sum + Number(item.base_amount || 0),
      0,
    );

    return {
      totals: {
        gross_base_amount: base,
        taxable_base_amount: base,
        withholding_amount: withholding,
        balance_due: withholding,
        total_payable: withholding,
      },
      lines: filtered.map((item) => ({
        declaration_id: 0,
        line_type: 'withholding_practiced',
        source_type: 'withholding_calculation',
        source_id: item.id,
        third_party_id: item.supplier_id ?? undefined,
        third_party_name: item.supplier?.name,
        third_party_tax_id: item.supplier?.tax_id,
        concept_code: item.concept.code,
        description: `${item.concept.code} - ${item.concept.name}`,
        base_amount: Number(item.base_amount || 0),
        withholding_amount: Number(item.withholding_amount || 0),
        metadata: {
          invoice_id: item.invoice_id,
          withholding_rate: item.withholding_rate,
          uvt_value_used: item.uvt_value_used,
        },
      })),
      rules_snapshot: await this.resolveRulesSnapshot(
        context,
        type,
        period.period_year,
      ),
      source_snapshot: {
        withholding_calculation_count: filtered.length,
        withholding_calculation_ids: filtered.map((item) => item.id),
      },
      validation_summary: {
        warnings: filtered
          .filter((item) => !item.supplier?.tax_id)
          .map((item) => ({
            code: 'SUPPLIER_WITHOUT_TAX_ID',
            supplier_id: item.supplier_id,
          })),
      },
    };
  }

  private async calculateIca(
    context: FiscalOperationsContext,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    const invoices = await this.prisma.invoices.findMany({
      where: {
        accounting_entity_id: context.accounting_entity_id,
        invoice_type: { in: ['sales_invoice', 'debit_note', 'credit_note'] },
        issue_date: buildDateRangeFilter(
          period.period_start,
          period.period_end,
        ),
        status: { notIn: ['cancelled', 'voided', 'rejected'] },
      },
      orderBy: { issue_date: 'asc' },
    });
    const rate = await this.prisma.ica_municipal_rates.findFirst({
      where: { is_active: true },
      orderBy: { effective_date: 'desc' },
    });
    const ratePerMil = Number(rate?.rate_per_mil || 0);
    const base = invoices.reduce((sum, invoice) => {
      const sign = invoice.invoice_type === 'credit_note' ? -1 : 1;
      return sum + Number(invoice.subtotal_amount || 0) * sign;
    }, 0);
    const tax = (base * ratePerMil) / 1000;

    return {
      totals: {
        gross_base_amount: base,
        taxable_base_amount: base,
        generated_tax_amount: tax,
        balance_due: Math.max(tax, 0),
        total_payable: Math.max(tax, 0),
      },
      lines: invoices.map((invoice) => {
        const sign = invoice.invoice_type === 'credit_note' ? -1 : 1;
        const baseAmount = Number(invoice.subtotal_amount || 0) * sign;
        return {
          declaration_id: 0,
          line_type: 'ica_base',
          source_type: 'invoice',
          source_id: invoice.id,
          description: `${invoice.invoice_type} ${invoice.invoice_number}`,
          base_amount: baseAmount,
          tax_amount: (baseAmount * ratePerMil) / 1000,
          metadata: {
            municipality_code: rate?.municipality_code,
            municipality_name: rate?.municipality_name,
            rate_per_mil: ratePerMil,
          },
        };
      }),
      rules_snapshot: await this.resolveRulesSnapshot(
        context,
        'ica',
        period.period_year,
      ),
      source_snapshot: { invoice_count: invoices.length },
      validation_summary: {
        warnings: rate ? [] : [{ code: 'ICA_RATE_NOT_CONFIGURED' }],
      },
    };
  }

  private async calculateExogenous(
    context: FiscalOperationsContext,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    const reports = await this.prisma.exogenous_reports.findMany({
      where: {
        organization_id: context.organization_id,
        fiscal_year: period.period_year,
        ...(context.store_id ? { store_id: context.store_id } : {}),
      },
      include: { exogenous_report_lines: true },
    });
    const lines = reports.flatMap((report) =>
      report.exogenous_report_lines.map((line) => ({
        declaration_id: 0,
        line_type: 'exogenous_third_party',
        source_type: 'exogenous_report_line',
        source_id: line.id,
        third_party_name: line.third_party_name,
        third_party_tax_id: line.third_party_nit,
        concept_code: line.concept_code,
        description: `Formato ${report.format_code} - ${line.concept_code}`,
        base_amount: Number(line.payment_amount || 0),
        tax_amount: Number(line.tax_amount || 0),
        withholding_amount: Number(line.withholding_amount || 0),
        metadata: { report_id: report.id, format_code: report.format_code },
      })),
    );
    const total = lines.reduce(
      (sum, line) => sum + Number(line.base_amount || 0),
      0,
    );

    return {
      totals: { gross_base_amount: total, taxable_base_amount: total },
      lines,
      rules_snapshot: await this.resolveRulesSnapshot(
        context,
        'exogenous',
        period.period_year,
      ),
      source_snapshot: { report_ids: reports.map((report) => report.id) },
      validation_summary: {
        warnings: lines
          .filter((line) => !line.third_party_tax_id)
          .map((line) => ({
            code: 'THIRD_PARTY_WITHOUT_TAX_ID',
            source_id: line.source_id,
          })),
      },
    };
  }

  private async calculateIncomePreclose(
    context: FiscalOperationsContext,
    period: ReturnType<typeof resolveFiscalPeriodRange>,
  ): Promise<DeclarationCalculation> {
    const lines = await this.prisma.accounting_entry_lines.findMany({
      where: {
        entry: {
          accounting_entity_id: context.accounting_entity_id,
          entry_date: buildDateRangeFilter(
            period.period_start,
            period.period_end,
          ),
          status: 'posted',
        },
      },
      include: { account: true, entry: true },
    });
    let revenue = 0;
    let costsAndExpenses = 0;
    const declarationLines: Prisma.tax_declaration_linesCreateManyInput[] = [];

    for (const line of lines) {
      const amount =
        Number(line.credit_amount || 0) - Number(line.debit_amount || 0);
      if (line.account.account_type === 'revenue') revenue += amount;
      if (line.account.account_type === 'expense') {
        costsAndExpenses +=
          Number(line.debit_amount || 0) - Number(line.credit_amount || 0);
      }
      if (
        line.account.account_type === 'revenue' ||
        line.account.account_type === 'expense'
      ) {
        declarationLines.push({
          declaration_id: 0,
          line_type:
            line.account.account_type === 'revenue'
              ? 'income_revenue'
              : 'income_expense',
          source_type: 'accounting_entry_line',
          source_id: line.id,
          account_id: line.account_id,
          description: line.description || line.account.name,
          base_amount: Math.abs(amount),
          debit_amount: Number(line.debit_amount || 0),
          credit_amount: Number(line.credit_amount || 0),
          metadata: {
            entry_id: line.entry_id,
            account_code: line.account.code,
          },
        });
      }
    }

    const taxable = revenue - costsAndExpenses;
    return {
      totals: {
        gross_base_amount: revenue,
        taxable_base_amount: taxable,
        generated_tax_amount: 0,
        total_payable: 0,
      },
      lines: declarationLines,
      rules_snapshot: await this.resolveRulesSnapshot(
        context,
        'income_tax',
        period.period_year,
      ),
      source_snapshot: { accounting_line_count: lines.length },
      validation_summary: { warnings: [] },
    };
  }

  private async resolveRulesSnapshot(
    context: FiscalOperationsContext,
    ruleType: string,
    year: number,
  ): Promise<Prisma.InputJsonObject> {
    const rule = await this.prisma.fiscal_rule_sets.findFirst({
      where: {
        country_code: 'CO',
        year,
        rule_type: String(ruleType),
        status: 'active',
        OR: [
          { accounting_entity_id: context.accounting_entity_id },
          {
            organization_id: context.organization_id,
            accounting_entity_id: null,
          },
          { organization_id: null, accounting_entity_id: null },
        ],
      },
      orderBy: [
        { accounting_entity_id: 'desc' },
        { organization_id: 'desc' },
        { version: 'desc' },
      ],
    });

    if (
      rule?.rules &&
      typeof rule.rules === 'object' &&
      !Array.isArray(rule.rules)
    ) {
      return rule.rules as Prisma.InputJsonObject;
    }

    return {
      country_code: 'CO',
      year,
      rule_type: ruleType,
      source: 'vendix_default_fallback',
      disclaimer: 'Borrador interno; validar con contador antes de presentar.',
    };
  }

  private whereForContexts(
    contexts: FiscalOperationsContext[],
  ): Prisma.tax_declaration_draftsWhereInput {
    if (contexts.length === 1) {
      return {
        organization_id: contexts[0].organization_id,
        accounting_entity_id: contexts[0].accounting_entity_id,
      };
    }

    return {
      organization_id: contexts[0].organization_id,
      accounting_entity_id: {
        in: contexts.map((context) => context.accounting_entity_id),
      },
    };
  }

  private assertStatusTransition(
    current: tax_declaration_status_enum,
    next: tax_declaration_status_enum,
  ) {
    if (current === next) return;
    if (TERMINAL_DECLARATION_STATUSES.includes(current)) {
      throw new BadRequestException(
        `Tax declaration in ${current} status cannot transition to ${next}`,
      );
    }

    const allowed = DECLARATION_STATUS_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid tax declaration status transition from ${current} to ${next}`,
      );
    }
  }

  private async assertEvidenceForDeclaration(
    draft: Awaited<ReturnType<TaxDeclarationDraftService['findOne']>>,
    evidenceId: number | undefined,
    targetStatus: tax_declaration_status_enum,
  ) {
    const effectiveEvidenceId = evidenceId ?? draft.evidence_id;
    if (
      (targetStatus === 'submitted' || targetStatus === 'accepted') &&
      !effectiveEvidenceId
    ) {
      throw new BadRequestException(
        `evidence_id is required when marking declaration as ${targetStatus}`,
      );
    }

    if (!evidenceId) return;

    const evidence = await this.prisma.fiscal_evidences.findFirst({
      where: {
        id: evidenceId,
        organization_id: draft.organization_id,
        accounting_entity_id: draft.accounting_entity_id,
      },
      select: { id: true },
    });

    if (!evidence) {
      throw new BadRequestException(
        'Fiscal evidence does not belong to the declaration fiscal entity',
      );
    }
  }
}

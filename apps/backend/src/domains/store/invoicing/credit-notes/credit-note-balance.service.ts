import { Injectable } from '@nestjs/common';
import {
  Prisma,
  dian_document_status_enum,
  fiscal_document_type_enum,
  fiscal_transmission_status_enum,
  invoice_type_enum,
} from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { allocateNoteDocumentAllowance } from '../services/invoice-calculator.service';

export interface CreditNoteCandidate {
  total_amount: Prisma.Decimal.Value;
  lines: readonly {
    source_invoice_item_id: number;
    quantity: Prisma.Decimal.Value;
    base_amount: Prisma.Decimal.Value;
    total_amount: Prisma.Decimal.Value;
  }[];
}

export interface CreditNoteRemainingLine {
  remaining_quantity: Prisma.Decimal;
  remaining_base: Prisma.Decimal;
  remaining_total: Prisma.Decimal;
}

export interface CreditNoteCandidateDocument {
  total_amount: Prisma.Decimal.Value;
  tax_amount: Prisma.Decimal.Value;
  invoice_items: readonly {
    source_invoice_item_id: number;
    quantity: Prisma.Decimal.Value;
    tax_amount: Prisma.Decimal.Value;
    total_amount: Prisma.Decimal.Value;
  }[];
}

export type CreditNoteReleaseEvidence =
  | 'none'
  | 'definitive_rejection'
  | 'pretransmission_cancel';

type TenantContext = {
  organization_id: number;
  store_id: number;
};

const BALANCE_ITEM_SELECT = {
  id: true,
  invoice_id: true,
  source_invoice_item_id: true,
  product_id: true,
  product_variant_id: true,
  description: true,
  quantity: true,
  unit_price: true,
  discount_amount: true,
  tax_amount: true,
  total_amount: true,
  is_inclusive: true,
  price_unit_quantity: true,
  unit_code: true,
  account_code: true,
  aiu_component: true,
  financial_source_line_id: true,
  stock_units_consumed: true,
  serial_numbers_snapshot: true,
} satisfies Prisma.invoice_itemsSelect;

const BALANCE_TAX_SELECT = {
  invoice_item_id: true,
  tax_rate_id: true,
  tax_name: true,
  tax_type: true,
  tax_rate: true,
  taxable_amount: true,
  tax_amount: true,
  is_inclusive: true,
} satisfies Prisma.invoice_taxesSelect;

const BALANCE_INVOICE_SELECT = {
  id: true,
  organization_id: true,
  store_id: true,
  accounting_entity_id: true,
  invoice_type: true,
  status: true,
  transmission_status: true,
  dian_status: true,
  related_invoice_id: true,
  subtotal_amount: true,
  discount_amount: true,
  tax_amount: true,
  total_amount: true,
  credit_limit_reserved_at: true,
  sent_at: true,
  accepted_at: true,
  invoice_items: { select: BALANCE_ITEM_SELECT },
  invoice_taxes: { select: BALANCE_TAX_SELECT },
} satisfies Prisma.invoicesSelect;

type BalanceInvoice = Prisma.invoicesGetPayload<{
  select: typeof BALANCE_INVOICE_SELECT;
}>;

const ACTIVE_TRANSMISSION_STATUSES = new Set([
  'queued',
  'signing',
  'signed',
  'submitted',
  'retrying',
  'error',
  'unknown',
  'contingency',
]);

const EVER_SUBMITTED_STATUSES = new Set([
  'submitted',
  'accepted',
  'rejected',
  'contingency',
]);

const ZERO = new Prisma.Decimal(0);

/**
 * Builds the exact economic candidate used by source-line and invoice limits.
 * Header allowances are allocated to source IDs in deterministic cents; line
 * totals passed to checks therefore match the document header, not the raw
 * pre-allowance sum of invoice_items.
 */
export function buildCreditNoteCandidate(
  document: CreditNoteCandidateDocument,
): CreditNoteCandidate {
  const parentId = undefined;
  const candidateError = (reason: string, sourceItemId?: number) =>
    new VendixHttpException(
      ErrorCodes.INVOICING_NOTE_SOURCE_001,
      undefined,
      {
        parent_invoice_id: parentId,
        source_invoice_item_id: sourceItemId,
        reason,
      },
    );
  const decimal = (
    value: Prisma.Decimal.Value,
    field: string,
    scale: number,
    sourceItemId?: number,
  ): Prisma.Decimal => {
    let result: Prisma.Decimal;
    try {
      result = new Prisma.Decimal(value);
    } catch {
      throw candidateError(`invalid_${field}`, sourceItemId);
    }
    if (
      !result.isFinite() ||
      result.isNegative() ||
      result.decimalPlaces() > scale
    ) {
      throw candidateError(`invalid_${field}`, sourceItemId);
    }
    return result;
  };
  const headerTotal = decimal(document.total_amount, 'header_total', 2);
  const headerTax = decimal(document.tax_amount, 'header_tax', 2);
  if (document.invoice_items.length === 0) {
    throw candidateError('candidate_lines_empty');
  }
  const lines = document.invoice_items.map((item) => {
    if (!Number.isInteger(item.source_invoice_item_id) || item.source_invoice_item_id < 1) {
      throw candidateError('candidate_source_invalid', item.source_invoice_item_id);
    }
    const quantity = decimal(item.quantity, 'quantity', 4, item.source_invoice_item_id);
    if (quantity.isZero()) {
      throw candidateError('candidate_quantity_not_positive', item.source_invoice_item_id);
    }
    const tax_amount = decimal(item.tax_amount, 'line_tax', 2, item.source_invoice_item_id);
    const total_amount = decimal(item.total_amount, 'line_total', 2, item.source_invoice_item_id);
    const raw_base = total_amount.minus(tax_amount);
    if (raw_base.isNegative()) {
      throw candidateError('candidate_line_base_negative', item.source_invoice_item_id);
    }
    return {
      id: item.source_invoice_item_id,
      quantity,
      raw_base,
      tax_amount,
    };
  });
  const sourceIds = new Set<number>();
  for (const line of lines) {
    if (sourceIds.has(line.id)) {
      throw candidateError('duplicate_candidate_source', line.id);
    }
    sourceIds.add(line.id);
  }
  const lineTaxTotal = lines.reduce((sum, line) => sum.plus(line.tax_amount), ZERO);
  if (!lineTaxTotal.equals(headerTax)) {
    throw candidateError('candidate_tax_total_mismatch');
  }
  const rawBaseTotal = lines.reduce((sum, line) => sum.plus(line.raw_base), ZERO);
  const headerBase = headerTotal.minus(headerTax);
  const allowance = rawBaseTotal.minus(headerBase);
  if (!allowance.isFinite() || allowance.isNegative()) {
    throw candidateError('candidate_allowance_unresolvable');
  }
  const allocations = allocateNoteDocumentAllowance(
    allowance,
    lines.map((line) => ({ id: line.id, base_amount: line.raw_base })),
  );
  if (!allocations) {
    throw candidateError('candidate_allowance_unresolvable');
  }
  return {
    total_amount: headerTotal,
    lines: lines.map((line) => {
      const effectiveBase = line.raw_base.minus(allocations.get(line.id) ?? ZERO);
      return {
        source_invoice_item_id: line.id,
        quantity: line.quantity,
        base_amount: effectiveBase,
        total_amount: effectiveBase.plus(line.tax_amount),
      };
    }),
  };
}

@Injectable()
export class CreditNoteBalanceService {
  constructor(private readonly prisma: StorePrismaService) {}

  async remaining(
    sourceId: number,
    excludeNoteId?: number,
  ): Promise<{
    remaining_total: Prisma.Decimal;
    lines: Map<number, CreditNoteRemainingLine>;
  }> {
    const context = this.getTenantContext();
    const source = await this.readVisibleInvoice(sourceId, context);
    const notes = await this.readCreditNotes(source, context, undefined);
    const noteIds = notes.map((note) => note.id);
    const ledgers = await this.readTransmissionRows(source, noteIds);
    return this.computeRemaining(source, notes, ledgers, excludeNoteId);
  }

  async assertCanCreate(
    sourceId: number,
    candidate: CreditNoteCandidate,
  ): Promise<void> {
    const context = this.getTenantContext();
    await this.withLockedParent(sourceId, context, async (tx, source) => {
      this.assertCorrectableSource(source);
      this.assertCandidateDatabasePrecision(candidate, source.id);
      const notes = await this.readCreditNotes(source, context, tx);
      const noteIds = notes.map((note) => note.id);
      const ledgers = await this.readTransmissionRows(source, noteIds, tx);
      const remaining = this.computeRemaining(source, notes, ledgers);
      this.assertCandidateWithinRemaining(source.id, candidate, remaining);
    });
  }

  /** Validates a draft note and reserves credit, if applicable, before a number is allocated. */
  async assertNoteBeforeNumbering(noteId: number): Promise<void> {
    const context = this.getTenantContext();
    const visibleNote = await this.readVisibleNote(noteId, context);
    if (visibleNote.status !== 'draft') {
      throw this.stateException(visibleNote.id, 'note_not_draft');
    }
    const sourceId = visibleNote.related_invoice_id;
    if (!sourceId) {
      throw this.sourceException(undefined, undefined, 'source_invoice_missing');
    }

    await this.withLockedParent(sourceId, context, async (tx, source) => {
      const note = await this.readNoteInTransaction(tx, noteId, context);
      this.assertSameFiscalEntity(source, note);
      this.assertCorrectableSource(source);
      if (note.status !== 'draft') {
        throw this.stateException(note.id, 'note_not_draft');
      }
      const candidate = this.candidateFromInvoice(note, source);
      this.assertCandidateDatabasePrecision(candidate, source.id);
      const noteLedger = await this.readTransmissionRows(source, [note.id], tx);
      if (this.hasAcceptedEvidence(note, noteLedger)) {
        throw this.stateException(note.id, 'note_already_accepted');
      }
      if (note.invoice_type === 'credit_note') {
        const notes = await this.readCreditNotes(source, context, tx);
        const noteIds = notes.map((row) => row.id);
        const ledgers = await this.readTransmissionRows(source, noteIds, tx);
        const remaining = this.computeRemaining(source, notes, ledgers, note.id);
        this.assertCandidateWithinRemaining(source.id, candidate, remaining);
      }
    });
  }

  async reserveValidation(
    noteId: number,
    include: Prisma.invoicesInclude,
  ): Promise<any> {
    const context = this.getTenantContext();
    const visibleNote = await this.readVisibleNote(noteId, context);
    if (visibleNote.status !== 'draft') {
      throw this.stateException(visibleNote.id, 'note_not_draft');
    }
    const sourceId = visibleNote.related_invoice_id;
    if (!sourceId) {
      throw this.sourceException(undefined, undefined, 'source_invoice_missing');
    }

    return this.withLockedParent(sourceId, context, async (tx, source) => {
      const note = await this.readNoteInTransaction(tx, noteId, context);
      this.assertSameFiscalEntity(source, note);
      const existingLedger = await this.readTransmissionRows(source, [note.id], tx);
      if (this.hasAcceptedEvidence(note, existingLedger)) {
        throw this.stateException(note.id, 'note_already_accepted');
      }
      if (note.status !== 'draft') {
        throw this.stateException(note.id, 'note_not_draft');
      }
      this.assertCorrectableSource(source);
      const candidate = this.candidateFromInvoice(note, source);
      this.assertCandidateDatabasePrecision(candidate, source.id);
      if (note.invoice_type === 'debit_note') {
        const updated = await tx.invoices.updateMany({
          where: {
            id: note.id,
            organization_id: context.organization_id,
            store_id: context.store_id,
            status: 'draft',
          },
          data: { status: 'validated' },
        });
        if (updated.count !== 1) {
          throw this.stateException(note.id, 'note_state_changed');
        }
        return tx.invoices.findFirst({
          where: this.noteWhere(note.id, context),
          include,
        });
      }

      const notes = await this.readCreditNotes(source, context, tx);
      const noteIds = notes.map((row) => row.id);
      const ledgers = await this.readTransmissionRows(source, noteIds, tx);
      const remaining = this.computeRemaining(source, notes, ledgers, note.id);
      this.assertCandidateWithinRemaining(
        source.id,
        candidate,
        remaining,
      );

      const updated = await tx.invoices.updateMany({
        where: {
          id: note.id,
          organization_id: context.organization_id,
          store_id: context.store_id,
          accounting_entity_id: source.accounting_entity_id,
          status: 'draft',
        },
        data: {
          status: 'validated',
          credit_limit_reserved_at: note.credit_limit_reserved_at ?? new Date(),
        },
      });
      if (updated.count !== 1) {
        throw this.stateException(note.id, 'note_state_changed');
      }
      return tx.invoices.findFirst({
        where: this.noteWhere(note.id, context),
        include,
      });
    });
  }

  async ensureForSend(noteId: number): Promise<void> {
    const context = this.getTenantContext();
    const visibleNote = await this.readVisibleNote(noteId, context);
    const sourceId = visibleNote.related_invoice_id;
    if (!sourceId) {
      throw this.sourceException(undefined, undefined, 'source_invoice_missing');
    }

    await this.withLockedParent(sourceId, context, async (tx, source) => {
      const note = await this.readNoteInTransaction(tx, noteId, context);
      this.assertSameFiscalEntity(source, note);
      const existingLedger = await this.readTransmissionRows(source, [note.id], tx);
      if (this.hasAcceptedEvidence(note, existingLedger)) {
        throw this.stateException(note.id, 'note_already_accepted');
      }
      if (
        ['cancelled', 'voided', 'accepted'].includes(note.status) ||
        note.transmission_status === 'accepted'
      ) {
        throw this.stateException(note.id, 'note_not_sendable');
      }

      const reserve = note.invoice_type === 'credit_note';
      const candidate = this.candidateFromInvoice(note, source);
      this.assertCandidateDatabasePrecision(candidate, source.id);
      if (reserve) {
        const notes = await this.readCreditNotes(source, context, tx);
        const noteIds = notes.map((row) => row.id);
        const ledgers = await this.readTransmissionRows(source, noteIds, tx);
        const remaining = this.computeRemaining(source, notes, ledgers, note.id);
        this.assertCandidateWithinRemaining(
          source.id,
          candidate,
          remaining,
        );
      }

      const updated = await tx.invoices.updateMany({
        where: {
          id: note.id,
          organization_id: context.organization_id,
          store_id: context.store_id,
          accounting_entity_id: source.accounting_entity_id,
          status: { notIn: ['cancelled', 'voided', 'accepted'] },
          transmission_status: { not: 'accepted' },
        },
        data: {
          transmission_status: 'queued',
          ...(reserve && !note.credit_limit_reserved_at
            ? { credit_limit_reserved_at: new Date() }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw this.stateException(note.id, 'note_state_changed');
      }
    });
  }

  async transition(
    noteId: number,
    data: Prisma.invoicesUpdateManyMutationInput,
    include: Prisma.invoicesInclude,
    release: CreditNoteReleaseEvidence = 'none',
    expectedStatus?: string,
  ): Promise<any> {
    const context = this.getTenantContext();
    const visibleNote = await this.readVisibleNote(noteId, context);
    const sourceId = visibleNote.related_invoice_id;
    if (!sourceId) {
      throw this.sourceException(undefined, undefined, 'source_invoice_missing');
    }

    const acceptanceRequest =
      data?.status === 'accepted' ||
      data?.dian_status === 'accepted' ||
      data?.transmission_status === 'accepted';
    return this.withLockedParent(sourceId, context, async (tx, source) => {
      const note = await this.readNoteInTransaction(tx, noteId, context);
      this.assertSameFiscalEntity(source, note);
      const { credit_limit_reserved_at: _ignoredReservation, ...safeData } =
        data ?? {};
      const ledgerRows = await this.readTransmissionRows(source, [note.id], tx);
      const recordsAcceptance =
        safeData.status === 'accepted' ||
        safeData.dian_status === 'accepted' ||
        safeData.transmission_status === 'accepted';
      if (
        this.hasAcceptedEvidence(note, ledgerRows) &&
        !recordsAcceptance
      ) {
        throw this.stateException(note.id, 'accepted_note_cannot_be_rejected_or_cancelled');
      }
      if (expectedStatus && note.status !== expectedStatus && !recordsAcceptance) {
        throw this.stateException(note.id, 'expected_status_mismatch');
      }
      const shouldRelease = recordsAcceptance
        ? false
        : await this.canReleaseReservation(tx, note, release);
      const updated = await tx.invoices.updateMany({
        where: {
          id: note.id,
          organization_id: context.organization_id,
          store_id: context.store_id,
          accounting_entity_id: source.accounting_entity_id,
        },
        data: {
          ...safeData,
          ...(recordsAcceptance && note.invoice_type === 'credit_note'
            ? { credit_limit_reserved_at: note.credit_limit_reserved_at ?? new Date() }
            : {}),
          ...(shouldRelease ? { credit_limit_reserved_at: null } : {}),
        },
      });
      if (updated.count !== 1) {
        throw this.stateException(note.id, 'note_state_changed');
      }
      return tx.invoices.findFirst({
        where: this.noteWhere(note.id, context),
        include,
      });
    }, !acceptanceRequest);
  }

  private getTenantContext(): TenantContext {
    const context = RequestContextService.getContext();
    if (
      !context ||
      !Number.isInteger(context.organization_id) ||
      !Number.isInteger(context.store_id)
    ) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    return {
      organization_id: context.organization_id!,
      store_id: context.store_id!,
    };
  }

  private async readVisibleInvoice(
    id: number,
    context: TenantContext,
    requireAcceptedSource = true,
  ): Promise<BalanceInvoice> {
    const invoice = await this.prisma.invoices.findFirst({
      where: {
        id,
        organization_id: context.organization_id,
        store_id: context.store_id,
      },
      select: BALANCE_INVOICE_SELECT,
    });
    if (!invoice) {
      throw this.sourceException(id, undefined, 'source_invoice_not_found');
    }
    this.assertCorrectableSource(invoice);
    if (requireAcceptedSource) await this.assertSourceAccepted(invoice);
    return invoice;
  }

  private async readVisibleNote(
    id: number,
    context: TenantContext,
  ): Promise<BalanceInvoice> {
    const note = await this.prisma.invoices.findFirst({
      where: {
        id,
        organization_id: context.organization_id,
        store_id: context.store_id,
        invoice_type: { in: ['credit_note', 'debit_note'] },
      },
      select: BALANCE_INVOICE_SELECT,
    });
    if (!note) {
      throw this.sourceException(undefined, undefined, 'note_not_found');
    }
    return note;
  }

  private async readNoteInTransaction(
    tx: Prisma.TransactionClient,
    id: number,
    context: TenantContext,
  ): Promise<BalanceInvoice> {
    const note = await tx.invoices.findFirst({
      where: {
        ...this.noteWhere(id, context),
        invoice_type: { in: ['credit_note', 'debit_note'] },
      },
      select: BALANCE_INVOICE_SELECT,
    });
    if (!note) {
      throw this.sourceException(undefined, undefined, 'note_not_found');
    }
    return note;
  }

  private noteWhere(id: number, context: TenantContext) {
    return {
      id,
      organization_id: context.organization_id,
      store_id: context.store_id,
    };
  }

  private async readCreditNotes(
    source: BalanceInvoice,
    context: TenantContext,
    tx?: Prisma.TransactionClient,
  ): Promise<BalanceInvoice[]> {
    const args = {
      where: {
        related_invoice_id: source.id,
        invoice_type: invoice_type_enum.credit_note,
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id: source.accounting_entity_id,
      },
      select: BALANCE_INVOICE_SELECT,
    } satisfies Prisma.invoicesFindManyArgs;
    if (tx) return tx.invoices.findMany(args);
    return this.prisma.invoices.findMany(args);
  }

  private async readTransmissionRows(
    source: BalanceInvoice,
    noteIds: number[],
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.fiscal_transmissionsGetPayload<{
    select: typeof TRANSMISSION_SELECT;
  }>[]> {
    if (noteIds.length === 0) return [];
    const args = {
      where: {
        organization_id: source.organization_id,
        store_id: source.store_id,
        accounting_entity_id: source.accounting_entity_id,
        document_type: {
          in: [fiscal_document_type_enum.credit_note, fiscal_document_type_enum.debit_note],
        },
        source_type: 'invoice',
        source_id: { in: noteIds },
      },
      select: TRANSMISSION_SELECT,
    } satisfies Prisma.fiscal_transmissionsFindManyArgs;
    if (tx) return tx.fiscal_transmissions.findMany(args);
    return this.prisma.withoutScope().fiscal_transmissions.findMany(args);
  }

  private async withLockedParent<T>(
    sourceId: number,
    context: TenantContext,
    work: (
      tx: Prisma.TransactionClient,
      source: BalanceInvoice,
    ) => Promise<T>,
    requireAcceptedSource = true,
  ): Promise<T> {
    const visibleSource = await this.readVisibleInvoice(sourceId, context, requireAcceptedSource);
    return this.prisma.$transaction(async (rawTx: Prisma.TransactionClient) => {
      const locked = await rawTx.$queryRaw<Array<{ id: number }>>`
        SELECT "id"
        FROM "invoices"
        WHERE "id" = ${visibleSource.id}
          AND "organization_id" = ${context.organization_id}
          AND "store_id" = ${context.store_id}
          AND "accounting_entity_id" = ${visibleSource.accounting_entity_id}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw this.sourceException(sourceId, undefined, 'source_invoice_not_found');
      }
      const source = await rawTx.invoices.findFirst({
        where: {
          id: sourceId,
          organization_id: context.organization_id,
          store_id: context.store_id,
          accounting_entity_id: visibleSource.accounting_entity_id,
        },
        select: BALANCE_INVOICE_SELECT,
      });
      if (!source) {
        throw this.sourceException(sourceId, undefined, 'source_invoice_not_found');
      }
      this.assertCorrectableSource(source);
      if (requireAcceptedSource) await this.assertSourceAccepted(source, rawTx);
      return work(rawTx, source);
    });
  }

  private computeRemaining(
    source: BalanceInvoice,
    notes: readonly BalanceInvoice[],
    ledgers: readonly { source_id: number; transmission_status: string; dian_status: string; sent_at: Date | null; accepted_at: Date | null; rejected_at: Date | null }[],
    excludeNoteId?: number,
  ): {
    remaining_total: Prisma.Decimal;
    lines: Map<number, CreditNoteRemainingLine>;
  } {
    const sourceLines = this.effectiveLines(source);
    const sourceById = new Map<number, (typeof sourceLines)[number]>();
    for (const line of sourceLines) sourceById.set(line.item.id, line);
    const ledgerByNote = new Map<number, typeof ledgers[number][]>();
    for (const ledger of ledgers) {
      const rows = ledgerByNote.get(ledger.source_id) ?? [];
      rows.push(ledger);
      ledgerByNote.set(ledger.source_id, rows);
    }

    let consumedTotal = ZERO;
    const consumedBySource = new Map<number, {
      quantity: Prisma.Decimal;
      base: Prisma.Decimal;
      total: Prisma.Decimal;
    }>();
    for (const note of notes) {
      if (note.id === excludeNoteId) continue;
      const rows = ledgerByNote.get(note.id) ?? [];
      if (!this.noteConsumesCredit(note, rows)) continue;
      consumedTotal = consumedTotal.plus(this.money(note.total_amount, source.id));
      const seenSources = new Set<number>();
      const noteSourceIds = new Map<number, number>();
      for (const item of note.invoice_items) {
        const sourceItemId = this.resolveLegacySourceId(
          source,
          item,
          sourceById,
        );
        if (seenSources.has(sourceItemId)) {
          throw this.sourceException(source.id, sourceItemId, 'duplicate_prior_source_line');
        }
        seenSources.add(sourceItemId);
        noteSourceIds.set(item.id, sourceItemId);
      }
      const noteLines = this.effectiveLines(note, noteSourceIds);
      for (const line of noteLines) {
        const sourceItemId = noteSourceIds.get(line.item.id);
        if (!sourceItemId) {
          throw this.sourceException(source.id, undefined, 'legacy_source_unresolved');
        }
        const current = consumedBySource.get(sourceItemId) ?? {
          quantity: ZERO,
          base: ZERO,
          total: ZERO,
        };
        current.quantity = current.quantity.plus(this.money(line.item.quantity, source.id, sourceItemId));
        current.base = current.base.plus(line.effective_base);
        current.total = current.total.plus(line.effective_total);
        consumedBySource.set(sourceItemId, current);
      }
    }

    const remainingLines = new Map<number, CreditNoteRemainingLine>();
    for (const [sourceItemId, sourceLine] of sourceById) {
      const consumed = consumedBySource.get(sourceItemId) ?? {
        quantity: ZERO,
        base: ZERO,
        total: ZERO,
      };
      remainingLines.set(sourceItemId, {
        remaining_quantity: this.clampZero(
          this.money(sourceLine.item.quantity, source.id, sourceItemId).minus(consumed.quantity),
        ),
        remaining_base: this.clampZero(sourceLine.effective_base.minus(consumed.base)),
        remaining_total: this.clampZero(sourceLine.effective_total.minus(consumed.total)),
      });
    }
    return {
      remaining_total: this.clampZero(
        this.money(source.total_amount, source.id).minus(consumedTotal),
      ),
      lines: remainingLines,
    };
  }

  private effectiveLines(
    invoice: BalanceInvoice,
    allocationIds?: ReadonlyMap<number, number>,
  ): Array<{
    item: BalanceInvoice['invoice_items'][number];
    effective_base: Prisma.Decimal;
    effective_total: Prisma.Decimal;
  }> {
    if (invoice.invoice_items.length === 0) {
      throw this.sourceException(invoice.id, undefined, 'source_invoice_lines_empty');
    }
    const candidate = buildCreditNoteCandidate({
      total_amount: invoice.total_amount,
      tax_amount: invoice.tax_amount,
      invoice_items: invoice.invoice_items.map((item) => ({
        source_invoice_item_id: allocationIds?.get(item.id) ?? item.id,
        quantity: item.quantity,
        tax_amount: item.tax_amount,
        total_amount: item.total_amount,
      })),
    });
    const candidateBySourceId = new Map<number, CreditNoteCandidate['lines'][number]>();
    for (const line of candidate.lines) {
      candidateBySourceId.set(line.source_invoice_item_id, line);
    }
    return invoice.invoice_items.map((item) => {
      const sourceItemId = allocationIds?.get(item.id) ?? item.id;
      const effective = candidateBySourceId.get(sourceItemId);
      if (!effective) {
        throw this.sourceException(invoice.id, sourceItemId, 'document_allowance_unresolved_line');
      }
      return {
        item,
        effective_base: new Prisma.Decimal(effective.base_amount),
        effective_total: new Prisma.Decimal(effective.total_amount),
      };
    });
  }

  private noteConsumesCredit(
    note: BalanceInvoice,
    ledgers: readonly { transmission_status: string; dian_status: string; sent_at: Date | null; accepted_at: Date | null; rejected_at: Date | null }[],
  ): boolean {
    if (
      this.hasAcceptedEvidence(note, ledgers) ||
      note.credit_limit_reserved_at !== null
    ) {
      return true;
    }

    const isDefinitiveRejection = (ledger: (typeof ledgers)[number]) =>
      ledger.transmission_status === 'rejected' &&
      ledger.dian_status === 'rejected' &&
      ledger.rejected_at !== null;
    const definitiveRejection = ledgers.some(isDefinitiveRejection);
    const uncertainLedger = ledgers.some((ledger) => {
      if (isDefinitiveRejection(ledger)) return false;
      return (
        ACTIVE_TRANSMISSION_STATUSES.has(ledger.transmission_status) ||
        ledger.sent_at !== null ||
        ledger.accepted_at !== null
      );
    });
    if (definitiveRejection && !uncertainLedger) return false;

    return (
      ['validated', 'sent'].includes(note.status) ||
      note.sent_at !== null ||
      ACTIVE_TRANSMISSION_STATUSES.has(note.transmission_status) ||
      note.transmission_status === 'rejected' ||
      uncertainLedger
    );
  }

  private hasAcceptedEvidence(
    note: BalanceInvoice,
    ledgers: readonly {
      transmission_status: string;
      dian_status: string;
      accepted_at: Date | null;
    }[],
  ): boolean {
    return (
      note.status === 'accepted' ||
      note.dian_status === 'accepted' ||
      note.transmission_status === 'accepted' ||
      note.accepted_at !== null ||
      ledgers.some(
        (ledger) =>
          ledger.transmission_status === 'accepted' ||
          ledger.dian_status === 'accepted' ||
          ledger.accepted_at !== null,
      )
    );
  }

  private resolveLegacySourceId(
    source: BalanceInvoice,
    noteItem: BalanceInvoice['invoice_items'][number],
    sourceById: Map<number, ReturnType<CreditNoteBalanceService['effectiveLines']>[number]>,
  ): number {
    if (noteItem.source_invoice_item_id !== null) {
      if (!sourceById.has(noteItem.source_invoice_item_id)) {
        throw this.sourceException(source.id, noteItem.source_invoice_item_id, 'source_item_not_in_parent');
      }
      return noteItem.source_invoice_item_id;
    }

    const sourceLines = [...sourceById.values()];
    const optionalSnapshotsMatch = (item: (typeof sourceLines)[number]['item']) =>
      (noteItem.unit_code === null || item.unit_code === null || item.unit_code === noteItem.unit_code) &&
      (noteItem.account_code === null || item.account_code === null || item.account_code === noteItem.account_code) &&
      (noteItem.price_unit_quantity === null ||
        (item.price_unit_quantity ?? 1) === noteItem.price_unit_quantity) &&
      (noteItem.is_inclusive === null || item.is_inclusive === null || item.is_inclusive === noteItem.is_inclusive) &&
      (noteItem.aiu_component === null || item.aiu_component === null || item.aiu_component === noteItem.aiu_component);
    let candidates: typeof sourceLines;
    if (noteItem.financial_source_line_id !== null) {
      candidates = sourceLines.filter(({ item }) =>
        item.financial_source_line_id === noteItem.financial_source_line_id &&
        item.product_id === noteItem.product_id &&
        item.product_variant_id === noteItem.product_variant_id,
      );
    } else {
      candidates = sourceLines.filter(({ item }) =>
        item.product_id === noteItem.product_id &&
        item.product_variant_id === noteItem.product_variant_id &&
        item.description === noteItem.description,
      );
    }
    if (candidates.length !== 1) {
      throw this.sourceException(
        source.id,
        undefined,
        candidates.length === 0 ? 'legacy_source_unproven' : 'legacy_source_ambiguous',
      );
    }
    if (!optionalSnapshotsMatch(candidates[0].item)) {
      throw this.sourceException(source.id, candidates[0].item.id, 'legacy_source_snapshot_mismatch');
    }
    return candidates[0].item.id;
  }

  private candidateFromInvoice(
    note: BalanceInvoice,
    source: BalanceInvoice,
  ): CreditNoteCandidate {
    const sourceLines = this.effectiveLines(source);
    const sourceById = new Map<number, (typeof sourceLines)[number]>();
    for (const line of sourceLines) sourceById.set(line.item.id, line);
    return buildCreditNoteCandidate({
      total_amount: note.total_amount,
      tax_amount: note.tax_amount,
      invoice_items: note.invoice_items.map((item) => {
        return {
          source_invoice_item_id: this.resolveLegacySourceId(
            source,
            item,
            sourceById,
          ),
          quantity: item.quantity,
          tax_amount: item.tax_amount,
          total_amount: item.total_amount,
        };
      }),
    });
  }

  private assertCandidateWithinRemaining(
    sourceId: number,
    candidate: CreditNoteCandidate,
    remaining: {
      remaining_total: Prisma.Decimal;
      lines: Map<number, CreditNoteRemainingLine>;
    },
  ): void {
    this.assertCandidateDatabasePrecision(candidate, sourceId);
    const attemptedTotal = this.candidateDecimal(
      candidate.total_amount,
      sourceId,
      undefined,
      'invalid_candidate_total',
    );
    if (attemptedTotal.gt(remaining.remaining_total)) {
      throw this.limitException(sourceId, undefined, {
        remaining_total: remaining.remaining_total,
        attempted: { total_amount: attemptedTotal },
      });
    }
    const seen = new Set<number>();
    for (const line of candidate.lines) {
      const sourceItemId = line.source_invoice_item_id;
      if (!Number.isInteger(sourceItemId) || sourceItemId < 1 || seen.has(sourceItemId)) {
        throw this.sourceException(sourceId, sourceItemId, 'candidate_source_invalid_or_duplicate');
      }
      seen.add(sourceItemId);
      const lineRemaining = remaining.lines.get(sourceItemId);
      if (!lineRemaining) {
        throw this.sourceException(sourceId, sourceItemId, 'candidate_source_not_in_parent');
      }
      const quantity = this.candidateDecimal(line.quantity, sourceId, sourceItemId, 'invalid_candidate_quantity');
      const base = this.candidateDecimal(line.base_amount, sourceId, sourceItemId, 'invalid_candidate_base');
      const total = this.candidateDecimal(line.total_amount, sourceId, sourceItemId, 'invalid_candidate_line_total');
      if (
        quantity.gt(lineRemaining.remaining_quantity) ||
        base.gt(lineRemaining.remaining_base) ||
        total.gt(lineRemaining.remaining_total)
      ) {
        throw this.limitException(sourceId, sourceItemId, {
          remaining_total: lineRemaining.remaining_total,
          remaining_quantity: lineRemaining.remaining_quantity,
          remaining_base: lineRemaining.remaining_base,
          attempted: {
            quantity,
            base_amount: base,
            total_amount: total,
          },
        });
      }
    }
  }

  private assertCandidateDatabasePrecision(
    candidate: CreditNoteCandidate,
    parentId: number,
  ): void {
    if (candidate.lines.length === 0) {
      throw this.sourceException(parentId, undefined, 'candidate_lines_empty');
    }
    const maxMoney = new Prisma.Decimal('10000000000');
    const maxQuantity = new Prisma.Decimal('100000000');
    const validate = (
      value: Prisma.Decimal.Value,
      scale: number,
      exclusiveMax: Prisma.Decimal,
      itemId: number | undefined,
      reason: string,
    ) => {
      const amount = this.candidateDecimal(value, parentId, itemId, reason);
      if (amount.decimalPlaces() > scale || amount.gte(exclusiveMax)) {
        throw this.sourceException(parentId, itemId, reason);
      }
    };
    validate(candidate.total_amount, 2, maxMoney, undefined, 'candidate_header_precision');
    for (const line of candidate.lines) {
      validate(line.quantity, 4, maxQuantity, line.source_invoice_item_id, 'candidate_quantity_precision');
      validate(line.base_amount, 2, maxMoney, line.source_invoice_item_id, 'candidate_base_precision');
      validate(line.total_amount, 2, maxMoney, line.source_invoice_item_id, 'candidate_line_total_precision');
    }
  }

  private assertCorrectableSource(source: BalanceInvoice): void {
    if (!['sales_invoice', 'export_invoice', 'purchase_invoice'].includes(source.invoice_type)) {
      throw this.sourceException(source.id, undefined, 'source_invoice_type_not_correctable');
    }
  }

  private async canReleaseReservation(
    tx: Prisma.TransactionClient,
    note: BalanceInvoice,
    release: CreditNoteReleaseEvidence,
  ): Promise<boolean> {
    if (release === 'none' || note.credit_limit_reserved_at === null) return false;
    if (
      note.status === 'accepted' ||
      note.dian_status === 'accepted' ||
      note.transmission_status === 'accepted' ||
      note.accepted_at !== null
    ) {
      return false;
    }
    const ledgerRows = await tx.fiscal_transmissions.findMany({
      where: {
        organization_id: note.organization_id,
        store_id: note.store_id,
        accounting_entity_id: note.accounting_entity_id,
        document_type: 'credit_note',
        source_type: 'invoice',
        source_id: note.id,
      },
      select: TRANSMISSION_SELECT,
    });
    if (
      ledgerRows.some(
        (row) =>
          row.transmission_status === 'accepted' ||
          row.dian_status === 'accepted' ||
          row.accepted_at !== null,
      )
    ) {
      return false;
    }
    if (release === 'definitive_rejection') {
      const definitive = ledgerRows.some(
        (row) =>
          row.transmission_status === 'rejected' &&
          row.dian_status === 'rejected' &&
          row.rejected_at !== null,
      );
      const uncertainOther = ledgerRows.some((row) => {
        const rejectedDefinitively =
          row.transmission_status === 'rejected' &&
          row.dian_status === 'rejected' &&
          row.rejected_at !== null;
        if (rejectedDefinitively) return false;
        return (
          ACTIVE_TRANSMISSION_STATUSES.has(row.transmission_status) ||
          row.sent_at !== null ||
          row.accepted_at !== null
        );
      });
      return definitive && !uncertainOther;
    }
    const noteWasSubmitted =
      note.sent_at !== null ||
      note.accepted_at !== null ||
      note.status === 'sent' ||
      EVER_SUBMITTED_STATUSES.has(note.transmission_status);
    const ledgerWasSubmitted = ledgerRows.some(
      (row) =>
        row.sent_at !== null ||
        row.accepted_at !== null ||
        EVER_SUBMITTED_STATUSES.has(row.transmission_status),
    );
    const claimStillPossible =
      ACTIVE_TRANSMISSION_STATUSES.has(note.transmission_status) ||
      ledgerRows.some((row) => ACTIVE_TRANSMISSION_STATUSES.has(row.transmission_status));
    return !noteWasSubmitted && !ledgerWasSubmitted && !claimStillPossible;
  }

  private assertSameFiscalEntity(
    source: BalanceInvoice,
    note: BalanceInvoice,
  ): void {
    if (
      note.related_invoice_id !== source.id ||
      note.organization_id !== source.organization_id ||
      note.store_id !== source.store_id ||
      note.accounting_entity_id !== source.accounting_entity_id
    ) {
      throw this.sourceException(source.id, undefined, 'source_tenant_or_entity_mismatch');
    }
  }

  private async assertSourceAccepted(
    source: BalanceInvoice,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (
      source.status === 'accepted' ||
      source.dian_status === 'accepted' ||
      source.transmission_status === 'accepted' ||
      source.accepted_at !== null
    ) {
      return;
    }
    const args = {
      where: {
        organization_id: source.organization_id,
        store_id: source.store_id,
        accounting_entity_id: source.accounting_entity_id,
        source_type: 'invoice',
        source_id: source.id,
        transmission_status: fiscal_transmission_status_enum.accepted,
        dian_status: dian_document_status_enum.accepted,
      },
      select: { id: true },
    } satisfies Prisma.fiscal_transmissionsFindFirstArgs;
    const ledger = tx
      ? await tx.fiscal_transmissions.findFirst(args)
      : await this.prisma.withoutScope().fiscal_transmissions.findFirst(args);
    if (!ledger) {
      throw this.sourceException(source.id, undefined, 'source_invoice_not_accepted');
    }
  }

  private money(
    value: Prisma.Decimal.Value,
    parentId: number,
    sourceItemId?: number,
  ): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw this.sourceException(parentId, sourceItemId, 'invalid_persisted_amount');
    }
    if (!amount.isFinite() || amount.isNegative()) {
      throw this.sourceException(parentId, sourceItemId, 'invalid_persisted_amount');
    }
    return amount;
  }

  private candidateDecimal(
    value: Prisma.Decimal.Value,
    parentId: number,
    sourceItemId: number | undefined,
    reason: string,
  ): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw this.sourceException(parentId, sourceItemId, reason);
    }
    if (!amount.isFinite() || amount.isNegative()) {
      throw this.sourceException(parentId, sourceItemId, reason);
    }
    return amount;
  }

  private clampZero(value: Prisma.Decimal): Prisma.Decimal {
    return value.isNegative() ? ZERO : value;
  }

  private sourceException(
    parentInvoiceId: number | undefined,
    sourceItemId: number | undefined,
    reason: string,
  ): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.INVOICING_NOTE_SOURCE_001,
      'No se pudo demostrar la procedencia de la nota con los snapshots fiscales persistidos.',
      {
        parent_invoice_id: parentInvoiceId,
        source_invoice_item_id: sourceItemId,
        reason,
      },
    );
  }

  private stateException(noteId: number, reason: string): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.SYS_CONFLICT_001,
      'La nota cambió de estado y ya no admite esta transición.',
      { invoice_id: noteId, reason },
    );
  }

  private limitException(
    parentInvoiceId: number,
    sourceItemId: number | undefined,
    details: {
      remaining_total: Prisma.Decimal;
      remaining_quantity?: Prisma.Decimal;
      remaining_base?: Prisma.Decimal;
      attempted: Record<string, Prisma.Decimal>;
    },
  ): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.INVOICING_NOTE_LIMIT_001,
      'La nota crédito supera el saldo acreditable disponible.',
      {
        parent_invoice_id: parentInvoiceId,
        source_invoice_item_id: sourceItemId,
        remaining_total: details.remaining_total.toFixed(2),
        ...(details.remaining_quantity
          ? { remaining_quantity: details.remaining_quantity.toString() }
          : {}),
        ...(details.remaining_base
          ? { remaining_base: details.remaining_base.toFixed(2) }
          : {}),
        attempted: Object.fromEntries(
          Object.entries(details.attempted).map(([key, value]) => [key, value.toString()]),
        ),
      },
    );
  }
}

const TRANSMISSION_SELECT = {
  source_id: true,
  transmission_status: true,
  dian_status: true,
  sent_at: true,
  accepted_at: true,
  rejected_at: true,
} satisfies Prisma.fiscal_transmissionsSelect;

import { AccountMappingService } from '../../accounting/account-mappings/account-mapping.service';
import { FiscalScopeService } from '../../../../common/services/fiscal-scope.service';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { FiscalGateService } from '../../../../common/services/fiscal-gate.service';
import { Injectable, Module } from '@nestjs/common';
import { Prisma, invoices } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { lockHolderChangeOrder } from '../../orders/shared/holder-change-reservation';
import { HolderOperation } from './invoice-holder-change.types';

const ENTRY_INCLUDE = {
  accounting_entry_lines: { include: { account: true } },
};
type Entry = Prisma.accounting_entriesGetPayload<{
  include: typeof ENTRY_INCLUDE;
}>;

/** Saga-only accounting: source locks, journal and durable effect share one transaction. */
@Injectable()
export class HolderChangeAccountingService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly fiscalGate: FiscalGateService,
    private readonly mappings: AccountMappingService,
  ) {}
  private review(
    message = 'No se puede demostrar la conciliación contable de esta venta.',
  ): never {
    throw new VendixHttpException(
      ErrorCodes.CF_HOLDER_ACCOUNTING_REVIEW_REQUIRED,
      message,
    );
  }
  private async source(
    tx: Prisma.TransactionClient,
    original: invoices,
    orderId: number,
  ) {
    const owned = await tx.accounting_entries.findMany({
      where: {
        organization_id: original.organization_id,
        accounting_entity_id: original.accounting_entity_id,
        status: 'posted',
        source_type: 'invoice.validated',
        source_id: original.id,
      },
      include: ENTRY_INCLUDE,
    });
    if (owned.length === 1) return { kind: 'invoice' as const, entries: owned };
    if (owned.length > 1)
      this.review('La factura original tiene asientos duplicados históricos.');
    const payments = await tx.payments.findMany({
      where: { order_id: orderId },
      select: { id: true },
    });
    const entries = await tx.accounting_entries.findMany({
      where: {
        organization_id: original.organization_id,
        accounting_entity_id: original.accounting_entity_id,
        status: 'posted',
        OR: [
          { source_type: 'credit_sale.created', source_id: orderId },
          {
            source_type: 'payment.received',
            source_id: { in: payments.map((p) => p.id) },
          },
        ],
      },
      include: ENTRY_INCLUDE,
    });
    // Area shutdown must never discard an already recognized sale/reversal.
    if (!entries.length && !(await this.fiscalGate.isAreaEnabled(
      original.organization_id, original.store_id, 'accounting',
    ))) return { kind: 'disabled' as const, entries: [] as Entry[] };
    const taxes = await tx.invoice_taxes.findMany({
      where: { invoice_id: original.id }, select: { tax_type: true },
    });
    const types = [...new Set(taxes.map(t => t.tax_type ?? 'iva'))];
    const taxAccounts = new Set<string>();
    for (const prefix of new Set(entries.map(e => e.source_type))) {
      for (const type of types.length ? types : ['iva']) {
        const mapping = await this.mappings.getMapping(
          original.organization_id, `${prefix}.${type}_payable`, original.store_id,
        );
        if (!mapping) this.review('No se puede resolver el tributo de la venta original.');
        taxAccounts.add(mapping.account_code);
      }
      const legacy = await this.mappings.getMapping(
        original.organization_id, `${prefix}.vat_payable`, original.store_id,
      );
      if (legacy) taxAccounts.add(legacy.account_code);
    }
    // Derive the exact net fiscal sale, not gross cash/entry totals (tips/discounts differ).
    const recognized = entries.reduce(
      (sum, entry) =>
        sum.plus(
          entry.accounting_entry_lines.reduce((s, line) => {
            const code = line.account.code;
            if (
              code.startsWith('4') ||
              [...taxAccounts].some(account => code.startsWith(account))
            )
              return s.plus(line.credit_amount).minus(line.debit_amount);
            return s;
          }, new Prisma.Decimal(0)),
        ),
      new Prisma.Decimal(0),
    );
    if (
      !entries.length ||
      !recognized.equals(
        original.total_amount.plus(original.withholding_amount),
      )
    )
      this.review();
    return { kind: 'payment' as const, entries };
  }
  async preflight(
    tx: Prisma.TransactionClient,
    original: invoices,
    orderId: number,
  ) {
    await this.source(tx, original, orderId);
  }
  async preflightAdoptedCreditNote(op: HolderOperation, note: invoices) {
    await this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        op.original_order_id,
        op.store_id,
        op.organization_id,
      );
      await this.adoptedBalance(tx, op, note.id, true);
    });
  }
  private async adoptedBalance(
    tx: Prisma.TransactionClient,
    op: HolderOperation,
    noteId: number,
    reserve: boolean,
  ) {
    const entries = await tx.accounting_entries.findMany({
      where: {
        organization_id: op.organization_id,
        accounting_entity_id: op.accounting_entity_id,
        source_id: noteId,
        source_type: 'credit_note.accepted',
        status: 'posted',
      },
      include: ENTRY_INCLUDE,
    });
    if (!entries.length) return null;
    if (entries.length !== 1) this.review();
    const credits = entries[0].accounting_entry_lines.filter(
      (l) =>
        l.account.code.startsWith('2805') && l.credit_amount.greaterThan(0),
    );
    if (!credits.length) {
      const originalEntry = await tx.accounting_entries.findFirst({
        where: {
          organization_id: op.organization_id,
          accounting_entity_id: op.accounting_entity_id,
          source_id: op.original_invoice_id,
          source_type: 'invoice.validated',
          status: 'posted',
        },
        include: ENTRY_INCLUDE,
      });
      if (!originalEntry)
        this.review(
          'La nota previa no conserva un saldo demostrable por fuente.',
        );
      const inverse = entries[0].accounting_entry_lines;
      if (
        inverse.length !== originalEntry.accounting_entry_lines.length ||
        !originalEntry.accounting_entry_lines.every((l) =>
          inverse.some(
            (r) =>
              r.account_id === l.account_id &&
              r.debit_amount.equals(l.credit_amount) &&
              r.credit_amount.equals(l.debit_amount) &&
              r.third_party_id === l.third_party_id,
          ),
        )
      )
        this.review();
      return { entry: entries[0], credit: null };
    }
    if (credits.length !== 1)
      this.review(
        'La nota previa no conserva un saldo a favor demostrable por fuente.',
      );
    const credit = credits[0];
    const original = await tx.invoices.findFirst({
      where: {
        id: op.original_invoice_id,
        store_id: op.store_id,
        organization_id: op.organization_id,
      },
    });
    if (!original || !credit.credit_amount.equals(original.total_amount))
      this.review();
    // A debit after this source (even on the same customer's account) makes attribution ambiguous.
    // Never substitute a global 2805 balance for provenance.
    const consumed = await tx.accounting_entry_lines.findFirst({
      where: {
        account_id: credit.account_id,
        debit_amount: { gt: 0 },
        third_party_id: credit.third_party_id,
        entry: {
          organization_id: op.organization_id,
          accounting_entity_id: op.accounting_entity_id,
          status: 'posted',
          posted_at: {
            gte: entries[0].posted_at ?? entries[0].created_at ?? new Date(0),
          },
          NOT: { source_type: 'holder_change.replacement', source_id: op.id },
        },
      },
    });
    if (consumed)
      this.review(
        'El saldo de la nota previa fue consumido o no se puede atribuir con certeza.',
      );
    if (reserve) {
      const effect =
        await tx.invoice_holder_change_accounting_effects.findFirst({
          where: {
            operation_id: op.id,
            role: 'replacement',
            store_id: op.store_id,
            organization_id: op.organization_id,
          },
        });
      if (!effect) this.review();
      await tx.invoice_holder_change_accounting_effects.updateMany({
        where: {
          id: effect.id,
          store_id: op.store_id,
          organization_id: op.organization_id,
        },
        data: {
          source_credit_note_id: noteId,
          clearing_amount: credit.credit_amount,
        },
      });
    }
    return { entry: entries[0], credit };
  }
  async handlesInvoice(invoiceId: number, organizationId: number) {
    return !!(await this.prisma.invoice_holder_changes.findFirst({
      where: {
        organization_id: organizationId,
        OR: [{ credit_note_id: invoiceId }, { new_invoice_id: invoiceId }],
      },
      select: { id: true },
    }));
  }
  async reconcileCreditNote(op: HolderOperation) {
    try {
      await this.apply(op, 'credit_note');
    } catch (error) {
      await this.prisma.invoice_holder_change_accounting_effects.updateMany({
        where: {
          operation_id: op.id,
          role: 'credit_note',
          store_id: op.store_id,
          organization_id: op.organization_id,
          state: { notIn: ['posted', 'skipped'] },
        },
        data: {
          state: 'failed',
          error_code: 'CF_HOLDER_ACCOUNTING_RETRY',
          error_message: 'Nota aceptada con conciliación pendiente.',
          attempt_count: { increment: 1 },
          next_retry_at: new Date(Date.now() + 60000),
        },
      });
    }
  }
  async reconcile(op: HolderOperation) {
    for (const role of ['credit_note', 'replacement'] as const) {
      try {
        await this.apply(op, role);
      } catch (error) {
        await this.prisma.invoice_holder_change_accounting_effects.updateMany({
          where: {
            operation_id: op.id,
            role,
            store_id: op.store_id,
            organization_id: op.organization_id,
            state: { notIn: ['posted', 'skipped'] },
          },
          data: {
            state: 'failed',
            error_code:
              error instanceof VendixHttpException
                ? error.errorCode
                : 'CF_HOLDER_ACCOUNTING_RETRY',
            error_message:
              'No se completó la conciliación. El documento fiscal no se volverá a transmitir.',
            attempt_count: { increment: 1 },
            next_retry_at: new Date(Date.now() + 60000),
          },
        });
        return false;
      }
    }
    return true;
  }
  private async apply(
    op: HolderOperation,
    role: 'credit_note' | 'replacement',
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockHolderChangeOrder(
        tx,
        op.original_order_id,
        op.store_id,
        op.organization_id,
      );
      const effect =
        await tx.invoice_holder_change_accounting_effects.findFirst({
          where: {
            operation_id: op.id,
            role,
            store_id: op.store_id,
            organization_id: op.organization_id,
          },
        });
      if (!effect) this.review();
      if (['posted', 'skipped'].includes(effect.state)) return;
      const original = await tx.invoices.findFirst({
        where: {
          id: op.original_invoice_id,
          organization_id: op.organization_id,
          store_id: op.store_id,
          accounting_entity_id: op.accounting_entity_id,
        },
      });
      if (!original) this.review();
      const documentId =
        role === 'credit_note' ? op.credit_note_id : op.new_invoice_id;
      const document = documentId
        ? await tx.invoices.findFirst({
            where: {
              id: documentId,
              organization_id: op.organization_id,
              store_id: op.store_id,
              accounting_entity_id: op.accounting_entity_id,
            },
          })
        : null;
      if (documentId && document?.status !== 'accepted')
        this.review('El efecto requiere aceptación fiscal.');
      const sources = await this.source(tx, original, op.original_order_id);
      const adopted = op.credit_note_id
        ? await this.adoptedBalance(
            tx,
            op,
            op.credit_note_id,
            role === 'replacement',
          )
        : null;
      if (
        !documentId ||
        sources.kind === 'disabled' ||
        (sources.kind === 'payment' && !adopted)
      ) {
        await tx.invoice_holder_change_accounting_effects.updateMany({
          where: {
            id: effect.id,
            organization_id: op.organization_id,
            store_id: op.store_id,
          },
          data: {
            state: 'skipped',
            invoice_id: documentId,
            applied_at: new Date(),
            error_code: null,
            error_message: !documentId
              ? 'no_credit_note_required'
              : sources.kind === 'disabled'
                ? 'accounting_area_disabled'
                : 'sale_already_recognized_by_payment',
            next_retry_at: null,
          },
        });
        if (documentId)
          await tx.invoices.updateMany({
            where: {
              id: documentId,
              organization_id: op.organization_id,
              store_id: op.store_id,
            },
            data: { accounting_status: 'not_applicable' },
          });
        return;
      }
      if (role === 'credit_note' && adopted) {
        await tx.invoice_holder_change_accounting_effects.updateMany({
          where: {
            id: effect.id,
            organization_id: op.organization_id,
            store_id: op.store_id,
          },
          data: {
            state: 'posted',
            invoice_id: documentId,
            accounting_entry_id: adopted.entry.id,
            applied_at: new Date(),
          },
        });
        return;
      }
      const template = sources.entries[0];
      if (!template) this.review();
      const period = await tx.fiscal_periods.findFirst({
        where: {
          organization_id: op.organization_id,
          accounting_entity_id: op.accounting_entity_id,
          status: 'open',
          start_date: { lte: new Date() },
          end_date: { gte: new Date() },
        },
      });
      if (!period) this.review('Abre el período contable antes de conciliar.');
      type Line = Prisma.accounting_entry_linesCreateManyInput;
      let lines: Omit<Line, 'entry_id'>[] = [];
      if (adopted?.credit && role === 'replacement') {
        // Restore exactly the revenue/tax sources reversed by THIS NC; apply its 2805, never cash.
        lines = adopted.entry.accounting_entry_lines
          .filter((l) => !l.account.code.startsWith('2805'))
          .map((l) => ({
            account_id: l.account_id,
            description: 'Refacturación: reposición del hecho económico',
            debit_amount: l.credit_amount,
            credit_amount: l.debit_amount,
            third_party_id: op.target_customer_id,
            third_party_type: 'customer',
            third_party_name: document?.customer_name,
            third_party_tax_id: document?.customer_tax_id,
          }));
        lines.push({
          account_id: adopted.credit.account_id,
          debit_amount: adopted.credit.credit_amount,
          credit_amount: new Prisma.Decimal(0),
          third_party_id: adopted.credit.third_party_id,
          third_party_type: adopted.credit.third_party_type,
          third_party_name: adopted.credit.third_party_name,
          third_party_tax_id: adopted.credit.third_party_tax_id,
        });
      } else {
        lines = template.accounting_entry_lines.map((l) => ({
          account_id: l.account_id,
          description: `Cambio titular: ${role}`,
          debit_amount:
            role === 'credit_note' ? l.credit_amount : l.debit_amount,
          credit_amount:
            role === 'credit_note' ? l.debit_amount : l.credit_amount,
          third_party_id:
            role === 'replacement' && l.account.code.startsWith('4')
              ? op.target_customer_id
              : l.third_party_id,
          third_party_type: l.third_party_type,
          third_party_name:
            role === 'replacement' && l.account.code.startsWith('4')
              ? document?.customer_name
              : l.third_party_name,
          third_party_tax_id:
            role === 'replacement' && l.account.code.startsWith('4')
              ? document?.customer_tax_id
              : l.third_party_tax_id,
        }));
      }
      const debit = lines.reduce(
        (s, l) => s.plus(l.debit_amount?.toString() ?? 0),
        new Prisma.Decimal(0),
      );
      const credit = lines.reduce(
        (s, l) => s.plus(l.credit_amount?.toString() ?? 0),
        new Prisma.Decimal(0),
      );
      if (!debit.equals(credit) || debit.lte(0)) this.review();
      const entry = await tx.accounting_entries.create({
        data: {
          organization_id: op.organization_id,
          store_id: op.store_id,
          accounting_entity_id: op.accounting_entity_id,
          entry_number: `HC-${op.id}-${role === 'credit_note' ? 'NC' : 'FE'}`,
          entry_type: 'auto_invoice',
          status: 'posted',
          fiscal_period_id: period.id,
          entry_date: new Date(),
          description: `Cambio de titular #${op.id}: ${role}`,
          source_type: `holder_change.${role}`,
          source_id: op.id,
          total_debit: debit,
          total_credit: credit,
          created_by_user_id: op.created_by_user_id,
          posted_by_user_id: op.created_by_user_id,
          posted_at: new Date(),
          accounting_entry_lines: { create: lines },
        },
      });
      await tx.invoices.updateMany({
        where: {
          id: documentId!,
          organization_id: op.organization_id,
          store_id: op.store_id,
        },
        data: { accounting_status: 'posted', accounting_entry_id: entry.id },
      });
      await tx.invoice_holder_change_accounting_effects.updateMany({
        where: {
          id: effect.id,
          organization_id: op.organization_id,
          store_id: op.store_id,
        },
        data: {
          state: 'posted',
          invoice_id: documentId,
          accounting_entry_id: entry.id,
          applied_at: new Date(),
          error_code: null,
          error_message: null,
          next_retry_at: null,
        },
      });
    });
  }
}

@Module({
  imports: [PrismaModule],
  providers: [HolderChangeAccountingService, AccountMappingService, FiscalScopeService],
  exports: [HolderChangeAccountingService],
})
export class HolderChangeAccountingModule {}

import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  buildPurchaseVatContributionSnapshot,
  PurchaseVatContributionSnapshotInput,
} from './purchase-vat-contribution-snapshot.util';

function normalizedText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function dateOnly(value: Date | null): string | null {
  if (value == null) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class PurchaseVatContributionService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async reserve(input: PurchaseVatContributionSnapshotInput) {
    const snapshot = buildPurchaseVatContributionSnapshot(input);

    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const store = await tx.stores.findFirst({
          where: { id: snapshot.store_id, organization_id: snapshot.organization_id },
          select: { id: true },
        });
        if (!store) throw new ConflictException('Store does not belong to the snapshot organization');

        const po = await tx.purchase_orders.findFirst({
          where: {
            id: snapshot.purchase_order_id,
            organization_id: snapshot.organization_id,
            supplier_id: snapshot.supplier_id,
          },
          select: { id: true, organization_id: true, supplier_id: true, supplier_invoice_number: true, supplier_invoice_date: true, location: { select: { store_id: true } } },
        });
        if (!po) throw new ConflictException('Purchase order does not match the snapshot organization and supplier');
        if (normalizedText(po.supplier_invoice_number) !== snapshot.invoice_number_snapshot ||
          dateOnly(po.supplier_invoice_date) !== snapshot.invoice_issue_date_snapshot) {
          throw new ConflictException('Invoice number or issue date does not match the purchase order source');
        }
        if (po.location?.store_id != null && po.location.store_id !== snapshot.store_id) {
          throw new ConflictException('Purchase order location does not belong to the snapshot store');
        }

        const reception = await tx.purchase_order_receptions.findFirst({
          where: { id: snapshot.reception_id, purchase_order_id: snapshot.purchase_order_id },
          select: { id: true },
        });
        if (!reception) throw new ConflictException('Reception does not belong to the purchase order');

        const supplier = await tx.suppliers.findFirst({
          where: { id: snapshot.supplier_id, organization_id: snapshot.organization_id },
          select: { id: true, tax_id: true },
        });
        if (!supplier) throw new ConflictException('Supplier does not belong to the snapshot organization');
        if (normalizedText(supplier.tax_id) !== snapshot.supplier_tax_id_snapshot) {
          throw new ConflictException('Supplier tax ID does not match the snapshot source');
        }

        const entity = await tx.accounting_entities.findFirst({
          where: { id: snapshot.accounting_entity_id, organization_id: snapshot.organization_id, is_active: true },
          select: { id: true, fiscal_scope: true, store_id: true },
        });
        if (!entity ||
          (entity.fiscal_scope === 'STORE' && entity.store_id !== snapshot.store_id) ||
          (entity.fiscal_scope === 'ORGANIZATION' && entity.store_id !== null)) {
          throw new ConflictException('Accounting entity is inactive or does not match the organization/store fiscal scope');
        }

        const keyWhere = {
          organization_id_accounting_entity_id_source_effect_key: {
            organization_id: snapshot.organization_id,
            accounting_entity_id: snapshot.accounting_entity_id,
            source_effect_key: snapshot.source_effect_key,
          },
        };
        const existing = await tx.purchase_vat_contributions.findUnique({ where: keyWhere });
        if (existing) return this.assertReplay(existing, snapshot.payload_hash);

        return tx.purchase_vat_contributions.create({
          data: {
            organization_id: snapshot.organization_id,
            accounting_entity_id: snapshot.accounting_entity_id,
            store_id: snapshot.store_id,
            purchase_order_id: snapshot.purchase_order_id,
            reception_id: snapshot.reception_id,
            supplier_id: snapshot.supplier_id,
            supplier_tax_id_snapshot: snapshot.supplier_tax_id_snapshot,
            invoice_number_snapshot: snapshot.invoice_number_snapshot,
            invoice_issue_date_snapshot: snapshot.invoice_issue_date_snapshot
              ? new Date(`${snapshot.invoice_issue_date_snapshot}T00:00:00.000Z`)
              : null,
            currency: snapshot.currency,
            net_amount: new Prisma.Decimal(snapshot.net_amount),
            iva_amount: new Prisma.Decimal(snapshot.iva_amount),
            tax_groups_snapshot: snapshot.tax_groups_snapshot as Prisma.InputJsonValue,
            source_effect_key: snapshot.source_effect_key,
            payload_hash: snapshot.payload_hash,
            ledger_status: 'pending',
            fiscal_status: 'awaiting_document',
          },
        });
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const raced = await this.prisma.purchase_vat_contributions.findUnique({
        where: {
          organization_id_accounting_entity_id_source_effect_key: {
            organization_id: snapshot.organization_id,
            accounting_entity_id: snapshot.accounting_entity_id,
            source_effect_key: snapshot.source_effect_key,
          },
        },
      });
      if (!raced) throw error;
      return this.assertReplay(raced, snapshot.payload_hash);
    }
  }

  private assertReplay<T extends { payload_hash: string }>(existing: T, payloadHash: string): T {
    if (existing.payload_hash !== payloadHash) {
      throw new ConflictException('Purchase VAT contribution source was already reserved with a different payload');
    }
    return existing;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}

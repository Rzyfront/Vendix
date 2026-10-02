import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import {
  projectReceivedDocumentAccountingEvidence,
  ReceivedDocumentAccountingEntryEvidence,
  ReceivedDocumentExpectedAccountingReference,
} from './received-document-accounting-evidence';

@Injectable()
export class ReceivedDocumentAccountingEvidenceService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly documents: ReceivedDocumentsService,
  ) {}

  async list(context: ReceivedDocumentsContext, documentId: number) {
    // This guard resolves tenant, accounting entity, and store ownership before raw global reads.
    await this.documents.findOne(context, documentId);

    const allocations = await this.prisma.received_document_match_allocations.findMany({
      where: {
        document_id: documentId,
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        status: 'active',
        ...(context.store_id == null ? {} : { store_id: context.store_id }),
      },
      select: { id: true, reception_id: true, expense_id: true, purchase_order_id: true },
    });

    const expectedReferences: ReceivedDocumentExpectedAccountingReference[] = [];
    const unresolvedAllocationIds: number[] = [];
    for (const allocation of allocations) {
      let resolved = false;
      if (allocation.reception_id != null) {
        expectedReferences.push({
          source_type: 'purchase_order.received',
          source_id: allocation.reception_id,
          accounting_entity_id: context.accounting_entity_id,
        });
        resolved = true;
      }
      if (allocation.expense_id != null) {
        expectedReferences.push({
          source_type: 'expense.approved',
          source_id: allocation.expense_id,
          accounting_entity_id: context.accounting_entity_id,
        });
        resolved = true;
      }
      if (!resolved) unresolvedAllocationIds.push(allocation.id);
    }

    const uniqueReferences = new Map<string, ReceivedDocumentExpectedAccountingReference>();
    for (const reference of expectedReferences) {
      uniqueReferences.set(JSON.stringify([reference.source_type, reference.source_id, reference.accounting_entity_id]), reference);
    }
    const references = [...uniqueReferences.values()];
    const sourcePairs: Prisma.accounting_entriesWhereInput[] = references.map((reference) => ({
      source_type: reference.source_type,
      source_id: reference.source_id,
    }));
    const entries = sourcePairs.length
      ? await this.prisma.accounting_entries.findMany({
          where: { organization_id: context.organization_id, OR: sourcePairs },
          select: {
            id: true,
            source_type: true,
            source_id: true,
            accounting_entity_id: true,
            status: true,
          },
        })
      : [];
    const typedEntries: ReceivedDocumentAccountingEntryEvidence[] = entries.flatMap((entry) =>
      entry.source_type != null && entry.source_id != null
        ? [{
            id: entry.id,
            source_type: entry.source_type,
            source_id: entry.source_id,
            accounting_entity_id: entry.accounting_entity_id,
            status: entry.status,
          }]
        : [],
    );
    const projected = projectReceivedDocumentAccountingEvidence({
      accounting_entity_id: context.accounting_entity_id,
      expected_references: references,
      accounting_entries: typedEntries,
    });

    const payableEvidence = await this.projectPayableEvidence(context, allocations);
    const unresolvedTaxPurchaseOrders = await this.findUnresolvedTaxPurchaseOrders(
      context,
      allocations.flatMap((allocation) => allocation.purchase_order_id == null ? [] : [allocation.purchase_order_id]),
    );
    const payableEvidenceComplete = payableEvidence.length === 0
      ? null
      : payableEvidence.every((item) => item.status === 'linked');
    const ledgerEvidenceComplete = projected.complete
      && unresolvedAllocationIds.length === 0
      && unresolvedTaxPurchaseOrders.unresolved_tax_purchase_order_ids.length === 0;

    return {
      ledger_evidence_complete: ledgerEvidenceComplete,
      evidence: projected.evidence,
      unresolved_allocation_ids: unresolvedAllocationIds,
      payable_evidence: payableEvidence,
      payable_evidence_complete: payableEvidenceComplete,
      unresolved_tax_purchase_order_ids: unresolvedTaxPurchaseOrders.unresolved_tax_purchase_order_ids,
      unresolved_vat_purchase_order_ids: unresolvedTaxPurchaseOrders.unresolved_vat_purchase_order_ids,
      financial_evidence_complete: ledgerEvidenceComplete && payableEvidenceComplete !== false,
      fiscal_eligibility: 'pending' as const,
    };
  }

  private async projectPayableEvidence(
    context: ReceivedDocumentsContext,
    allocations: Array<{ reception_id: number | null; purchase_order_id: number | null }>,
  ) {
    const receptionIds = [...new Set(allocations.flatMap((allocation) => allocation.reception_id == null ? [] : [allocation.reception_id]))];
    if (receptionIds.length === 0) return [];

    const mappedOrderIds = [...new Set(allocations.flatMap((allocation) => allocation.purchase_order_id == null ? [] : [allocation.purchase_order_id]))];
    const orders = await this.prisma.purchase_orders.findMany({
      where: { organization_id: context.organization_id, OR: [
        ...(mappedOrderIds.length ? [{ id: { in: mappedOrderIds } }] : []),
        { receptions: { some: { id: { in: receptionIds } } } },
      ] },
      select: {
        id: true, organization_id: true, supplier_id: true,
        receptions: {
          where: { id: { in: receptionIds } },
          select: {
            id: true,
            purchase_order_id: true,
            ap_reception_link: {
              select: {
                id: true,
                gross_amount: true,
                accounts_payable: { select: { id: true, organization_id: true, store_id: true, supplier_id: true, source_type: true, source_id: true, currency: true } },
              },
            },
          },
        },
      },
    });
    const receptionById = new Map(orders.flatMap((order) => order.receptions.map((reception) => [reception.id, reception] as const)));
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const allocationsByReception = new Map<number, number[]>();
    const receptionsWithMissingOrderMapping = new Set<number>();
    for (const allocation of allocations) {
      if (allocation.reception_id != null) {
        const orderIds = allocationsByReception.get(allocation.reception_id) ?? [];
        if (allocation.purchase_order_id != null) orderIds.push(allocation.purchase_order_id);
        else receptionsWithMissingOrderMapping.add(allocation.reception_id);
        allocationsByReception.set(allocation.reception_id, orderIds);
      }
    }
    return receptionIds.map((receptionId) => {
      const mappedOrderIds = [...new Set(allocationsByReception.get(receptionId) ?? [])];
      const allocationOrderId = mappedOrderIds.length === 1 ? mappedOrderIds[0] : null;
      const reception = receptionById.get(receptionId);
      if (!reception) return { reception_id: receptionId, purchase_order_id: allocationOrderId, status: 'missing' as const };
      if (receptionsWithMissingOrderMapping.has(receptionId) || mappedOrderIds.length !== 1) {
        return { reception_id: receptionId, purchase_order_id: allocationOrderId, status: 'invalid_source' as const };
      }
      const purchaseOrderId = allocationOrderId;
      const order = purchaseOrderId == null ? undefined : orderById.get(purchaseOrderId);
      if (!order) return { reception_id: receptionId, purchase_order_id: purchaseOrderId, status: 'foreign_scope' as const };
      if (order.organization_id !== context.organization_id) {
        return { reception_id: receptionId, purchase_order_id: purchaseOrderId, status: 'foreign_scope' as const };
      }
      if (reception.purchase_order_id !== purchaseOrderId) {
        return { reception_id: receptionId, purchase_order_id: purchaseOrderId, status: 'invalid_source' as const };
      }
      const link = reception.ap_reception_link;
      if (!link) return { reception_id: receptionId, purchase_order_id: purchaseOrderId, status: 'missing' as const };
      const payable = link.accounts_payable;
      if (payable.organization_id !== context.organization_id || (context.store_id != null && payable.store_id !== context.store_id)) {
        return { reception_id: receptionId, purchase_order_id: purchaseOrderId, status: 'foreign_scope' as const };
      }
      if (payable.supplier_id !== order.supplier_id || payable.source_type !== 'purchase_order' || payable.source_id !== purchaseOrderId) {
        return { reception_id: receptionId, purchase_order_id: purchaseOrderId, status: 'invalid_source' as const };
      }
      return {
        reception_id: receptionId,
        purchase_order_id: purchaseOrderId,
        status: 'linked' as const,
        accounts_payable_id: payable.id,
        ap_reception_link_id: link.id,
        gross_amount: link.gross_amount.toString(),
        currency: payable.currency,
      };
    });
  }

  private async findUnresolvedTaxPurchaseOrders(
    context: ReceivedDocumentsContext,
    purchaseOrderIds: number[],
  ): Promise<{ unresolved_tax_purchase_order_ids: number[]; unresolved_vat_purchase_order_ids: number[] }> {
    const ids = [...new Set(purchaseOrderIds)];
    if (ids.length === 0) return { unresolved_tax_purchase_order_ids: [], unresolved_vat_purchase_order_ids: [] };
    const orders = await this.prisma.purchase_orders.findMany({
      where: { id: { in: ids }, organization_id: context.organization_id },
      select: { id: true, purchase_order_items: { select: { tax_type: true, deductible_tax_amount: true } } },
    });
    const ordersWithPositiveDeductibleTax = orders.filter((order) => order.purchase_order_items.some((item) =>
      item.deductible_tax_amount != null && item.deductible_tax_amount.greaterThan(0)));
    const sortedIds = (rows: typeof orders) => rows.map((order) => order.id).sort((a, b) => a - b);
    return {
      unresolved_tax_purchase_order_ids: sortedIds(ordersWithPositiveDeductibleTax),
      unresolved_vat_purchase_order_ids: sortedIds(ordersWithPositiveDeductibleTax.filter((order) =>
        order.purchase_order_items.some((item) =>
          (item.tax_type == null || item.tax_type.toLowerCase() === 'iva')
          && item.deductible_tax_amount != null && item.deductible_tax_amount.greaterThan(0)))),
    };
  }
}

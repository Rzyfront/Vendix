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
      select: { id: true, reception_id: true, expense_id: true },
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

    return {
      ledger_evidence_complete: projected.complete && unresolvedAllocationIds.length === 0,
      evidence: projected.evidence,
      unresolved_allocation_ids: unresolvedAllocationIds,
      fiscal_eligibility: 'pending' as const,
    };
  }
}

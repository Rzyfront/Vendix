import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedDocumentAccountingEvidenceService } from './received-document-accounting-evidence.service';

describe('ReceivedDocumentAccountingEvidenceService', () => {
  const context: ReceivedDocumentsContext = {
    organization_id: 5,
    accounting_entity_id: 7,
    store_id: 11,
    is_organization: false,
  };
  let documents: { findOne: jest.Mock<Promise<{ id: number }>, [ReceivedDocumentsContext, number]> };
  let allocations: jest.Mock;
  let entries: jest.Mock;
  let service: ReceivedDocumentAccountingEvidenceService;

  beforeEach(() => {
    documents = { findOne: jest.fn().mockResolvedValue({ id: 42 }) };
    allocations = jest.fn().mockResolvedValue([]);
    entries = jest.fn().mockResolvedValue([]);
    const prisma = {
      received_document_match_allocations: { findMany: allocations },
      accounting_entries: { findMany: entries },
    } as unknown as GlobalPrismaService;
    service = new ReceivedDocumentAccountingEvidenceService(
      prisma,
      documents as unknown as ReceivedDocumentsService,
    );
  });

  it('enforces document scope first, then queries active allocations within org/entity/store without writes', async () => {
    allocations.mockResolvedValue([{ id: 1, reception_id: 31, expense_id: null }]);
    entries.mockResolvedValue([{ id: 90, source_type: 'purchase_order.received', source_id: 31, accounting_entity_id: 7, status: 'posted' }]);
    const result = await service.list(context, 42);

    expect(documents.findOne).toHaveBeenCalledWith(context, 42);
    expect(allocations.mock.invocationCallOrder[0]).toBeGreaterThan(documents.findOne.mock.invocationCallOrder[0]);
    expect(allocations).toHaveBeenCalledWith(expect.objectContaining({ where: {
      document_id: 42, organization_id: 5, accounting_entity_id: 7, status: 'active', store_id: 11,
    } }));
    expect(entries).toHaveBeenCalledWith(expect.objectContaining({ where: {
      organization_id: 5,
      OR: [{ source_type: 'purchase_order.received', source_id: 31 }],
    } }));
    expect(result).toEqual({
      ledger_evidence_complete: true,
      evidence: [{ reference: { source_type: 'purchase_order.received', source_id: 31, accounting_entity_id: 7 }, status: 'linked', accounting_entry_id: 90 }],
      unresolved_allocation_ids: [],
      fiscal_eligibility: 'pending',
    });
  });

  it('keeps separate partial receipt references, deduplicates repeats, and includes expenses', async () => {
    allocations.mockResolvedValue([
      { id: 1, reception_id: 31, expense_id: null },
      { id: 2, reception_id: 32, expense_id: null },
      { id: 3, reception_id: 31, expense_id: null },
      { id: 4, reception_id: null, expense_id: 80 },
    ]);
    entries.mockResolvedValue([
      { id: 1, source_type: 'purchase_order.received', source_id: 31, accounting_entity_id: 7, status: 'posted' },
      { id: 2, source_type: 'purchase_order.received', source_id: 32, accounting_entity_id: 7, status: 'posted' },
      { id: 3, source_type: 'expense.approved', source_id: 80, accounting_entity_id: 7, status: 'posted' },
    ]);
    const result = await service.list(context, 42);
    expect(result.ledger_evidence_complete).toBe(true);
    expect(result.evidence).toHaveLength(3);
    expect(entries.mock.calls[0][0].where.OR).toHaveLength(3);
    expect(entries.mock.calls[0][0].where.OR).not.toContainEqual({ source_type: 'purchase_vat', source_id: 31 });
  });

  it('reports missing, foreign entity, draft, ambiguous, and unresolved allocation evidence as incomplete', async () => {
    allocations.mockResolvedValue([
      { id: 1, reception_id: 31, expense_id: null },
      { id: 2, reception_id: 32, expense_id: null },
      { id: 3, reception_id: 33, expense_id: null },
      { id: 4, reception_id: 34, expense_id: null },
      { id: 5, reception_id: null, expense_id: null },
    ]);
    entries.mockResolvedValue([
      { id: 2, source_type: 'purchase_order.received', source_id: 32, accounting_entity_id: 8, status: 'posted' },
      { id: 3, source_type: 'purchase_order.received', source_id: 33, accounting_entity_id: 7, status: 'draft' },
      { id: 4, source_type: 'purchase_order.received', source_id: 34, accounting_entity_id: 7, status: 'posted' },
      { id: 5, source_type: 'purchase_order.received', source_id: 34, accounting_entity_id: 7, status: 'voided' },
    ]);
    const result = await service.list(context, 42);
    expect(result.ledger_evidence_complete).toBe(false);
    expect(result.evidence.map((item) => item.status)).toEqual(['missing', 'foreign_entity', 'not_posted', 'ambiguous']);
    expect(result.unresolved_allocation_ids).toEqual([5]);
  });

  it('does not query entries or allocations when scoped document lookup rejects', async () => {
    documents.findOne.mockRejectedValue(new Error('not found'));
    await expect(service.list(context, 42)).rejects.toThrow('not found');
    expect(allocations).not.toHaveBeenCalled();
    expect(entries).not.toHaveBeenCalled();
  });
});

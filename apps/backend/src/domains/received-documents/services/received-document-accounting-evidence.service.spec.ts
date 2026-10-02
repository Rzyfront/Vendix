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
  let receptions: jest.Mock;
  let orders: jest.Mock;
  let service: ReceivedDocumentAccountingEvidenceService;

  beforeEach(() => {
    documents = { findOne: jest.fn().mockResolvedValue({ id: 42 }) };
    allocations = jest.fn().mockResolvedValue([]);
    entries = jest.fn().mockResolvedValue([]);
    receptions = jest.fn().mockResolvedValue([]);
    orders = jest.fn().mockResolvedValue([]);
    const prisma = {
      received_document_match_allocations: { findMany: allocations },
      accounting_entries: { findMany: entries },
      purchase_order_receptions: { findMany: receptions },
      purchase_orders: { findMany: orders },
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
      payable_evidence: [{ reception_id: 31, purchase_order_id: null, status: 'missing' }],
      payable_evidence_complete: false,
      unresolved_tax_purchase_order_ids: [],
      unresolved_vat_purchase_order_ids: [],
      financial_evidence_complete: false,
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

  const decimal = (value: number) => ({ greaterThan: (other: number) => value > other, toString: () => String(value) });
  const reception = (id: number, purchase_order_id = 51, ap?: Record<string, unknown> | null) => ({
    id, purchase_order_id,
    ap_reception_link: ap ? {
      id: 70 + id, gross_amount: decimal(125), accounts_payable: {
        id: 90 + id, organization_id: 5, store_id: 11, supplier_id: 62,
        source_type: 'purchase_order', source_id: purchase_order_id, currency: 'COP', ...ap,
      },
    } : null,
  });
  const order = (id = 51, items: Array<{ tax_type: string | null; deductible_tax_amount: ReturnType<typeof decimal> | null }> = []) => ({
    id, organization_id: 5, supplier_id: 62, location: { store_id: null }, purchase_order_items: items, receptions: [] as ReturnType<typeof reception>[],
  });

  it('links AP only when allocation, reception, supplier and source agree; central warehouse is valid', async () => {
    allocations.mockResolvedValue([{ id: 1, reception_id: 31, expense_id: null, purchase_order_id: 51 }]);
    entries.mockResolvedValue([{ id: 90, source_type: 'purchase_order.received', source_id: 31, accounting_entity_id: 7, status: 'posted' }]);
    receptions.mockResolvedValue([reception(31, 51, {})]);
    orders.mockResolvedValue([{ ...order(), receptions: [reception(31, 51, {})] }]);
    const result = await service.list(context, 42);
    expect(result.payable_evidence).toEqual([{
      reception_id: 31, purchase_order_id: 51, status: 'linked', accounts_payable_id: 121,
      ap_reception_link_id: 101, gross_amount: '125', currency: 'COP',
    }]);
    expect(result.payable_evidence_complete).toBe(true);
    expect(result.financial_evidence_complete).toBe(true);
    expect(orders.mock.calls[0][0].where.organization_id).toBe(5);
  });

  it('accepts a payable scoped to the organization when the context has no selected store', async () => {
    const organizationContext: ReceivedDocumentsContext = { ...context, store_id: null, is_organization: true };
    allocations.mockResolvedValue([{ id: 1, reception_id: 31, expense_id: null, purchase_order_id: 51 }]);
    entries.mockResolvedValue([{ id: 90, source_type: 'purchase_order.received', source_id: 31, accounting_entity_id: 7, status: 'posted' }]);
    orders.mockResolvedValue([{ ...order(), receptions: [reception(31, 51, {})] }]);
    const result = await service.list(organizationContext, 42);
    expect(result.payable_evidence[0].status).toBe('linked');
    expect(result.financial_evidence_complete).toBe(true);
  });

  it.each([
    ['missing AP', null],
    ['foreign organization', { organization_id: 6 }],
    ['foreign store', { store_id: 12 }],
    ['supplier mismatch', { supplier_id: 63 }],
    ['source mismatch', { source_id: 99 }],
    ['source type mismatch', { source_type: 'expense' }],
  ])('fails closed for %s payable lineage', async (_label, payablePatch) => {
    allocations.mockResolvedValue([{ id: 1, reception_id: 31, expense_id: null, purchase_order_id: 51 }]);
    receptions.mockResolvedValue([reception(31, 51, payablePatch)]);
    orders.mockResolvedValue([{ ...order(), receptions: [reception(31, 51, payablePatch)] }]);
    const result = await service.list(context, 42);
    expect(result.payable_evidence_complete).toBe(false);
    expect(result.financial_evidence_complete).toBe(false);
    if (_label === 'missing AP') expect(result.payable_evidence[0].status).toBe('missing');
    else expect(result.payable_evidence[0].status).toBe(_label.includes('foreign') ? 'foreign_scope' : 'invalid_source');
  });

  it('does not infer a missing PO mapping and rejects conflicting active mappings', async () => {
    allocations.mockResolvedValue([
      { id: 1, reception_id: 31, expense_id: null, purchase_order_id: null },
      { id: 2, reception_id: 32, expense_id: null, purchase_order_id: 51 },
      { id: 3, reception_id: 32, expense_id: null, purchase_order_id: 52 },
      { id: 4, reception_id: 32, expense_id: null, purchase_order_id: null },
    ]);
    receptions.mockResolvedValue([reception(31), reception(32)]);
    orders.mockResolvedValue([
      { ...order(51), receptions: [reception(31, 51)] },
      { ...order(52), receptions: [reception(32, 52)] },
    ]);
    const result = await service.list(context, 42);
    expect(result.payable_evidence.map((item) => item.status)).toEqual(['invalid_source', 'invalid_source']);
    expect(result.payable_evidence_complete).toBe(false);
  });

  it('deduplicates partial receipts and leaves IVA lineage unresolved including legacy null tax_type', async () => {
    allocations.mockResolvedValue([
      { id: 1, reception_id: 31, expense_id: null, purchase_order_id: 51 },
      { id: 2, reception_id: 32, expense_id: null, purchase_order_id: 52 },
      { id: 3, reception_id: 31, expense_id: null, purchase_order_id: 51 },
    ]);
    receptions.mockResolvedValue([reception(31, 51, {}), reception(32, 52, {})]);
    orders.mockResolvedValue([
      { ...order(51, [{ tax_type: null, deductible_tax_amount: decimal(8) }]), receptions: [reception(31, 51, {})] },
      { ...order(52), receptions: [reception(32, 52, {})] },
      order(52, [{ tax_type: 'iva', deductible_tax_amount: decimal(5) }]),
    ]);
    const result = await service.list(context, 42);
    expect(result.payable_evidence).toHaveLength(2);
    expect(result.unresolved_vat_purchase_order_ids).toEqual([51, 52]);
    expect(result.unresolved_tax_purchase_order_ids).toEqual([51, 52]);
    expect(result.ledger_evidence_complete).toBe(false);
    expect(result.fiscal_eligibility).toBe('pending');
    expect(orders.mock.calls[0][0].where).not.toHaveProperty('location');
  });

  it('does not mark INC or zero-tax purchase orders as unresolved VAT, including expense-only documents', async () => {
    allocations.mockResolvedValue([
      { id: 1, reception_id: null, expense_id: 80, purchase_order_id: null },
      { id: 2, reception_id: 31, expense_id: null, purchase_order_id: 51 },
      { id: 3, reception_id: 32, expense_id: null, purchase_order_id: 52 },
    ]);
    receptions.mockResolvedValue([reception(31, 51, {}), reception(32, 52, {})]);
    orders.mockResolvedValue([
      { ...order(51, [{ tax_type: 'inc', deductible_tax_amount: decimal(9) }]), receptions: [reception(31, 51, {})] },
      { ...order(52, [{ tax_type: null, deductible_tax_amount: decimal(0) }]), receptions: [reception(32, 52, {})] },
    ]);
    entries.mockResolvedValue([
      { id: 90, source_type: 'purchase_order.received', source_id: 31, accounting_entity_id: 7, status: 'posted' },
      { id: 91, source_type: 'purchase_order.received', source_id: 32, accounting_entity_id: 7, status: 'posted' },
    ]);
    const result = await service.list(context, 42);
    expect(result.unresolved_vat_purchase_order_ids).toEqual([]);
    expect(result.unresolved_tax_purchase_order_ids).toEqual([51]);
    expect(result.ledger_evidence_complete).toBe(false);
    expect(result.financial_evidence_complete).toBe(false);
    expect(result.fiscal_eligibility).toBe('pending');
    allocations.mockResolvedValue([{ id: 4, reception_id: null, expense_id: 80, purchase_order_id: null }]);
    const expenseOnly = await service.list(context, 42);
    expect(expenseOnly.payable_evidence).toEqual([]);
    expect(expenseOnly.payable_evidence_complete).toBe(null);
    expect(expenseOnly.unresolved_vat_purchase_order_ids).toEqual([]);
    expect(expenseOnly.unresolved_tax_purchase_order_ids).toEqual([]);
  });
});

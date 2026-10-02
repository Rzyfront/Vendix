import {
  projectReceivedDocumentAccountingEvidence,
  ReceivedDocumentAccountingEntryEvidence,
  ReceivedDocumentExpectedAccountingReference,
  ReceivedDocumentAccountingSourceType,
} from './received-document-accounting-evidence';

describe('projectReceivedDocumentAccountingEvidence', () => {
  const input = (
    expected_references: ReceivedDocumentExpectedAccountingReference[],
    accounting_entries: ReceivedDocumentAccountingEntryEvidence[] = [],
  ) => ({
    accounting_entity_id: 7,
    expected_references,
    accounting_entries,
  });
  const reference = (
    source_type: ReceivedDocumentAccountingSourceType,
    source_id: number,
    accounting_entity_id = 7,
  ): ReceivedDocumentExpectedAccountingReference => ({
    source_type,
    source_id,
    accounting_entity_id,
  });
  const entry = (
    id: number,
    source_type: string,
    source_id: number,
    accounting_entity_id: number | null = 7,
    status: ReceivedDocumentAccountingEntryEvidence['status'] = 'posted',
  ): ReceivedDocumentAccountingEntryEvidence => ({
    id,
    source_type,
    source_id,
    accounting_entity_id,
    status,
  });

  it('links purchase reception and purchase VAT evidence', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input(
        [reference('purchase_order.received', 101), reference('purchase_vat', 101)],
        [entry(1, 'purchase_order.received', 101), entry(2, 'purchase_vat', 101)],
      ),
    );

    expect(result.complete).toBe(true);
    expect(result.evidence).toEqual([
      { reference: reference('purchase_order.received', 101), status: 'linked', accounting_entry_id: 1 },
      { reference: reference('purchase_vat', 101), status: 'linked', accounting_entry_id: 2 },
    ]);
  });

  it('links expense evidence', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input([reference('expense.approved', 22)], [entry(8, 'expense.approved', 22)]),
    );
    expect(result.evidence[0]).toEqual({
      reference: reference('expense.approved', 22),
      status: 'linked',
      accounting_entry_id: 8,
    });
  });

  it('preserves separate partial receipt source ids and deduplicates only identical references', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input(
        [
          reference('purchase_order.received', 31),
          reference('purchase_order.received', 32),
          reference('purchase_order.received', 31),
        ],
        [entry(3, 'purchase_order.received', 31), entry(4, 'purchase_order.received', 32)],
      ),
    );
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map((item) => item.accounting_entry_id)).toEqual([3, 4]);
  });

  it('marks duplicate same-entity journal entries ambiguous without selecting one', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input([reference('support_document.accepted', 9)], [
        entry(1, 'support_document.accepted', 9),
        entry(2, 'support_document.accepted', 9),
      ]),
    );
    expect(result.complete).toBe(false);
    expect(result.evidence[0]).toEqual({
      reference: reference('support_document.accepted', 9),
      status: 'ambiguous',
    });
  });

  it.each(['draft', 'voided'] as const)('does not link a %s entry', (status) => {
    const result = projectReceivedDocumentAccountingEvidence(
      input([reference('expense.approved', 45)], [entry(6, 'expense.approved', 45, 7, status)]),
    );
    expect(result.complete).toBe(false);
    expect(result.evidence[0]).toEqual({
      reference: reference('expense.approved', 45),
      status: 'not_posted',
    });
  });

  it('does not link an entry whose accounting entity is unresolved', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input([reference('expense.approved', 46)], [entry(7, 'expense.approved', 46, null)]),
    );
    expect(result.evidence[0]).toEqual({
      reference: reference('expense.approved', 46),
      status: 'unresolved_entity',
    });
  });

  it('keeps posted and draft duplicates ambiguous', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input([reference('expense.approved', 47)], [
        entry(8, 'expense.approved', 47),
        entry(9, 'expense.approved', 47, 7, 'draft'),
      ]),
    );
    expect(result.evidence[0]).toEqual({
      reference: reference('expense.approved', 47),
      status: 'ambiguous',
    });
  });

  it('blocks evidence leakage from another accounting entity', () => {
    const result = projectReceivedDocumentAccountingEvidence(
      input([reference('expense.approved', 44)], [entry(5, 'expense.approved', 44, 8)]),
    );
    expect(result.evidence[0]).toEqual({
      reference: reference('expense.approved', 44),
      status: 'foreign_entity',
    });
  });

  it('is incomplete when there are no expected references', () => {
    expect(projectReceivedDocumentAccountingEvidence(input([]))).toEqual({ complete: false, evidence: [] });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid identifiers (%s)', (invalidId) => {
    expect(() =>
      projectReceivedDocumentAccountingEvidence(input([reference('expense.approved', invalidId)])),
    ).toThrow(TypeError);
  });

  it('rejects invalid entity and persisted-entry identifiers', () => {
    expect(() =>
      projectReceivedDocumentAccountingEvidence({ ...input([]), accounting_entity_id: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      projectReceivedDocumentAccountingEvidence(
        input([reference('expense.approved', 1, 0)]),
      ),
    ).toThrow(TypeError);
    expect(() =>
      projectReceivedDocumentAccountingEvidence(
        input([], [entry(0, 'expense.approved', 1)]),
      ),
    ).toThrow(TypeError);
    expect(() =>
      projectReceivedDocumentAccountingEvidence(
        input([], [entry(1, 'expense.approved', 1, 0)]),
      ),
    ).toThrow(TypeError);
  });
});

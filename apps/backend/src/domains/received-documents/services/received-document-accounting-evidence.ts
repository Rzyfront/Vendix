export type ReceivedDocumentAccountingSourceType =
  | 'purchase_order.received'
  | 'purchase_vat'
  | 'expense.approved'
  | 'support_document.accepted';

export interface ReceivedDocumentExpectedAccountingReference {
  source_type: ReceivedDocumentAccountingSourceType;
  source_id: number;
  accounting_entity_id: number;
}

export interface ReceivedDocumentAccountingEntryEvidence {
  id: number;
  source_type: string;
  source_id: number;
  accounting_entity_id: number | null;
  status: 'draft' | 'posted' | 'voided';
}

export interface ProjectReceivedDocumentAccountingEvidenceInput {
  accounting_entity_id: number;
  expected_references: ReceivedDocumentExpectedAccountingReference[];
  accounting_entries: ReceivedDocumentAccountingEntryEvidence[];
}

export type ReceivedDocumentAccountingEvidenceStatus =
  | 'linked'
  | 'missing'
  | 'ambiguous'
  | 'foreign_entity'
  | 'not_posted'
  | 'unresolved_entity';

export interface ReceivedDocumentAccountingEvidenceItem {
  reference: ReceivedDocumentExpectedAccountingReference;
  status: ReceivedDocumentAccountingEvidenceStatus;
  accounting_entry_id?: number;
}

export interface ProjectReceivedDocumentAccountingEvidenceResult {
  complete: boolean;
  evidence: ReceivedDocumentAccountingEvidenceItem[];
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function assertNonEmptyString(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

/**
 * Projects persisted journal-entry evidence onto expected source references.
 * This is deliberately read-only evidence: a missing link never authorizes a
 * journal, AP, or tax write, and commercial matching does not imply VAT eligibility.
 */
export function projectReceivedDocumentAccountingEvidence(
  input: ProjectReceivedDocumentAccountingEvidenceInput,
): ProjectReceivedDocumentAccountingEvidenceResult {
  assertPositiveInteger(input.accounting_entity_id, 'accounting_entity_id');

  for (const reference of input.expected_references) {
    assertNonEmptyString(reference.source_type, 'expected source_type');
    assertPositiveInteger(reference.source_id, 'expected source_id');
    assertPositiveInteger(reference.accounting_entity_id, 'expected accounting_entity_id');
  }

  for (const entry of input.accounting_entries) {
    assertPositiveInteger(entry.id, 'accounting entry id');
    assertNonEmptyString(entry.source_type, 'accounting entry source_type');
    assertPositiveInteger(entry.source_id, 'accounting entry source_id');
    if (entry.accounting_entity_id !== null) {
      assertPositiveInteger(entry.accounting_entity_id, 'accounting entry accounting_entity_id');
    }
  }

  const uniqueReferences = new Map<string, ReceivedDocumentExpectedAccountingReference>();
  for (const reference of input.expected_references) {
    const key = JSON.stringify([
      reference.source_type,
      reference.source_id,
      reference.accounting_entity_id,
    ]);
    if (!uniqueReferences.has(key)) uniqueReferences.set(key, reference);
  }

  const evidence = [...uniqueReferences.values()].map((reference) => {
    if (reference.accounting_entity_id !== input.accounting_entity_id) {
      return { reference, status: 'foreign_entity' as const };
    }

    const matchingSource = input.accounting_entries.filter(
      (entry) => entry.source_type === reference.source_type && entry.source_id === reference.source_id,
    );
    const matchingEntity = matchingSource.filter(
      (entry) => entry.accounting_entity_id === reference.accounting_entity_id,
    );

    if (matchingEntity.length > 1) return { reference, status: 'ambiguous' as const };
    if (matchingEntity.length === 1) {
      if (matchingEntity[0].status !== 'posted') {
        return { reference, status: 'not_posted' as const };
      }
      return {
        reference,
        status: 'linked' as const,
        accounting_entry_id: matchingEntity[0].id,
      };
    }
    return {
      reference,
      status: matchingSource.length === 0
        ? 'missing' as const
        : matchingSource.some((entry) => entry.accounting_entity_id === null)
          ? 'unresolved_entity' as const
          : 'foreign_entity' as const,
    };
  });

  return {
    complete: evidence.length > 0 && evidence.every((item) => item.status === 'linked'),
    evidence,
  };
}

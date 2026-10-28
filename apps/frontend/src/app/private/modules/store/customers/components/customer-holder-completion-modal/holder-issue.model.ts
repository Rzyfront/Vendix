/**
 * Shared shape of an "incomplete invoice holder" finding, as returned by:
 *  - `POST store/invoicing/orders/:id/emit` (409 `INVOICING_HOLDER_INCOMPLETE_001`, in `details`)
 *  - `GET store/invoicing/holder-check?customer_id=` (`holder_issue` + `cf_overridable`)
 */

export type HolderIssueCode =
  | 'missing_document_number'
  | 'missing_name'
  | 'final_consumer_sentinel'
  | 'document_type_required';

export type HolderMissingField =
  | 'document_number'
  | 'document_type'
  | 'first_name'
  | 'last_name'
  | 'legal_name';

export interface HolderIssue {
  customer_id: number;
  customer_name: string;
  issue_code: HolderIssueCode;
  missing_fields: HolderMissingField[];
  message: string;
  cf_overridable: boolean;
}

/** Spanish label of every missing field. */
export const HOLDER_FIELD_LABELS: Record<HolderMissingField, string> = {
  document_type: 'Tipo de documento',
  document_number: 'Número de documento',
  first_name: 'Nombres',
  last_name: 'Apellidos',
  legal_name: 'Razón social',
};

/** Labels of the missing fields, in display order. */
export function missingFieldLabels(
  fields: readonly HolderMissingField[],
): string[] {
  const order = Object.keys(HOLDER_FIELD_LABELS) as HolderMissingField[];
  return order
    .filter((f) => fields.includes(f))
    .map((f) => HOLDER_FIELD_LABELS[f]);
}

/** True when any name part is missing (explains «razón social, o nombres y apellidos»). */
export function isNameMissing(fields: readonly HolderMissingField[]): boolean {
  return fields.some(
    (f) => f === 'first_name' || f === 'last_name' || f === 'legal_name',
  );
}

/**
 * Builds a `HolderIssue` from the untyped `details` of the 409, or null when
 * the payload does not look like one.
 */
export function holderIssueFromDetails(details: unknown): HolderIssue | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const customerId = Number(d['customer_id']);
  if (!Number.isFinite(customerId) || customerId <= 0) return null;
  return {
    customer_id: customerId,
    customer_name: typeof d['customer_name'] === 'string' ? d['customer_name'] : '',
    issue_code: d['issue_code'] as HolderIssueCode,
    missing_fields: Array.isArray(d['missing_fields'])
      ? (d['missing_fields'] as HolderMissingField[])
      : [],
    message: typeof d['message'] === 'string' ? d['message'] : '',
    cf_overridable: d['cf_overridable'] === true,
  };
}

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

/** Holder data already on file (409 `details.current`), shaped like the form. */
export interface HolderCurrentData {
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  legal_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** Why Consumidor final was refused after the user asked for it. */
export type HolderCfBlocker = 'credit_sale' | 'unpaid_balance';

export interface HolderIssue {
  /** `null`: the buyer is not a registered customer (guest billing data of the order). */
  customer_id: number | null;
  customer_name: string;
  issue_code: HolderIssueCode;
  missing_fields: HolderMissingField[];
  message: string;
  cf_overridable: boolean;
  /** Data on file; absent on payloads that do not carry it (POS holder-check). */
  current?: HolderCurrentData | null;
  cf_blocker?: HolderCfBlocker | null;
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

/** Display order of the form fields. */
const FIELD_ORDER = Object.keys(HOLDER_FIELD_LABELS) as HolderMissingField[];

const FINAL_CONSUMER_NUMBER = '222222222222';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Normalizes a customer-like record into `HolderCurrentData` (sentinel → absent). */
export function holderCurrentFrom(record: unknown): HolderCurrentData | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  const number = text(r['document_number']);
  return {
    document_type: text(r['document_type']),
    document_number:
      number && number.replace(/\D/g, '') === FINAL_CONSUMER_NUMBER ? null : number,
    verification_digit: text(r['verification_digit']),
    legal_name: text(r['legal_name']),
    first_name: text(r['first_name']),
    last_name: text(r['last_name']),
  };
}

/**
 * Fields the user must fill: the backend list plus the document type when the
 * number is missing and no type is on file (the save needs both).
 */
export function effectiveMissingFields(
  missing: readonly HolderMissingField[],
  current: HolderCurrentData | null,
): HolderMissingField[] {
  const set = new Set(missing);
  if (set.has('document_number') && !current?.document_type) {
    set.add('document_type');
  }
  return FIELD_ORDER.filter((f) => set.has(f));
}

/** «Datos que ya tiene»: label + value of every non-empty field on file. */
export function presentHolderData(
  current: HolderCurrentData | null,
  missing: readonly HolderMissingField[],
): { label: string; value: string }[] {
  if (!current) return [];
  const rows: { label: string; value: string }[] = [];
  const add = (field: HolderMissingField, value: string | null) => {
    if (value && !missing.includes(field)) {
      rows.push({ label: HOLDER_FIELD_LABELS[field], value });
    }
  };
  add('document_type', current.document_type);
  add(
    'document_number',
    current.document_number && current.document_type === 'NIT' && current.verification_digit
      ? `${current.document_number}-${current.verification_digit}`
      : current.document_number,
  );
  add('legal_name', current.legal_name);
  add('first_name', current.first_name);
  add('last_name', current.last_name);
  return rows;
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
  if (typeof d['issue_code'] !== 'string') return null;
  // A guest buyer (no customer) is still an issue: dropping it left only a toast.
  const customerId = Number(d['customer_id']);
  return {
    customer_id: Number.isFinite(customerId) && customerId > 0 ? customerId : null,
    customer_name: typeof d['customer_name'] === 'string' ? d['customer_name'] : '',
    issue_code: d['issue_code'] as HolderIssueCode,
    missing_fields: Array.isArray(d['missing_fields'])
      ? (d['missing_fields'] as HolderMissingField[])
      : [],
    message: typeof d['message'] === 'string' ? d['message'] : '',
    cf_overridable: d['cf_overridable'] === true,
    current: holderCurrentFrom(d['current']),
    cf_blocker:
      d['cf_blocker'] === 'credit_sale' || d['cf_blocker'] === 'unpaid_balance'
        ? d['cf_blocker']
        : null,
  };
}

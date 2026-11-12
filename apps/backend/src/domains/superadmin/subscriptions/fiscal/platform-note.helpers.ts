/**
 * Pure helpers for platform credit/debit notes (no database, no Nest).
 *
 * A platform note is a NEW `fiscal_transmissions` row whose lines are derived
 * from the invoice it corrects. These helpers keep the line/tax derivation and
 * the balance arithmetic testable on their own.
 */
import { dianSum } from '../../../../common/money-kernel/dian-money';

export type PlatformNoteType = 'credit_note' | 'debit_note';

/** `fiscal_transmissions.source_type` of each note type. */
export const PLATFORM_NOTE_SOURCE: Record<PlatformNoteType, string> = {
  credit_note: 'platform_credit_note',
  debit_note: 'platform_debit_note',
};

export const PLATFORM_NOTE_SOURCE_TYPES: string[] = Object.values(
  PLATFORM_NOTE_SOURCE,
);

/** Originals a note can correct. */
export const NOTE_CORRECTABLE_SOURCES = [
  'platform_invoice',
  'subscription_invoice',
] as const;

export const NOTE_TYPE_LABEL: Record<PlatformNoteType, string> = {
  credit_note: 'nota crédito',
  debit_note: 'nota débito',
};

/** One line of the persisted snapshot (what was signed), loosely typed. */
export interface NoteSnapshotLine {
  position?: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total?: number;
  discount_amount?: number;
  unit_code: string;
  taxes?: Array<{
    tax_type: string;
    rate: number;
    tax_amount?: number;
    is_inclusive?: boolean;
    taxable_amount?: number;
  }>;
  account_code?: string | null;
}

export type NoteTaxSignature =
  | { kind: 'none' }
  | {
      kind: 'uniform';
      taxes: Array<{ tax_type: string; rate: number; is_inclusive: boolean }>;
    }
  | { kind: 'mixed' };

/**
 * Tax shape shared by every line of the original. A partial note inherits it;
 * with mixed shapes the amounts cannot be allocated per line, so only a total
 * note is possible.
 */
export function noteTaxSignature(lines: NoteSnapshotLine[]): NoteTaxSignature {
  const sigs = new Set<string>();
  let first: NoteTaxSignature | null = null;
  for (const line of lines) {
    const taxes = (line.taxes ?? []).map((t) => ({
      tax_type: String(t.tax_type),
      rate: Number(t.rate),
      is_inclusive: t.is_inclusive === true,
    }));
    const key = JSON.stringify(taxes);
    sigs.add(key);
    if (!first) {
      first = taxes.length
        ? { kind: 'uniform', taxes }
        : { kind: 'none' };
    }
  }
  if (sigs.size > 1) return { kind: 'mixed' };
  return first ?? { kind: 'none' };
}

/** Percent of the first tax of a line (0 when untaxed). */
export function linePercent(line: NoteSnapshotLine): number {
  const t = line.taxes?.[0];
  if (!t) return 0;
  return Math.round(Number(t.rate) * 10000) / 100;
}

const cents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
export const centsToAmount = (c: number): string => (c / 100).toFixed(2);

/**
 * Creditable balance = original total − credit notes that still count.
 * `credited` holds the totals of every linked credit note that was not rejected.
 */
export function creditBalance(
  originalTotal: string | number,
  credited: Array<string | number>,
): string {
  const spent = credited.reduce<number>((acc, v) => acc + cents(v), 0);
  return centsToAmount(Math.max(0, cents(originalTotal) - spent));
}

/** Σ of DIAN amounts as a string (re-exported to keep callers off the kernel). */
export function sumAmounts(values: string[]): string {
  return dianSum(values);
}

/**
 * Moment a credit note counts against the balance: every state except a DIAN
 * rejection (a rejected note is retried and re-checked against the balance then).
 */
export function noteCountsAgainstBalance(dian_status: string): boolean {
  return dian_status !== 'rejected';
}

/** Everything a note needs from the invoice it corrects. */
export interface PlatformNoteOriginal {
  id: number;
  document_number: string;
  cufe: string | null;
  /** Civil date (YYYY-MM-DD) the original was issued. */
  issue_date: string;
  total: string;
  currency: string;
  /** The signed payload of the original (customer_*, items, taxes, totals). */
  provider_data: Record<string, any>;
  lines: NoteSnapshotLine[];
  customer: Record<string, unknown> | null;
  tax_breakdown: Array<Record<string, unknown>>;
  counterpart_account_code: string | null;
}

/** Lines and totals of the note, in the shapes the signer and the snapshot use. */
export interface PlatformNoteComputation {
  lineItems: Array<Record<string, any>>;
  snapshotItems: Array<Record<string, any>>;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  payable: string;
  hasAnyTax: boolean;
  taxBreakdown: Array<Record<string, any>>;
}

export interface PlatformNoteIssueInput {
  note_type: PlatformNoteType;
  original: PlatformNoteOriginal;
  computation: PlatformNoteComputation;
  is_total: boolean;
  note_concept_code: string;
  reason: string;
  actor_user_id: number;
}

export interface PlatformNoteResult {
  transmission_id: number;
  document_type: PlatformNoteType;
  document_number: string;
  related_transmission_id: number;
  related_document_number: string;
  dian_status: string;
  transmission_status: string;
  cude: string | null;
  total: string;
  error_code: string | null;
  error_message: string | null;
  idempotent_replay?: boolean;
}

/** Total note: the original's lines and totals, untouched. */
export function totalNoteComputation(
  original: PlatformNoteOriginal,
): PlatformNoteComputation {
  const pd = original.provider_data;
  const taxes = Array.isArray(pd['taxes']) ? pd['taxes'] : [];
  return {
    lineItems: Array.isArray(pd['items']) ? pd['items'] : [],
    snapshotItems: original.lines as unknown as Array<Record<string, any>>,
    subtotal: String(pd['subtotal_amount'] ?? '0.00'),
    taxTotal: String(pd['tax_amount'] ?? '0.00'),
    discountTotal: String(pd['discount_amount'] ?? '0.00'),
    payable: String(original.total),
    hasAnyTax: taxes.length > 0,
    taxBreakdown: original.tax_breakdown as Array<Record<string, any>>,
  };
}

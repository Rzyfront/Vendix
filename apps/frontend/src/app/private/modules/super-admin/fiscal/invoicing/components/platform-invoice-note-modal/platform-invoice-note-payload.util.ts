import type {
  CreatePlatformNoteDto,
  CreatePlatformNoteItemDto,
  PlatformNoteDocumentType,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';

export const NOTE_REASON_MAX_LENGTH = 500;

/** A line as edited in the modal (numbers already parsed). */
export interface PlatformNoteFormLine {
  description: string;
  quantity: number;
  unit_price: number;
  unit_code?: string | null;
  /** Percentage (19 = 19 %). UI estimate only; never sent to the backend. */
  tax_rate: number;
}

export interface PlatformNoteFormState {
  relatedInvoiceId: number;
  noteType: PlatformNoteDocumentType;
  conceptCode: string;
  reason: string;
  mode: 'total' | 'lines';
  lines: PlatformNoteFormLine[];
}

/** Money to two decimals, as a number. */
export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Decimal strings from Prisma / free text to a finite number. */
export function toNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

/** Estimated total of one line (tax included). The server stays authoritative. */
export function estimateLineTotal(line: PlatformNoteFormLine): number {
  const base = toNumber(line.quantity) * toNumber(line.unit_price);
  return round2(base * (1 + toNumber(line.tax_rate) / 100));
}

export function estimateLinesTotal(lines: PlatformNoteFormLine[]): number {
  return round2(lines.reduce((acc, line) => acc + estimateLineTotal(line), 0));
}

/** True when a credit note of `total` would exceed the creditable balance. */
export function exceedsCreditBalance(total: number, balance: number): boolean {
  return round2(total) > round2(balance);
}

/**
 * Builds the POST body from the form state.
 *   · credit note + mode "total"  → no `items` (backend copies every line);
 *   · otherwise                   → `items` with numeric quantity/unit_price.
 * `unit_code` is sent only when the line carries one.
 */
export function buildPlatformNotePayload(
  state: PlatformNoteFormState,
): CreatePlatformNoteDto {
  const base: CreatePlatformNoteDto = {
    related_invoice_id: state.relatedInvoiceId,
    note_concept_code: state.conceptCode,
    reason: state.reason.trim(),
  };
  if (state.noteType === 'credit_note' && state.mode === 'total') {
    return base;
  }
  const items: CreatePlatformNoteItemDto[] = state.lines.map((line) => {
    const item: CreatePlatformNoteItemDto = {
      description: line.description.trim(),
      quantity: toNumber(line.quantity),
      unit_price: toNumber(line.unit_price),
    };
    if (line.unit_code) {
      item.unit_code = line.unit_code;
    }
    return item;
  });
  return { ...base, items };
}

/** Blocking validation messages (Spanish); empty array = ready to submit. */
export function validatePlatformNote(state: PlatformNoteFormState): string[] {
  const errors: string[] = [];
  if (!state.conceptCode) errors.push('Selecciona el concepto DIAN.');
  const reason = state.reason.trim();
  if (!reason) errors.push('El motivo es obligatorio.');
  if (reason.length > NOTE_REASON_MAX_LENGTH) {
    errors.push(`El motivo no puede superar ${NOTE_REASON_MAX_LENGTH} caracteres.`);
  }
  const needsLines = !(state.noteType === 'credit_note' && state.mode === 'total');
  if (needsLines) {
    if (state.lines.length === 0) {
      errors.push('Agrega al menos una línea.');
    }
    const invalid = state.lines.some(
      (l) =>
        !l.description.trim() ||
        !(toNumber(l.quantity) > 0) ||
        !(toNumber(l.unit_price) > 0),
    );
    if (invalid) {
      errors.push('Cada línea necesita descripción, cantidad y precio mayores a cero.');
    }
  }
  return errors;
}

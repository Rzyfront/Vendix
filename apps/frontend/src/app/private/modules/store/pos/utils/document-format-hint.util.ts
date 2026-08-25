import { findDocumentType } from '../../../../../../shared/constants/document-types';

/**
 * QUI-723 — Real-time hint for the document-number input shown under
 * the form. Pure function (extracted from the component's `computed`
 * signal) so it can be unit-tested without TestBed / Karma setup.
 *
 * Returns `null` when the cashier hasn't typed anything yet (no hint).
 * Otherwise returns `{ tone, text }`:
 *   - `info`  — in progress (e.g. below the min, or no type selected)
 *   - `ok`    — within the type's range
 *   - `warn`  — overflow or non-standard format
 *
 * Pure info — does NOT block submission. The backend `ResolveCustomerDto`
 * is format-tolerant so the cashier can still find legacy customers.
 */

export type HintTone = 'info' | 'ok' | 'warn';

export interface FormatHint {
  tone: HintTone;
  text: string;
}

/**
 * Extract the minimum length from a digit-only regex like /^\d{6,10}$/
 * or /^\d{8,10}-?\d?$/ (the trailing group is optional). Falls back to
 * 1 if the regex shape doesn't carry a quantifier.
 *
 * Note: this parser assumes `\d{N,...}` shape. PA's `[A-Z0-9]{5,16}` still
 * extracts `5` correctly because the digit-class shorthand matches `\d`
 * literally in the source. If a future doc type uses something else
 * (e.g. `[A-Z]{3}`), the fallback returns 1 and the user sees a
 * slightly off "Faltan 1" message — acceptable, not a bug.
 */
export function extractMinFromRegex(regex: RegExp): number {
  const source = regex.source;
  const match = source.match(/\{\s*(\d+)(?:\s*,)?/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 1;
}

/**
 * Compute the live hint for a typed document number.
 *
 * @param type      The selected document type code (CC, NIT, etc.) — may be
 *                  empty / null if the cashier hasn't picked a type yet.
 * @param number    The raw typed number, possibly with whitespace.
 */
export function computeDocumentFormatHint(
  type: string | null | undefined,
  number: string | null | undefined,
): FormatHint | null {
  const trimmedNumber = (number ?? '').trim().toUpperCase();
  if (!trimmedNumber) return null;

  const rule = findDocumentType(type ?? null);
  if (!rule) {
    return {
      tone: 'info',
      text: `${trimmedNumber.length} caracteres — sin tipo de documento seleccionado.`,
    };
  }

  const len = trimmedNumber.length;
  const matchesRegex = rule.regex.test(trimmedNumber);
  const min = extractMinFromRegex(rule.regex);

  if (matchesRegex && len <= rule.maxLength) {
    return {
      tone: 'ok',
      text: `✓ ${len} caracteres — entre ${min} y ${rule.maxLength}.`,
    };
  }

  if (len > rule.maxLength) {
    const over = len - rule.maxLength;
    return {
      tone: 'warn',
      text: `${over} ${over === 1 ? 'carácter de más' : 'caracteres de más'} (máximo ${rule.maxLength} para ${rule.label}). Se va a guardar igual.`,
    };
  }

  // Below max-length but regex failed (e.g. wrong chars). We can still
  // surface the min/max so the cashier knows the target range.
  if (len < min) {
    const missing = min - len;
    return {
      tone: 'info',
      text: `Faltan ${missing} ${missing === 1 ? 'carácter' : 'caracteres'} (mínimo ${min} para ${rule.label}).`,
    };
  }
  return {
    tone: 'warn',
    text: `${len} caracteres para ${rule.label} — formato no estándar. Se va a guardar igual.`,
  };
}

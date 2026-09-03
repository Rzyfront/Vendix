/**
 * QUI-723 — Real-time hint for the phone input shown under the form.
 * Pure function so it can be unit-tested without TestBed / Karma.
 *
 * Per dev lead's spec: "el número de teléfono son 10" — Colombian
 * mobile phone numbers are exactly 10 digits (no country prefix).
 *
 * Returns `null` when the input is empty (no hint yet). Otherwise:
 *   - `info`  — below 10 (cashier hasn't finished typing)
 *   - `ok`    — exactly 10 (valid)
 *   - `warn`  — over 10 (typo / extra digit / country prefix leaked in)
 *
 * Non-digit characters are tolerated in the hint display (the
 * cashier might be pasting "+57 300 123 4567") — but the backend
 * `CreateCustomerDto` now requires exactly 10 raw digits.
 */

export type PhoneHintTone = 'info' | 'ok' | 'warn';

export interface PhoneFormatHint {
  tone: PhoneHintTone;
  text: string;
}

export const PHONE_EXPECTED_LENGTH = 10;

export function computePhoneFormatHint(
  number: string | null | undefined,
): PhoneFormatHint | null {
  if (!number || !number.trim()) return null;

  // Strip non-digits for the count comparison — we want "10 digits
  // remaining" rather than "10 chars remaining".
  const digitsOnly = number.replace(/\D/g, '');
  const len = digitsOnly.length;

  if (len === PHONE_EXPECTED_LENGTH) {
    return {
      tone: 'ok',
      text: `✓ ${len} dígitos — listo para guardar.`,
    };
  }

  if (len > PHONE_EXPECTED_LENGTH) {
    const over = len - PHONE_EXPECTED_LENGTH;
    return {
      tone: 'warn',
      text: `${over} ${over === 1 ? 'dígito de más' : 'dígitos de más'} (máximo ${PHONE_EXPECTED_LENGTH}). Quita el prefijo de país si lo incluiste.`,
    };
  }

  // Below the target.
  const missing = PHONE_EXPECTED_LENGTH - len;
  return {
    tone: 'info',
    text: `Faltan ${missing} ${missing === 1 ? 'dígito' : 'dígitos'} (${len} / ${PHONE_EXPECTED_LENGTH}).`,
  };
}

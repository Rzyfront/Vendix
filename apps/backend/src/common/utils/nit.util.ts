/**
 * Colombian NIT helpers.
 *
 * The verification digit is a checksum, not data: asking a human to type it
 * invites a typo that DIAN rejects only after the document has already burned a
 * fiscal consecutive. Everything that needs a DV should derive it here.
 */

/** DIAN modulo-11 weights, applied to the NIT digits read right to left. */
const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Strips separators (dots, spaces, hyphens) leaving only digits. */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Verification digit of a Colombian NIT (DIAN modulo-11 algorithm). Returns an
 * empty string for an empty/non-numeric input so callers can distinguish
 * "no NIT" from the perfectly valid DV `'0'`.
 */
export function computeNitDv(nit: string | null | undefined): string {
  const digits = onlyDigits(nit);
  if (!digits) return '';
  const reversed = digits.split('').reverse();
  let sum = 0;
  for (let i = 0; i < reversed.length && i < DV_WEIGHTS.length; i++) {
    sum += Number(reversed[i]) * DV_WEIGHTS[i];
  }
  const mod = sum % 11;
  return String(mod > 1 ? 11 - mod : mod);
}

/**
 * Splits a NIT written in any of the usual shapes (`900.123.456-7`,
 * `900123456`, `900123456-7`) into its number and DV.
 *
 * The DV is ALWAYS derived, never taken from the input. It is a function of the
 * number, so a stored value that disagrees is by definition wrong — and stored
 * values do disagree in practice: seeded and hand-entered rows carry arbitrary
 * digits. `provided_dv` reports what the input claimed so a caller can flag the
 * mismatch; `dv_mismatch` says whether it disagreed.
 */
export function normalizeNit(raw: string | null | undefined): {
  number: string;
  dv: string;
  provided_dv: string | null;
  dv_mismatch: boolean;
} {
  const value = (raw ?? '').trim();
  if (!value) {
    return { number: '', dv: '', provided_dv: null, dv_mismatch: false };
  }

  const [head, tail] = value.includes('-')
    ? value.split('-')
    : [value, undefined];
  const number = onlyDigits(head);
  const dv = computeNitDv(number);
  const providedRaw = tail === undefined ? '' : onlyDigits(tail);
  const provided_dv = providedRaw.length === 1 ? providedRaw : null;

  return {
    number,
    dv,
    provided_dv,
    dv_mismatch: provided_dv !== null && provided_dv !== dv,
  };
}

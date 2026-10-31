/**
 * SMS helpers for the `sns_sms` provider (PLAN-CRM §5.2): E.164
 * normalization, GSM-7/UCS-2 segment count and the per-country price used to
 * reserve spend before publishing.
 */

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes a phone to E.164. Accepts `+57 300 123 4567`, `0057…`, `57…`
 * and, for national numbers, prefixes `defaultCountryCode`. Returns `null`
 * when the result is not a valid E.164 number, so nothing is published to a
 * malformed address.
 */
export function normalizeE164(
  raw: string | null | undefined,
  defaultCountryCode = '57',
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (!hasPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    } else if (!digits.startsWith(defaultCountryCode) || digits.length <= 10) {
      // National number (e.g. Colombian mobile `3001234567`).
      digits = `${defaultCountryCode}${digits.replace(/^0+/, '')}`;
    }
  }

  const candidate = `+${digits}`;
  return E164_PATTERN.test(candidate) ? candidate : null;
}

// GSM 03.38 basic set; extension characters count as two septets.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export interface SmsSegments {
  encoding: 'GSM-7' | 'UCS-2';
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
}

export function countSmsSegments(text: string): SmsSegments {
  let septets = 0;
  let gsm = true;
  for (const char of text) {
    if (GSM7_BASIC.includes(char)) septets += 1;
    else if (GSM7_EXTENDED.includes(char)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }

  if (gsm) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: 'GSM-7', units: septets, segments };
  }
  const units = text.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: 'UCS-2', units, segments };
}

/** Country calling code → USD per segment; `default` covers the rest. */
export type SmsPriceTable = Record<string, number>;

/**
 * Parses `SNS_SMS_PRICE_TABLE` (`{"57":0.0075,"1":0.0089,"default":0.05}`).
 * Invalid JSON or entries are ignored so a typo never makes SMS free: the
 * caller falls back to `fallbackPrice`.
 */
export function parseSmsPriceTable(raw: string | undefined): SmsPriceTable {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const table: SmsPriceTable = {};
    for (const [key, value] of Object.entries(parsed)) {
      const price = Number(value);
      if ((key === 'default' || /^\d{1,4}$/.test(key)) && price > 0) {
        table[key] = price;
      }
    }
    return table;
  } catch {
    return {};
  }
}

/** Longest matching calling-code prefix wins (`1876` before `1`). */
export function pricePerSegment(
  e164: string,
  table: SmsPriceTable,
  fallbackPrice: number,
): number {
  const digits = e164.replace(/^\+/, '');
  for (let length = 4; length >= 1; length--) {
    const price = table[digits.slice(0, length)];
    if (price) return price;
  }
  return table.default ?? fallbackPrice;
}

/** Estimated cost in USD, rounded up to the 4 decimals of the counter. */
export function estimateSmsCost(
  e164: string,
  text: string,
  table: SmsPriceTable,
  fallbackPrice: number,
): { cost: number; segments: SmsSegments } {
  const segments = countSmsSegments(text);
  const raw = segments.segments * pricePerSegment(e164, table, fallbackPrice);
  // `toFixed` drops float noise first (0.0075 × 10 000 = 75.00000000000001).
  const cost = Math.ceil(Number((raw * 10_000).toFixed(6))) / 10_000;
  return { cost, segments };
}

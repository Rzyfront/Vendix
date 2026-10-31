/**
 * Masks a phone or email for logs: `+573001234567` → `+57*******67`,
 * `ana@shop.co` → `a***@shop.co`. Contact data never reaches logs in full.
 */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return '-';
  const at = address.indexOf('@');
  if (at > 0) return `${address[0]}***${address.slice(at)}`;
  const digits = address.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `+${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}

/**
 * Normalizes a phone to E.164 as Meta delivers it: digits only, prefixed
 * with `+`. Meta's `wa_id`/`from` carries the country code without `+`.
 * Returns null when there are no digits.
 */
export function toE164(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

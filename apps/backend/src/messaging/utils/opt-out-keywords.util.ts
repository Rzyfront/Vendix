/**
 * Marketing opt-out keywords of inbound WhatsApp messages (PLAN-CRM §5.1.6).
 * The whole message must be the keyword (case, accents, spaces and trailing
 * punctuation aside), so "no más rápido, por favor" never unsubscribes.
 */
const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'BAJA',
  'NO MAS',
  'DAR DE BAJA',
  'CANCELAR SUSCRIPCION',
  'UNSUBSCRIBE',
]);

export function isOptOutKeyword(text: string | null | undefined): boolean {
  if (!text || text.length > 40) return false;
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return OPT_OUT_KEYWORDS.has(normalized);
}

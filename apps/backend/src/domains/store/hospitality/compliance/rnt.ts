/**
 * Hospitality Suite (H4.3) — the hotel's Registro Nacional de Turismo (RNT):
 * where it is printed and the yearly renewal reminder. Pure pieces, shared by
 * the guest documents, the booking engine, the invoice footer and the
 * compliance reports that need it (exemption H3.9, TRA H4.1).
 *
 * D14: a missing RNT never blocks the hotel. It only explains why a legal
 * benefit does not apply (the VAT exemption needs it) or leaves a report as
 * "Pendiente"; check-in, check-out, invoicing and bookings keep working.
 */

/** Reason shown when a compliance step needs the RNT and the store has none. */
export const RNT_MISSING_REASON = 'La tienda no tiene RNT: regístralo en Configuración → Hotelería';

/** The RNT is renewed every year until March 31; the reminder runs that month. */
export const RNT_RENEWAL_MONTH = 3;

/** Where the owner updates the RNT and turns the reminder off. */
export const RNT_SETTINGS_ROUTE = '/admin/settings/general/hoteleria';

export interface RntSettings {
  rnt_number?: unknown;
  /** Owner can turn the March reminder off. Default on. */
  rnt_renewal_reminder?: unknown;
}

/** The trimmed RNT, or null when the store never set one. */
export function storeRnt(hospitality: RntSettings | null | undefined): string | null {
  const value = hospitality?.rnt_number;
  if (typeof value !== 'string') return null;
  const rnt = value.trim();
  return rnt ? rnt : null;
}

/** "RNT 12345" for the footer of a guest document; null without an RNT. */
export function rntLine(rnt: string | null | undefined): string | null {
  const value = rnt?.trim();
  return value ? `RNT ${value}` : null;
}

/** Invoice "Observaciones" with the RNT appended; untouched without an RNT. */
export function notesWithRnt(notes: string | null | undefined, rnt: string | null | undefined): string | undefined {
  const line = rntLine(rnt);
  const base = notes?.trim() || '';
  if (!line || base.includes(line)) return base || undefined;
  return base ? `${base} · ${line}` : line;
}

export interface RntRenewalNotice {
  title: string;
  body: string;
  data: { kind: 'rnt_renewal'; year: number; rnt_number: string; route: string };
}

/**
 * The renewal reminder of the store's local `year`/`month`, or null when it
 * does not apply: outside March, reminder turned off or no RNT to renew.
 */
export function rntRenewalNotice(
  hospitality: RntSettings | null | undefined,
  local: { year: number; month: number },
): RntRenewalNotice | null {
  if (local.month !== RNT_RENEWAL_MONTH) return null;
  if (hospitality?.rnt_renewal_reminder === false) return null;
  const rnt = storeRnt(hospitality);
  if (!rnt) return null;
  return {
    title: 'Renueva el RNT del hotel',
    body: `Renueva el Registro Nacional de Turismo (RNT) ${rnt} antes del 31 de marzo de ${local.year}. Si ya lo hiciste, ignora este aviso.`,
    data: { kind: 'rnt_renewal', year: local.year, rnt_number: rnt, route: RNT_SETTINGS_ROUTE },
  };
}

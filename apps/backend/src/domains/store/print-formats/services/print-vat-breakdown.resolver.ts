import { resolveVatResponsibility } from '@common/helpers/vat-responsibility.helper';

/**
 * C.1 (CP-pos-exclusive-tax-double-charge, ADR-12) — espejo backend de
 * `selectPrintsVatBreakdown` (frontend, `auth.selectors.ts:467-472`).
 *
 * El gate fiscal de impresión vivía SOLO en el frontend, pero el papel real
 * lo compone el backend (`pos-ticket.service.ts:235` →
 * `document-print.service.ts:366-403` → gateway). Y la cuenta QR-mesa y el
 * pedido de invitado son `@OptionalAuth`: no tienen usuario autenticado del
 * que sacar el estado fiscal. Este resolvedor se alimenta de las filas
 * `store`/`organization` que el provider ya trae en memoria, así que sirve
 * para esas superficies sin exponer `fiscal_data` crudo.
 *
 * Aplica los mismos dos hechos en el mismo orden que el selector:
 *   1. área fiscal `invoicing` activa: `fiscal_status.invoicing.state` ∈
 *      `{'ACTIVE','LOCKED'}` (espejo de `auth.selectors.ts:443-450`);
 *   2. responsabilidad de IVA: `resolveVatResponsibility(fiscal_data)`
 *      (fail-closed en indeterminado desde 2026-08-21).
 *
 * FAIL-CLOSED: cualquier estado fiscal indeterminado (sin settings, sin
 * `fiscal_status`, sin `fiscal_data`, estado distinto de ACTIVE/LOCKED,
 * responsabilidad indeterminada) devuelve `false`. Un papel no se retracta.
 *
 * Lectura scope-aware: usa EXACTAMENTE la misma regla que
 * `resolveFiscalIssuerForPrint` (`fiscal-issuer-identity.ts:83-91`):
 * `org?.fiscal_scope ?? 'STORE'` decide de qué settings salen AMBOS hechos.
 * No re-implementa precedencias — si esa regla cambia allá, debe cambiar
 * acá (ver el comentario de autoridad en ese archivo).
 */
export function resolvePrintsVatBreakdownForPrint(
  org: any,
  store: any,
): boolean {
  const scope: string = org?.fiscal_scope ?? 'STORE';
  const scoped_settings =
    scope === 'STORE'
      ? store?.store_settings?.settings
      : org?.organization_settings?.settings;

  // Hecho 1 — área `invoicing` activa. Ausente o en otro estado ⇒ false.
  const state = (scoped_settings as any)?.fiscal_status?.invoicing?.state;
  if (state !== 'ACTIVE' && state !== 'LOCKED') return false;

  // Hecho 2 — responsabilidad de IVA. `resolveVatResponsibility` ya es
  // fail-closed: indeterminado ⇒ `responsible === false`.
  const fiscal = ((scoped_settings as any)?.fiscal_data ?? null) as
    | Record<string, unknown>
    | null;
  return resolveVatResponsibility(fiscal).responsible;
}

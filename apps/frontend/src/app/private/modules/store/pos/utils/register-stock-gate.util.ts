import type { PosStockScope } from '../../../../../core/models/store-settings.interface';

/**
 * QUI-1006 — message the POS shows instead of the catalog under
 * "Bodega de la caja" while the cashier has no open register.
 */
export const REGISTER_REQUIRED_MESSAGE =
  'Inicia caja para mostrarte los productos';

/** Minimal session shape: only the status decides the gate. */
export interface RegisterGateSession {
  status?: string | null;
}

/**
 * QUI-1006 — under "Bodega de la caja" the open register IS the stock source:
 * without an open session the POS lists nothing and adds nothing. Any other
 * scope never gates (the catalog behaves exactly as before).
 */
export function isRegisterStockGateActive(
  scope: PosStockScope | null | undefined,
  session: RegisterGateSession | null | undefined,
): boolean {
  return scope === 'register_location' && session?.status !== 'open';
}

/**
 * QUI-1006 — barcode / scale-label lookups must travel with the POS scope
 * (`pos_optimized`) under "Bodega de la caja", so the backend applies the
 * register's warehouse filter to the scan too. Other scopes keep the plain
 * lookup they always used.
 */
export function requiresRegisterScopedLookup(
  scope: PosStockScope | null | undefined,
): boolean {
  return scope === 'register_location';
}

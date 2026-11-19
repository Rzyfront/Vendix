import type { PosStockScope } from '../../../../../core/models/store-settings.interface';
import {
  REGISTER_REQUIRED_MESSAGE,
  isRegisterStockGateActive,
  requiresRegisterScopedLookup,
} from './register-stock-gate.util';

/**
 * QUI-1006 — POS con alcance "Bodega de la caja": sin caja abierta no hay
 * catálogo ni se agregan ítems; con caja, el catálogo y el escaneo viajan con
 * el filtro de su bodega. "Todas las bodegas" / "Bodega principal" no cambian.
 */
describe('isRegisterStockGateActive', () => {
  it('bloquea bajo register_location sin sesión', () => {
    expect(isRegisterStockGateActive('register_location', null)).toBe(true);
    expect(isRegisterStockGateActive('register_location', undefined)).toBe(
      true,
    );
  });

  it('bloquea bajo register_location con la sesión cerrada o suspendida', () => {
    expect(
      isRegisterStockGateActive('register_location', { status: 'closed' }),
    ).toBe(true);
    expect(
      isRegisterStockGateActive('register_location', { status: 'suspended' }),
    ).toBe(true);
  });

  it('no bloquea bajo register_location con la caja abierta', () => {
    expect(
      isRegisterStockGateActive('register_location', { status: 'open' }),
    ).toBe(false);
  });

  it('nunca bloquea con otros alcances, haya o no caja (sin regresión)', () => {
    const scopes: (PosStockScope | null | undefined)[] = [
      'all_locations',
      'main_location',
      undefined,
      null,
    ];
    for (const scope of scopes) {
      expect(isRegisterStockGateActive(scope, null)).toBe(false);
      expect(isRegisterStockGateActive(scope, { status: 'closed' })).toBe(
        false,
      );
    }
  });

  it('muestra el mensaje pedido por el ticket', () => {
    expect(REGISTER_REQUIRED_MESSAGE).toBe(
      'Inicia caja para mostrarte los productos',
    );
  });
});

describe('requiresRegisterScopedLookup', () => {
  it('el escaneo viaja con el alcance del POS solo bajo register_location', () => {
    expect(requiresRegisterScopedLookup('register_location')).toBe(true);
    expect(requiresRegisterScopedLookup('all_locations')).toBe(false);
    expect(requiresRegisterScopedLookup('main_location')).toBe(false);
    expect(requiresRegisterScopedLookup(undefined)).toBe(false);
  });
});

import { RelationalActionMode } from '../dto/bulk-edit-products.dto';
import {
  planBulkPriceTierUpdate,
  resolveBulkPriceTierTarget,
} from './bulk-price-tier-action.util';

describe('resolveBulkPriceTierTarget', () => {
  it('add: unión con las tarifas actuales, sin duplicados', () => {
    expect(
      resolveBulkPriceTierTarget(RelationalActionMode.ADD, [2, 3], [1, 2]).sort(),
    ).toEqual([1, 2, 3]);
  });

  it('remove: diferencia; ids que el producto no tiene no son error', () => {
    expect(
      resolveBulkPriceTierTarget(RelationalActionMode.REMOVE, [2, 99], [1, 2]),
    ).toEqual([1]);
  });

  it('remove de todas las tarifas deja el conjunto vacío', () => {
    expect(
      resolveBulkPriceTierTarget(RelationalActionMode.REMOVE, [1, 2], [1, 2]),
    ).toEqual([]);
  });

  it('replace: exactamente ids', () => {
    expect(
      resolveBulkPriceTierTarget(RelationalActionMode.REPLACE, [5], [1, 2]),
    ).toEqual([5]);
  });
});

describe('planBulkPriceTierUpdate', () => {
  it('conjunto destino no vacío con flag apagado ⇒ envía has_multiple_price_tiers: true', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.ADD,
      ids: [3],
      currentIds: [],
      currentFlag: false,
    });
    expect(plan.payload).toEqual({
      enabled_price_tier_ids: [3],
      has_multiple_price_tiers: true,
    });
    expect(plan.changed).toBe(true);
  });

  it('replace idéntico con flag encendido ⇒ payload vacío (sin escrituras)', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.REPLACE,
      ids: [2, 1],
      currentIds: [1, 2],
      currentFlag: true,
    });
    expect(plan.payload).toEqual({});
    expect(plan.changed).toBe(false);
  });

  it('mismo conjunto con flag apagado ⇒ solo enciende el flag', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.REPLACE,
      ids: [1],
      currentIds: [1],
      currentFlag: false,
    });
    expect(plan.payload).toEqual({ has_multiple_price_tiers: true });
    expect(plan.changed).toBe(true);
  });

  it('conjunto destino vacío ⇒ no toca el flag', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.REMOVE,
      ids: [1],
      currentIds: [1],
      currentFlag: true,
    });
    expect(plan.payload).toEqual({ enabled_price_tier_ids: [] });
    expect(plan.payload).not.toHaveProperty('has_multiple_price_tiers');
  });

  it('remove de ids que el producto no tiene ⇒ sin cambios', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.REMOVE,
      ids: [9],
      currentIds: [1],
      currentFlag: true,
    });
    expect(plan.changed).toBe(false);
    expect(plan.payload).toEqual({});
  });

  it('remove con flag apagado ⇒ NO enciende multi-tarifa', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.REMOVE,
      ids: [1],
      currentIds: [1, 2],
      currentFlag: false,
    });
    expect(plan.targetIds).toEqual([2]);
    expect(plan.enablesFlag).toBe(false);
    expect(plan.payload).toEqual({ enabled_price_tier_ids: [2] });
  });

  it('remove de una tarifa ajena con flag apagado ⇒ sin cambios ni flag', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.REMOVE,
      ids: [9],
      currentIds: [1],
      currentFlag: false,
    });
    expect(plan.enablesFlag).toBe(false);
    expect(plan.changed).toBe(false);
    expect(plan.payload).toEqual({});
  });

  it('flag explícito en el lote ⇒ la acción no lo reenvía', () => {
    const plan = planBulkPriceTierUpdate({
      mode: RelationalActionMode.ADD,
      ids: [1],
      currentIds: [],
      currentFlag: false,
      explicitFlag: true,
    });
    expect(plan.payload).toEqual({ enabled_price_tier_ids: [1] });
  });
});

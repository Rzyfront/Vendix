import {
  NON_SELLABLE_LOCATION_TYPES,
  displayableStockLevelsWhere,
  resolvePosStockScope,
  sellableLocationsWhere,
  sellableStockLevelsWhere,
} from './pos-stock-scope.helper';
import type { StoreSettings } from '../../../settings/interfaces/store-settings.interface';

/**
 * QUI-559 — contrato "lo que el POS muestra es un subconjunto de lo que puede cobrar".
 *
 * El bug no fue un filtro mal escrito: fue que TRES capas escribieron el mismo
 * filtro por separado (listado sin filtro de ubicación, validación previa con
 * el filtro completo, reserva/commit con UNA ubicación). Estos tests fijan el
 * predicado canónico y, sobre un fixture con las cuatro clases de ubicación
 * (vendible, inactiva, central, cuarentena), afirman que la suma mostrada y la
 * suma validada coinciden — el invariante que hizo posible el 409 con stock.
 */

/** Fila mínima de `inventory_locations` para evaluar el predicado en memoria. */
interface LocationRow {
  id: number;
  store_id: number;
  is_active: boolean;
  is_central_warehouse: boolean;
  type: string;
}

/** Fila mínima de `stock_levels` ligada a una ubicación del fixture. */
interface StockLevelRow {
  location_id: number;
  quantity_available: number;
}

const STORE_ID = 7;
const OTHER_STORE_ID = 8;

/** Las cuatro clases de ubicación + una de otra tienda (fuga multi-tenant). */
const LOCATIONS: LocationRow[] = [
  {
    id: 1,
    store_id: STORE_ID,
    is_active: true,
    is_central_warehouse: false,
    type: 'store',
  },
  {
    id: 2,
    store_id: STORE_ID,
    is_active: true,
    is_central_warehouse: false,
    type: 'warehouse',
  },
  {
    id: 3,
    store_id: STORE_ID,
    is_active: false,
    is_central_warehouse: false,
    type: 'warehouse',
  },
  {
    id: 4,
    store_id: STORE_ID,
    is_active: true,
    is_central_warehouse: true,
    type: 'warehouse',
  },
  {
    id: 5,
    store_id: STORE_ID,
    is_active: true,
    is_central_warehouse: false,
    type: 'quarantine',
  },
  {
    id: 6,
    store_id: OTHER_STORE_ID,
    is_active: true,
    is_central_warehouse: false,
    type: 'store',
  },
];

/** Un producto con existencias repartidas en TODAS las clases de ubicación. */
const STOCK_LEVELS: StockLevelRow[] = [
  { location_id: 1, quantity_available: 2 },
  { location_id: 2, quantity_available: 8 },
  { location_id: 3, quantity_available: 10 }, // inactiva
  { location_id: 4, quantity_available: 50 }, // bodega central
  { location_id: 5, quantity_available: 4 }, // cuarentena
  { location_id: 6, quantity_available: 99 }, // otra tienda
];

/**
 * Evalúa el `where` de `inventory_locations` que devuelve el helper contra una
 * fila en memoria. Interpreta las claves que el helper realmente emite; si el
 * helper agregara una clave nueva sin soporte aquí, el test falla en lugar de
 * ignorarla en silencio.
 */
function matchesLocationWhere(
  where: Record<string, any>,
  location: LocationRow,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'type' && expected && typeof expected === 'object') {
      return !(expected.notIn as string[]).includes(location.type);
    }
    if (['store_id', 'is_active', 'is_central_warehouse'].includes(key)) {
      return (location as any)[key] === expected;
    }
    throw new Error(`Clave no soportada en el where de ubicación: ${key}`);
  });
}

/** Suma las existencias que sobreviven a un `where` de `stock_levels`. */
function sumUnder(where: Record<string, any>): number {
  const locationWhere = where.inventory_locations as Record<string, any>;
  const pinnedLocationId = where.location_id as number | undefined;

  return STOCK_LEVELS.filter((level) => {
    if (pinnedLocationId != null && level.location_id !== pinnedLocationId) {
      return false;
    }
    const location = LOCATIONS.find((l) => l.id === level.location_id)!;
    return matchesLocationWhere(locationWhere, location);
  }).reduce((sum, level) => sum + level.quantity_available, 0);
}

const settingsWith = (scope: 'main_location' | 'all_locations'): StoreSettings =>
  ({ inventory: { pos_stock_scope: scope } }) as unknown as StoreSettings;

describe('sellableLocationsWhere', () => {
  const where = sellableLocationsWhere(STORE_ID);

  it('acepta la ubicación de tienda activa y la bodega activa no central', () => {
    expect(matchesLocationWhere(where, LOCATIONS[0])).toBe(true);
    expect(matchesLocationWhere(where, LOCATIONS[1])).toBe(true);
  });

  it('rechaza inactiva, bodega central y cuarentena', () => {
    expect(matchesLocationWhere(where, LOCATIONS[2])).toBe(false); // is_active=false
    expect(matchesLocationWhere(where, LOCATIONS[3])).toBe(false); // central
    expect(matchesLocationWhere(where, LOCATIONS[4])).toBe(false); // quarantine
  });

  it('rechaza ubicaciones de otra tienda (aislamiento multi-tenant)', () => {
    expect(matchesLocationWhere(where, LOCATIONS[5])).toBe(false);
  });

  it('excluye damaged_goods además de quarantine', () => {
    expect([...NON_SELLABLE_LOCATION_TYPES]).toEqual([
      'quarantine',
      'damaged_goods',
    ]);
    expect(
      matchesLocationWhere(where, {
        ...LOCATIONS[1],
        type: 'damaged_goods',
      }),
    ).toBe(false);
  });
});

describe('QUI-559 — contrato: lo mostrado ≡ lo cobrable', () => {
  it('bajo all_locations, la suma mostrada es exactamente la suma validada', () => {
    const scope = resolvePosStockScope({ default_location_id: 1 }, settingsWith('all_locations'));

    const displayed = sumUnder(displayableStockLevelsWhere(STORE_ID, scope));
    const validated = sumUnder(sellableStockLevelsWhere(STORE_ID));

    // 2 (loc 1) + 8 (loc 2). Nunca las 10 inactivas, las 50 centrales,
    // las 4 en cuarentena ni las 99 de la otra tienda.
    expect(displayed).toBe(10);
    expect(displayed).toBe(validated);
  });

  it('bajo main_location, lo mostrado es un SUBCONJUNTO de lo cobrable (nunca al revés)', () => {
    const scope = resolvePosStockScope({ default_location_id: 1 }, settingsWith('main_location'));

    const displayed = sumUnder(displayableStockLevelsWhere(STORE_ID, scope));
    const validated = sumUnder(sellableStockLevelsWhere(STORE_ID));

    expect(displayed).toBe(2); // solo la ubicación principal
    expect(displayed).toBeLessThanOrEqual(validated);
  });

  it('main_location sin default_location_id degrada a all_locations sin mostrar stock no vendible', () => {
    const scope = resolvePosStockScope(
      { default_location_id: null },
      settingsWith('main_location'),
    );

    expect(scope).toEqual({ scope: 'all_locations', mainLocationId: null });
    expect(sumUnder(displayableStockLevelsWhere(STORE_ID, scope))).toBe(10);
  });

  it('el display nunca incluye una unidad que la validación excluya', () => {
    for (const scope of [
      resolvePosStockScope({ default_location_id: 1 }, settingsWith('main_location')),
      resolvePosStockScope({ default_location_id: 1 }, settingsWith('all_locations')),
    ]) {
      expect(sumUnder(displayableStockLevelsWhere(STORE_ID, scope))).toBeLessThanOrEqual(
        sumUnder(sellableStockLevelsWhere(STORE_ID)),
      );
    }
  });
});

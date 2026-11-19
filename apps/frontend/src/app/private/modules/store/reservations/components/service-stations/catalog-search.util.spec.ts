import { CATALOG_FETCH_LIMIT, CATALOG_INITIAL_LIMIT, CATALOG_SEARCH_LIMIT, mergeById } from './catalog-search.util';

describe('QUI-1030 catalog-search.util', () => {
  it('muestra 5 al abrir y pide holgura al servidor', () => {
    expect(CATALOG_INITIAL_LIMIT).toBe(5);
    expect(CATALOG_SEARCH_LIMIT).toBeGreaterThanOrEqual(CATALOG_INITIAL_LIMIT);
    expect(CATALOG_FETCH_LIMIT).toBeGreaterThanOrEqual(CATALOG_SEARCH_LIMIT);
  });

  it('mergeById conserva lo elegido antes y actualiza por id', () => {
    const cache = [{ id: 1, name: 'Aceite' }, { id: 2, name: 'Filtro' }];
    const merged = mergeById(cache, [{ id: 2, name: 'Filtro v2' }, { id: 3, name: 'Gaseosa' }]);
    expect(merged.map((p) => p.id).sort()).toEqual([1, 2, 3]);
    expect(merged.find((p) => p.id === 2)?.name).toBe('Filtro v2');
  });

  it('mergeById sin resultados devuelve la misma caché', () => {
    const cache = [{ id: 1 }];
    expect(mergeById(cache, [])).toBe(cache);
  });
});

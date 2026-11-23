import { buildCrmFilterConfigs, mergeFilterValues, toCrmFilterId } from './crm-filters.util';

describe('crm-filters.util', () => {
  it('sin valores no construye ningún filtro', () => {
    expect(buildCrmFilterConfigs([], [])).toEqual([]);
    expect(buildCrmFilterConfigs(null, undefined)).toEqual([]);
  });

  it('solo construye el filtro que tiene valores', () => {
    const onlyTags = buildCrmFilterConfigs([], [{ id: 4, name: 'VIP' }]);
    expect(onlyTags.map((config) => config.key)).toEqual(['tag']);
    expect(onlyTags[0].options).toEqual([{ value: '4', label: 'VIP' }]);

    const onlySegments = buildCrmFilterConfigs([{ id: 9, name: 'Compradores' }], []);
    expect(onlySegments.map((config) => config.key)).toEqual(['segment']);
  });

  it('con los dos valores los pinta en orden segmento y etiqueta', () => {
    const configs = buildCrmFilterConfigs(
      [{ id: 9, name: 'Compradores' }],
      [{ id: 4, name: 'VIP' }],
    );
    expect(configs.map((config) => config.key)).toEqual(['segment', 'tag']);
    expect(configs.every((config) => config.type === 'select')).toBe(true);
  });

  it('el id del select se convierte a número y lo inválido no filtra', () => {
    expect(toCrmFilterId('12')).toBe(12);
    expect(toCrmFilterId(0)).toBeUndefined();
    expect(toCrmFilterId('')).toBeUndefined();
    expect(toCrmFilterId('abc')).toBeUndefined();
  });

  it('conserva segmento y etiqueta al cambiar departamento (no borra el filtro)', () => {
    const previous = { department: null, city: null, segment: '9', tag: '4' };

    const same = mergeFilterValues<Record<string, string | null>>({ department: null, city: null, segment: '9', tag: '4' }, previous);
    expect(same.merged).toEqual({ department: null, city: null, segment: '9', tag: '4' });
    expect(same.city).toBeNull();

    const changed = mergeFilterValues<Record<string, string | null>>({ department: '05', city: '05001', segment: '9', tag: '4' }, previous);
    expect(changed.department).toBe('05');
    // Departamento nuevo invalida la ciudad anterior, pero NO el filtro del CRM.
    expect(changed.city).toBeNull();
    expect(changed.merged).toEqual({ department: '05', city: null, segment: '9', tag: '4' });
  });

  it('al cambiar de departamento la ciudad se limpia, el CRM se conserva', () => {
    const previous = { department: '05', city: '05001', segment: '9' };
    const next = mergeFilterValues<Record<string, string | null>>({ department: '11', city: '05001', segment: '9' }, previous);
    expect(next.city).toBeNull();
    expect(next.merged).toEqual({ department: '11', city: null, segment: '9' });
  });
});

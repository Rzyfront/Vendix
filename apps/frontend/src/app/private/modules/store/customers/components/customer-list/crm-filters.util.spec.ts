import { buildCrmFilterConfigs, toCrmFilterId } from './crm-filters.util';

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
});

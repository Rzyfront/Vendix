import {
  productionSiteMissing,
  productionSiteOptions,
  productionSiteRequired,
  productionSiteVisible,
  usesProductionDestinations,
} from './production-site.util';

describe('production-site.util — dónde se produce', () => {
  const both = ['restaurant', 'manufacturing'];

  it('the POS offers Stock / Producción in restaurant and manufacturing stores only', () => {
    expect(usesProductionDestinations(['restaurant'])).toBe(true);
    expect(usesProductionDestinations(['manufacturing'])).toBe(true);
    expect(usesProductionDestinations(both)).toBe(true);
    expect(usesProductionDestinations(['retail'])).toBe(false);
    expect(usesProductionDestinations([])).toBe(false);
  });

  it('restaurant only never shows the field (everything goes to Cocina, as before)', () => {
    expect(productionSiteVisible(['restaurant'], true)).toBe(false);
    expect(productionSiteRequired(['restaurant'], true)).toBe(false);
  });

  it('manufacturing only shows it as optional (empty = main plant)', () => {
    expect(productionSiteVisible(['manufacturing'], true)).toBe(true);
    expect(productionSiteRequired(['manufacturing'], true)).toBe(false);
    expect(productionSiteMissing(['manufacturing'], true, null)).toBe(false);
  });

  it('restaurant + manufacturing: required for batch products and warns while empty', () => {
    expect(productionSiteRequired(both, true)).toBe(true);
    expect(productionSiteMissing(both, true, null)).toBe(true);
    expect(productionSiteMissing(both, true, 'plant')).toBe(false);
    expect(productionSiteRequired(both, false)).toBe(false);
  });

  it('Cocina is offered only to restaurants', () => {
    expect(productionSiteOptions(both).map((o) => o.value)).toEqual(['kitchen', 'plant']);
    expect(productionSiteOptions(['manufacturing']).map((o) => o.value)).toEqual(['plant']);
  });
});

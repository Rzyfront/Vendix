import {
  productionSiteRequired,
  productionSiteWhere,
  resolveProductionSite,
} from './production-site.util';

describe('resolveProductionSite — where a producible product is made', () => {
  it('manufacturing only, product without site → plant (main plant)', () => {
    expect(resolveProductionSite({ industries: ['manufacturing'] })).toEqual({
      site: 'plant',
      missing: false,
    });
  });

  it('restaurant only, product without site → kitchen (today behavior)', () => {
    expect(resolveProductionSite({ industries: ['restaurant'] })).toEqual({
      site: 'kitchen',
      missing: false,
    });
  });

  it('restaurant + manufacturing without site → kitchen fallback flagged as missing', () => {
    expect(resolveProductionSite({ industries: ['restaurant', 'manufacturing'] })).toEqual({
      site: 'kitchen',
      missing: true,
    });
  });

  it('the product site wins over the industry', () => {
    expect(
      resolveProductionSite({ industries: ['restaurant', 'manufacturing'], productSite: 'plant' }),
    ).toEqual({ site: 'plant', missing: false });
    expect(
      resolveProductionSite({ industries: ['manufacturing'], productSite: 'kitchen' }),
    ).toEqual({ site: 'kitchen', missing: false });
  });

  it('an unknown site value is ignored (industry decides)', () => {
    expect(resolveProductionSite({ industries: ['manufacturing'], productSite: 'x' }).site).toBe(
      'plant',
    );
  });

  it('the site is required only when the store has both industries', () => {
    expect(productionSiteRequired(['restaurant', 'manufacturing'])).toBe(true);
    expect(productionSiteRequired(['restaurant'])).toBe(false);
    expect(productionSiteRequired(['manufacturing'])).toBe(false);
    expect(productionSiteRequired(null)).toBe(false);
  });
});

describe('productionSiteWhere — each screen sees only its own orders', () => {
  /** Evaluates the Prisma where on a plain row (only the shapes the util uses). */
  const matches = (where: any, row: Record<string, unknown>): boolean => {
    return Object.entries(where).every(([key, cond]: [string, any]) => {
      if (key === 'OR') return (cond as any[]).some((c) => matches(c, row));
      if (key === 'AND') return (cond as any[]).every((c) => matches(c, row));
      if (cond !== null && typeof cond === 'object' && 'not' in cond) {
        return row[key] != null && row[key] !== cond.not;
      }
      return (row[key] ?? null) === cond;
    });
  };
  const kitchen = productionSiteWhere('kitchen');
  const plant = productionSiteWhere('plant');

  const rows: Array<[string, Record<string, unknown>, 'kitchen' | 'plant']> = [
    ['sale order marked kitchen', { production_site: 'kitchen', order_number: 'OP-1', source: 'order' }, 'kitchen'],
    ['sale order marked plant', { production_site: 'plant', order_number: 'OP-2', source: 'order' }, 'plant'],
    ['new Producción manual order', { production_site: 'kitchen', order_number: null, source: null }, 'kitchen'],
    ['new Planta manual order', { production_site: 'plant', order_number: 'OP-3', source: 'manual' }, 'plant'],
    ['legacy restaurant manual order (no consecutive)', { production_site: null, order_number: null, source: null }, 'kitchen'],
    ['legacy Planta manual order', { production_site: null, order_number: 'OP-4', source: 'manual' }, 'plant'],
    ['legacy Planta order without source', { production_site: null, order_number: 'OP-5', source: null }, 'plant'],
    ['legacy sale-born order (restaurant sale)', { production_site: null, order_number: 'OP-6', source: 'order' }, 'kitchen'],
  ];

  it.each(rows)('%s → exactly one screen', (_label, row, owner) => {
    expect(matches(kitchen, row)).toBe(owner === 'kitchen');
    expect(matches(plant, row)).toBe(owner === 'plant');
  });
});

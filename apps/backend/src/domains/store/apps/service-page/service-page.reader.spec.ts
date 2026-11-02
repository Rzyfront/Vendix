import {
  MAX_LISTED_SERVICES,
  onlineServicesWhere,
  orderServices,
  parseServicePageConfig,
  secondaryProductsWhere,
} from './service-page.reader';

describe('service page reader', () => {
  describe('onlineServicesWhere', () => {
    it('without ids, lists every online service of the store', () => {
      const where = onlineServicesWhere(7);
      expect(where).toMatchObject({
        store_id: 7,
        state: 'active',
        available_for_ecommerce: true,
        usage_nature: 'sale',
        product_type: 'service',
      });
      expect(where).not.toHaveProperty('id');
    });

    it('with ids, restricts to them in the same store', () => {
      expect(onlineServicesWhere(7, [1, 2])).toMatchObject({
        store_id: 7,
        id: { in: [1, 2] },
        product_type: 'service',
      });
    });
  });

  it('secondary products exclude services', () => {
    expect(secondaryProductsWhere(7, [3])).toMatchObject({
      store_id: 7,
      id: { in: [3] },
      product_type: { not: 'service' },
    });
  });

  it('parses the stored config defensively', () => {
    expect(parseServicePageConfig(null)).toEqual({
      featured_service_ids: [],
      product_ids: [],
      custom_domain_previous_app_type: null,
    });
    expect(
      parseServicePageConfig({
        featured_service_ids: [4, 'x', 2.5, 9],
        product_ids: 'nope',
        custom_domain_previous_app_type: 'STORE_LANDING',
      }),
    ).toEqual({
      featured_service_ids: [4, 9],
      product_ids: [],
      custom_domain_previous_app_type: 'STORE_LANDING',
    });
  });

  describe('orderServices', () => {
    const services = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

    it('puts the featured services first, in the owner order', () => {
      const result = orderServices(services, [3, 1]);
      expect(result.services.map((s) => s.id)).toEqual([3, 1, 2, 4]);
      expect(result.featuredIds).toEqual([3, 1]);
    });

    it('drops featured ids that are no longer online services', () => {
      const result = orderServices(services, [99, 2]);
      expect(result.featuredIds).toEqual([2]);
      expect(result.services.map((s) => s.id)).toEqual([2, 1, 3, 4]);
    });

    it('caps the list', () => {
      const many = Array.from({ length: MAX_LISTED_SERVICES + 5 }, (_, i) => ({ id: i + 1 }));
      expect(orderServices(many, []).services).toHaveLength(MAX_LISTED_SERVICES);
    });
  });
});

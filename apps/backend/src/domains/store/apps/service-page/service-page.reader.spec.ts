import {
  MAX_LISTED_SERVICES,
  onlineServicesWhere,
  orderServices,
  manualServiceIds,
  parseServicePageConfig,
  readPublishedServicePage,
  secondaryProductsWhere,
  selectPageServices,
} from './service-page.reader';
import type { AppPageDocument } from '../shared/app-page.contract';
import type { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

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
      custom_domain_aliases: [],
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
      custom_domain_aliases: [],
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
  describe('selector de servicios (apps-booking-detail A)', () => {
    const page = (props: Record<string, unknown>, enabled = true): AppPageDocument => ({
      schema_version: 1,
      blocks: [{ id: 'services', type: 'services', enabled, props }],
    });

    it('manualServiceIds: solo en modo manual; auto o sin página no usan los ids guardados', () => {
      expect(manualServiceIds(null)).toBeNull();
      expect(manualServiceIds(page({ service_ids: [3, 1] }))).toBeNull();
      expect(manualServiceIds(page({ selection: 'auto', service_ids: [3, 1] }))).toBeNull();
      expect(manualServiceIds(page({ selection: 'manual', service_ids: [3, 1] }))).toEqual([3, 1]);
      expect(manualServiceIds(page({ selection: 'manual' }))).toEqual([]);
    });

    it('selectPageServices en manual respeta el orden elegido y descarta ids que no son servicios en línea de la tienda', () => {
      const store = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      const result = selectPageServices(store, [4, 2], [3, 99, 4]);
      expect(result.services.map((s) => s.id)).toEqual([3, 4]);
      expect(result.featuredIds).toEqual([4]);
    });

    it('selectPageServices en auto es el orden de siempre (destacados primero)', () => {
      const store = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(selectPageServices(store, [3], null)).toEqual(orderServices(store, [3]));
    });

    it('readPublishedServicePage lista solo los servicios manuales, leídos con el store_id de la petición', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: 1, slug: 'corte', updated_at: null },
        { id: 2, slug: 'tinte', updated_at: null },
        { id: 3, slug: 'manicure', updated_at: null },
      ]);
      const prisma = {
        store_apps: {
          findFirst: jest.fn().mockResolvedValue({
            config: {
              featured_service_ids: [1],
              page: {
                schema_version: 1,
                blocks: [
                  {
                    id: 'services',
                    type: 'services',
                    props: { selection: 'manual', service_ids: [3, 77, 1] },
                  },
                ],
              },
            },
          }),
        },
        products: { findMany },
      } as unknown as GlobalPrismaService;

      const result = await readPublishedServicePage(prisma, 7);

      expect(result?.services.map((s) => s.id)).toEqual([3, 1]);
      expect(result?.featured_service_ids).toEqual([1]);
      // Id 77 (otra tienda o fuera de línea) nunca se consulta por fuera del scope de la tienda.
      expect(findMany.mock.calls[0][0].where).toMatchObject({ store_id: 7, product_type: 'service' });
      expect(findMany.mock.calls[0][0].where).not.toHaveProperty('id');
    });

    it('readPublishedServicePage en manual sin servicios válidos sigue publicada con la lista vacía', async () => {
      const prisma = {
        store_apps: {
          findFirst: jest.fn().mockResolvedValue({
            config: {
              page: {
                schema_version: 1,
                blocks: [{ id: 's', type: 'services', props: { selection: 'manual', service_ids: [77] } }],
              },
            },
          }),
        },
        products: { findMany: jest.fn().mockResolvedValue([{ id: 1, slug: 'corte', updated_at: null }]) },
      } as unknown as GlobalPrismaService;

      const result = await readPublishedServicePage(prisma, 7);
      expect(result).not.toBeNull();
      expect(result?.services).toEqual([]);
    });
  });
});

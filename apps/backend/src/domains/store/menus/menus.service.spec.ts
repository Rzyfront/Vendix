import { Test, TestingModule } from '@nestjs/testing';
import { MenusService } from './menus.service';
import { MenuSectionsService } from './menu-sections.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * Targeted unit tests for the menu/section ownership and uniqueness
 * invariants in `MenuSectionsService`. We mock the scoped Prisma client
 * and exercise the parts that do not require a live database.
 */
describe('MenusService / MenuSectionsService — ownership & uniqueness', () => {
  const STORE_ID = 50;

  // Hoisted so the S3-signing tests can reach the mocks that `buildMenusModule`
  // wires, without changing the existing call sites.
  let prismaMock: any;
  let s3Mock: { signUrl: jest.Mock };

  const buildMenusModule = (
    menus: Record<number, { id: number; store_id: number; name: string }>,
    sections: Record<
      number,
      { id: number; store_id: number; menu_id: number; name: string }
    >,
    products: Record<number, any>,
  ) => {
    prismaMock = {
      menus: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.id != null) return Promise.resolve(menus[where.id] ?? null);
          if (where?.store_id != null && where?.name != null) {
            return Promise.resolve(
              Object.values(menus).find(
                (m) => m.store_id === where.store_id && m.name === where.name,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(
            Object.values(menus).filter((m) => m.store_id === where.store_id),
          );
        }),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 9000,
          is_active: true,
          ...data,
        })),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          id: 9000,
          ...data,
        })),
        count: jest.fn().mockResolvedValue(0),
      },
      menu_sections: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.id != null && where?.store_id != null) {
            const sec = sections[where.id];
            return Promise.resolve(
              sec && sec.store_id === where.store_id ? sec : null,
            );
          }
          if (where?.menu_id != null && where?.name != null) {
            return Promise.resolve(
              Object.values(sections).find(
                (s) =>
                  s.menu_id === where.menu_id && s.name === where.name,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 9100,
          ...data,
        })),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          id: 9100,
          ...data,
        })),
        delete: jest.fn().mockResolvedValue({ id: 9100 }),
      },
      products: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(products[where.id] ?? null);
        }),
        // `addItem` promueve is_sellable / available_for_ecommerce cuando el
        // plato no es vendible todavia (menu-sections.service.ts:173). Sin este
        // mock la promocion revienta con TypeError y enmascara el aserto real.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      menu_section_items: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $transaction: jest.fn().mockImplementation((ops: Promise<any>[]) =>
        Promise.all(ops),
      ),
    };

    // Stands in for the real presigner: returns a marker URL so a test can tell
    // a signed value from the raw S3 key it was built from (QUI-643).
    s3Mock = {
      signUrl: jest
        .fn()
        .mockImplementation(async (key?: string | null) =>
          key ? `https://signed.example/${key}?sig=abc` : undefined,
        ),
    };

    return Test.createTestingModule({
      providers: [
        MenusService,
        MenuSectionsService,
        { provide: StorePrismaService, useValue: prismaMock },
        { provide: S3Service, useValue: s3Mock },
        {
          provide: RequestContextService,
          useValue: { getContext: () => ({ store_id: STORE_ID }) },
        },
      ],
    }).compile();
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID } as any);
  });

  it('rejects creating a section under a non-existent menu', async () => {
    const mod: TestingModule = await buildMenusModule(
      {},
      {},
      {},
    );
    const sections = mod.get(MenuSectionsService);
    await expect(
      sections.createSection(999, { name: 'Platos Fuertes' }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects duplicate section name within the same menu', async () => {
    const mod: TestingModule = await buildMenusModule(
      { 1: { id: 1, store_id: STORE_ID, name: 'Lunch' } },
      { 10: { id: 10, store_id: STORE_ID, menu_id: 1, name: 'Entradas' } },
      {},
    );
    const sections = mod.get(MenuSectionsService);
    await expect(
      sections.createSection(1, { name: 'Entradas' }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects adding a product that does not belong to the store', async () => {
    const mod: TestingModule = await buildMenusModule(
      { 1: { id: 1, store_id: STORE_ID, name: 'Lunch' } },
      { 10: { id: 10, store_id: STORE_ID, menu_id: 1, name: 'Entradas' } },
      {},
    );
    const sections = mod.get(MenuSectionsService);
    await expect(
      sections.addItem(1, 10, { product_id: 99 }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  // `addItem` NO rechaza un plato no vendible: lo promueve, para que aparezca
  // en la carta publica y sea comprable (menu-sections.service.ts:170-182).
  // Este test cubre esa promocion; antes afirmaba un rechazo que el servicio
  // dejo de hacer, y moria con TypeError por el mock incompleto.
  it('promotes storefront-visibility flags when the dish is not sellable yet', async () => {
    const mod: TestingModule = await buildMenusModule(
      { 1: { id: 1, store_id: STORE_ID, name: 'Lunch' } },
      { 10: { id: 10, store_id: STORE_ID, menu_id: 1, name: 'Entradas' } },
      {
        99: {
          id: 99,
          store_id: STORE_ID,
          is_sellable: false,
          available_for_ecommerce: false,
          state: 'active',
        },
      },
    );
    prismaMock.menu_section_items.create.mockResolvedValueOnce({
      id: 500,
      product: null,
    });

    const sections = mod.get(MenuSectionsService);
    await sections.addItem(1, 10, { product_id: 99 });

    expect(prismaMock.products.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99, store_id: STORE_ID },
        data: expect.objectContaining({
          is_sellable: true,
          available_for_ecommerce: true,
        }),
      }),
    );
  });

  // ------------------------------------------------------------------ QUI-643
  // El dominio menus nunca firmaba las imagenes: devolvia la key cruda de S3 en
  // `image_url` y el <img> del builder caia al placeholder. Estos dos tests
  // cubren los dos sintomas del mismo defecto.

  it('findFull signs each product image instead of leaking the raw S3 key', async () => {
    const mod: TestingModule = await buildMenusModule(
      { 1: { id: 1, store_id: STORE_ID, name: 'Lunch' } },
      {},
      {},
    );
    prismaMock.menus.findFirst.mockResolvedValueOnce({
      id: 1,
      store_id: STORE_ID,
      name: 'Lunch',
      availability_windows: [],
      sections: [
        {
          id: 10,
          name: 'Entradas',
          availability_windows: [],
          items: [
            {
              id: 100,
              product: {
                id: 99,
                name: 'Arroz chino',
                product_images: [{ image_url: 'stores/1/products/99/main.webp' }],
              },
            },
            // Producto sin imagen: el contrato plano debe seguir siendo `null`,
            // no el `undefined` que devuelve signUrl.
            { id: 101, product: { id: 98, name: 'Agua', product_images: [] } },
            // Item sin producto: se devuelve tal cual, sin tocar.
            { id: 102, product: null },
          ],
        },
      ],
    });

    const menus = mod.get(MenusService);
    const full: any = await menus.findFull(1);
    const items = full.sections[0].items;

    expect(items[0].product.image_url).toBe(
      'https://signed.example/stores/1/products/99/main.webp?sig=abc',
    );
    expect(items[0].product.product_images).toBeUndefined();
    expect(items[1].product.image_url).toBeNull();
    expect(items[2].product).toBeNull();
    expect(s3Mock.signUrl).toHaveBeenCalledWith(
      'stores/1/products/99/main.webp',
    );
  });

  it('addItem returns the new item with a signed image, not a bare key', async () => {
    const mod: TestingModule = await buildMenusModule(
      { 1: { id: 1, store_id: STORE_ID, name: 'Lunch' } },
      { 10: { id: 10, store_id: STORE_ID, menu_id: 1, name: 'Entradas' } },
      {
        99: {
          id: 99,
          store_id: STORE_ID,
          is_sellable: true,
          available_for_ecommerce: true,
          state: 'active',
        },
      },
    );
    prismaMock.menu_section_items.create.mockResolvedValueOnce({
      id: 500,
      menu_section_id: 10,
      product_id: 99,
      sort_order: 0,
      product: {
        id: 99,
        name: 'Arroz chino',
        product_images: [{ image_url: 'stores/1/products/99/main.webp' }],
      },
    });

    const sections = mod.get(MenuSectionsService);
    const created: any = await sections.addItem(1, 10, { product_id: 99 });

    expect(created.product.image_url).toBe(
      'https://signed.example/stores/1/products/99/main.webp?sig=abc',
    );
    expect(created.product.product_images).toBeUndefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { MenusService } from './menus.service';
import { MenuSectionsService } from './menu-sections.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * Targeted unit tests for the menu/section ownership and uniqueness
 * invariants in `MenuSectionsService`. We mock the scoped Prisma client
 * and exercise the parts that do not require a live database.
 */
describe('MenusService / MenuSectionsService — ownership & uniqueness', () => {
  const STORE_ID = 50;

  const buildMenusModule = (
    menus: Record<number, { id: number; store_id: number; name: string }>,
    sections: Record<
      number,
      { id: number; store_id: number; menu_id: number; name: string }
    >,
    products: Record<number, any>,
  ) => {
    const prismaMock = {
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
      },
      menu_section_items: {
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $transaction: jest.fn().mockImplementation((ops: Promise<any>[]) =>
        Promise.all(ops),
      ),
    };

    return Test.createTestingModule({
      providers: [
        MenusService,
        MenuSectionsService,
        { provide: StorePrismaService, useValue: prismaMock },
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

  it('rejects adding a non-sellable product to a section', async () => {
    const mod: TestingModule = await buildMenusModule(
      { 1: { id: 1, store_id: STORE_ID, name: 'Lunch' } },
      { 10: { id: 10, store_id: STORE_ID, menu_id: 1, name: 'Entradas' } },
      { 99: { id: 99, store_id: STORE_ID, is_sellable: false } },
    );
    const sections = mod.get(MenuSectionsService);
    await expect(
      sections.addItem(1, 10, { product_id: 99 }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });
});

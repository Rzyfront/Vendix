import { Test, TestingModule } from '@nestjs/testing';
import { RecipesService } from './recipes.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * Unit tests for the anti-cycle logic in RecipesService.addItem.
 *
 * The full service depends on a Store-scoped Prisma client and RequestContext;
 * both are mocked here. We focus on the part of the service that is easy to
 * exercise in isolation: cycle detection and the BOM explosion graph walk.
 */
describe('RecipesService — cycle detection & explosion', () => {
  let service: RecipesService;
  let recipes: any;
  let items: any;
  let products: any;

  const STORE_ID = 100;

  const makeCtx = (overrides: Partial<{ store_id: number }> = {}) => ({
    store_id: STORE_ID,
    ...overrides,
  });

  const setupMockPrisma = (recipeTree: {
    /** product_id => own_recipe_id (or null if no recipe) */
    ownRecipe: Record<number, number | null>;
    /** recipe_id => list of component_product_ids */
    items: Record<number, number[]>;
  }) => {
    recipes = {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.product_id !== undefined) {
          const ownId = recipeTree.ownRecipe[where.product_id];
          if (ownId == null) return Promise.resolve(null);
          if (where.is_active === true) {
            return Promise.resolve({ id: ownId });
          }
          return Promise.resolve({ id: ownId });
        }
        if (where?.id !== undefined) {
          const recipeId = where.id;
          const yieldProductId = Object.entries(recipeTree.ownRecipe).find(
            ([, rid]) => rid === recipeId,
          )?.[0];
          if (yieldProductId == null) return Promise.resolve(null);
          return Promise.resolve({
            id: recipeId,
            product_id: Number(yieldProductId),
            yield_quantity: 1,
            waste_percent: 0,
            is_active: true,
            items: (recipeTree.items[recipeId] || []).map(
              (cpid: number, i: number) => ({
                id: i + 1,
                component_product_id: cpid,
                quantity: 1,
                waste_percent: 0,
                is_optional: false,
                component_product: { id: cpid },
              }),
            ),
          });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.product_id !== undefined && where.is_active) {
          const ownId = recipeTree.ownRecipe[where.product_id];
          return Promise.resolve(ownId ? { id: ownId } : null);
        }
        return Promise.resolve([]);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 999,
        ...data,
      })),
      update: jest.fn().mockImplementation(({ data }: any) => ({
        id: 999,
        ...data,
      })),
      count: jest.fn().mockResolvedValue(0),
    };

    items = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.recipe_id === undefined) return Promise.resolve([]);
        const list = (recipeTree.items[where.recipe_id] || []).map(
          (cpid: number) => ({ component_product_id: cpid }),
        );
        return Promise.resolve(list);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 1,
        ...data,
      })),
      update: jest.fn().mockImplementation(({ data }: any) => ({
        id: 1,
        ...data,
      })),
      delete: jest.fn().mockResolvedValue({ id: 1 }),
    };

    products = {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.id !== undefined) {
          return Promise.resolve({
            id: where.id,
            store_id: STORE_ID,
            is_sellable: true,
            is_ingredient: false,
          });
        }
        return Promise.resolve(null);
      }),
    };

    return {
      recipes,
      recipe_items: items,
      products,
    };
  };

  const buildService = (recipeTree: {
    ownRecipe: Record<number, number | null>;
    items: Record<number, number[]>;
  }) => {
    const prisma = setupMockPrisma(recipeTree);
    return Test.createTestingModule({
      providers: [
        RecipesService,
        {
          provide: StorePrismaService,
          useValue: prisma,
        },
        {
          provide: RequestContextService,
          useValue: {
            getContext: jest.fn().mockReturnValue(makeCtx()),
            getOrganizationId: jest.fn().mockReturnValue(STORE_ID),
          },
        },
      ],
    })
      .compile()
      .then((mod: TestingModule) => mod.get(RecipesService));
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addItem — cycle detection', () => {
    it('rejects self-reference (recipe product as its own component)', async () => {
      const service = await buildService({
        ownRecipe: { 1: 10 },
        items: { 10: [] },
      });

      await expect(
        service.addItem(10, { component_product_id: 1, quantity: 1 }),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('rejects adding a component that would close a 2-cycle', async () => {
      // Recipe A (yield = product 1) and Recipe B (yield = product 2) exist.
      // Recipe A already has B as a component. Adding A as a component of B
      // would close the cycle 1 -> 2 -> 1.
      const service = await buildService({
        ownRecipe: { 1: 10, 2: 20 },
        items: { 10: [2], 20: [] },
      });

      // Try to add product 1 (recipe A) as a component of recipe B (id 20).
      await expect(
        service.addItem(20, { component_product_id: 1, quantity: 1 }),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('allows a non-cycling sub-recipe link', async () => {
      // Recipe A (product 1) -> Recipe B (product 2). Add Recipe A as
      // component of Recipe C (product 3): 3 -> 1 -> 2 (no cycle).
      const service = await buildService({
        ownRecipe: { 1: 10, 2: 20, 3: 30 },
        items: { 10: [2], 20: [], 30: [] },
      });

      // Reset create spy so we can assert it was called.
      items.create.mockClear();
      const result = await service.addItem(30, {
        component_product_id: 1,
        quantity: 2,
      });
      expect(items.create).toHaveBeenCalled();
      expect(result.component_product_id).toBe(1);
    });

    it('allows a raw ingredient (no own recipe) as a component', async () => {
      const service = await buildService({
        ownRecipe: { 1: 10 },
        items: { 10: [] },
      });

      items.create.mockClear();
      const result = await service.addItem(10, {
        component_product_id: 42, // product 42 has no own recipe
        quantity: 0.5,
      });
      expect(items.create).toHaveBeenCalled();
      expect(result.component_product_id).toBe(42);
    });
  });

  describe('explodeBom — basic shape', () => {
    it('returns a leaf line for a simple recipe (no sub-recipes)', async () => {
      const service = await buildService({
        ownRecipe: { 1: 10 },
        items: { 10: [42] },
      });

      const lines = await service.explodeBom(10, { 10: 1 });
      expect(lines).toHaveLength(1);
      expect(lines[0].component_product_id).toBe(42);
      expect(lines[0].quantity).toBe(1); // 1 unit per 1 yield, 0% waste
    });
  });
});

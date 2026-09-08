import { Test, TestingModule } from '@nestjs/testing';
import { RecipesService } from './recipes.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  RequestContextService,
  type RequestContext,
} from '@common/context/request-context.service';
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
  let variants: any;

  const STORE_ID = 100;

  const makeCtx = (
    overrides: Partial<{ store_id: number }> = {},
  ): RequestContext => ({
    store_id: STORE_ID,
    is_super_admin: false,
    is_owner: true,
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

    // Un insumo NO puede tener variantes: `recipe_items` sólo guarda
    // `component_product_id`, así que el consumo iría a la fila base de stock
    // —vacía en un producto variantizado— y descontaría de un saldo inexistente.
    // Por defecto el componente es simple; los tests que prueban el bloqueo
    // sobrescriben este contador.
    //
    // Recetas-por-variante: el mismo mock sirve al yield (`create` cuenta las
    // variantes del producto y valida que la variante pertenezca al producto).
    variants = {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    };

    return {
      recipes,
      recipe_items: items,
      products,
      product_variants: variants,
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

    /**
     * Decisión de producto (ago 2026): un insumo es un producto SIMPLE.
     *
     * `recipe_items` sólo tiene `component_product_id` — no hay columna de
     * variante. Con un insumo variantizado el consumo de producción apunta a la
     * fila BASE de `stock_levels` (`product_variant_id NULL`), que en un
     * producto con variantes está vacía: descuenta de un saldo inexistente y el
     * inventario real no se mueve, sin que nada falle. Se bloquea en vez de
     * agregar la columna, porque eso último es funcionalidad nueva.
     */
    it('bloquea un insumo con variantes en vez de consumir contra la fila base vacía', async () => {
      const service = await buildService({
        ownRecipe: { 1: 10 },
        items: { 10: [] },
      });

      variants.count.mockResolvedValue(3);
      items.create.mockClear();

      await expect(
        service.addItem(10, { component_product_id: 42, quantity: 1 }),
      ).rejects.toThrow(VendixHttpException);

      // Lo que importa: no llegó a escribirse el renglón.
      expect(items.create).not.toHaveBeenCalled();
    });
  });

  describe('create — variant guards (recetas-por-variante, paso 3)', () => {
    const baseDto = {
      product_id: 1,
      yield_quantity: 1,
      yield_unit: 'unidad',
    };

    // `create` exige store en el contexto (requireStoreId lee el ESTATICO
    // RequestContextService via ALS). Los tests de addItem/explodeBom nunca lo
    // tocan; aqui hay que forjarlo con `run`.
    const inStore = <T>(fn: () => Promise<T>): Promise<T> =>
      Promise.resolve(
        RequestContextService.run(
          { ...makeCtx(), is_super_admin: false, is_owner: true },
          fn,
        ) as Promise<T>,
      );

    const errorCodeOf = async (fn: () => Promise<unknown>) => {
      try {
        await inStore(fn);
      } catch (e) {
        expect(e).toBeInstanceOf(VendixHttpException);
        return (e as VendixHttpException).errorCode;
      }
      throw new Error('se esperaba un VendixHttpException y no se lanzó');
    };

    it('rechaza con RECIPE_VARIANT_REQUIRED la receta base sobre un producto con variantes', async () => {
      const service = await buildService({
        ownRecipe: {},
        items: {},
      });

      variants.count.mockResolvedValue(2);
      recipes.create.mockClear();

      const code = await errorCodeOf(() => service.create({ ...baseDto }));
      expect(code).toBe('RECIPE_VARIANT_REQUIRED');
      expect(recipes.create).not.toHaveBeenCalled();
    });

    it('rechaza con RECIPE_VARIANT_MISMATCH la variante sobre un producto sin variantes', async () => {
      const service = await buildService({
        ownRecipe: {},
        items: {},
      });

      variants.count.mockResolvedValue(0);
      recipes.create.mockClear();

      const code = await errorCodeOf(() =>
        service.create({ ...baseDto, product_variant_id: 470 }),
      );
      expect(code).toBe('RECIPE_VARIANT_MISMATCH');
      expect(recipes.create).not.toHaveBeenCalled();
    });

    it('rechaza con RECIPE_VARIANT_MISMATCH la variante que pertenece a otro producto', async () => {
      const service = await buildService({
        ownRecipe: {},
        items: {},
      });

      variants.count.mockResolvedValue(2);
      // La variante existe pero NO es de este producto.
      variants.findFirst.mockResolvedValue(null);
      recipes.create.mockClear();

      const code = await errorCodeOf(() =>
        service.create({ ...baseDto, product_variant_id: 999 }),
      );
      expect(code).toBe('RECIPE_VARIANT_MISMATCH');
      expect(recipes.create).not.toHaveBeenCalled();
    });

    it('crea la receta con product_variant_id cuando la variante pertenece al producto', async () => {
      const service = await buildService({
        ownRecipe: {},
        items: {},
      });

      variants.count.mockResolvedValue(2);
      variants.findFirst.mockResolvedValue({ id: 470 });
      recipes.create.mockClear();

      const result = await inStore(() =>
        service.create({
          ...baseDto,
          product_variant_id: 470,
        }),
      );
      expect(recipes.create).toHaveBeenCalled();
      expect(result.product_variant_id).toBe(470);
    });

    it('crea la receta base (null) sobre un producto simple: sin regresión', async () => {
      const service = await buildService({
        ownRecipe: {},
        items: {},
      });

      variants.count.mockResolvedValue(0);
      recipes.create.mockClear();

      const result = await inStore(() => service.create({ ...baseDto }));
      expect(recipes.create).toHaveBeenCalled();
      expect(result.product_variant_id).toBeNull();
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

/**
 * Recetas-por-variante — resolución DETERMINISTA.
 *
 * La migración `20260908000000_recipes_por_variante` quitó el `@unique` de
 * `recipes.product_id`: un producto ahora puede tener la receta BASE
 * (`product_variant_id IS NULL`) más una por variante. Todo `findFirst` que
 * buscaba "la receta del producto" sin `orderBy` quedó no determinista — el
 * orden lo decide Postgres.
 *
 * Estos tests fijan el criterio acordado: **base primero**, y si el plato sólo
 * tiene recetas por variante, la de menor `product_variant_id`. El mock de
 * Prisma preserva el orden de inserción del arreglo de filas, y los casos
 * colocan a propósito la fila "equivocada" primero: si se revierte el arreglo
 * (se quita el `orderBy` / el `product_variant_id: null`), el `findFirst`
 * devuelve esa primera fila y el test falla.
 */
describe('RecipesService — resolución determinista de receta (recetas-por-variante)', () => {
  const STORE_ID = 100;

  type FakeRecipeRow = {
    id: number;
    product_id: number;
    product_variant_id: number | null;
    is_active: boolean;
    yield_quantity?: number;
    waste_percent?: number;
    items?: Array<{
      component_product_id: number;
      quantity: number;
      waste_percent: number;
    }>;
  };

  /** Réplica mínima del `where` que usa el servicio sobre `recipes`. */
  const matchesWhere = (row: FakeRecipeRow, where: any): boolean => {
    if (!where) return true;
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.product_id !== undefined && row.product_id !== where.product_id) {
      return false;
    }
    if (where.is_active !== undefined && row.is_active !== where.is_active) {
      return false;
    }
    if (where.product_variant_id !== undefined) {
      const cond = where.product_variant_id;
      if (cond === null) return row.product_variant_id === null;
      if (typeof cond === 'object' && cond !== null && 'not' in cond) {
        if (cond.not === null) return row.product_variant_id !== null;
      }
      return row.product_variant_id === cond;
    }
    return true;
  };

  /** Réplica mínima del `orderBy` de Prisma, incluido `nulls: 'first' | 'last'`. */
  const applyOrderBy = (
    rows: FakeRecipeRow[],
    orderBy: any,
  ): FakeRecipeRow[] => {
    if (!orderBy) return rows;
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a: any, b: any) => {
      for (const clause of clauses) {
        for (const [field, dirRaw] of Object.entries<any>(clause)) {
          const spec =
            typeof dirRaw === 'string'
              ? { sort: dirRaw, nulls: undefined }
              : dirRaw;
          const nullsFirst = spec.nulls === 'first';
          const norm = (v: any) =>
            v === null || v === undefined
              ? nullsFirst
                ? -Infinity
                : Infinity
              : v;
          const av = norm(a[field]);
          const bv = norm(b[field]);
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          if (cmp !== 0) return spec.sort === 'desc' ? -cmp : cmp;
        }
      }
      return 0;
    });
  };

  const hydrate = (row: FakeRecipeRow) => ({
    ...row,
    yield_quantity: row.yield_quantity ?? 1,
    waste_percent: row.waste_percent ?? 0,
    items: (row.items ?? []).map((it, i) => ({
      id: i + 1,
      ...it,
      is_optional: false,
      component_product: { id: it.component_product_id },
    })),
  });

  const buildService = async (rows: FakeRecipeRow[]) => {
    const recipes = {
      findFirst: jest.fn(({ where, orderBy }: any = {}) => {
        const matched = rows.filter((r) => matchesWhere(r, where));
        const ordered = applyOrderBy(matched, orderBy);
        return Promise.resolve(ordered.length > 0 ? hydrate(ordered[0]) : null);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const recipe_items = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(({ where }: any = {}) => {
        const row = rows.find((r) => r.id === where?.recipe_id);
        return Promise.resolve(
          (row?.items ?? []).map((it) => ({
            component_product_id: it.component_product_id,
          })),
        );
      }),
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 1,
        ...data,
      })),
    };
    const prisma = {
      recipes,
      recipe_items,
      products: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve({ id: where.id, store_id: STORE_ID }),
        ),
      },
      product_variants: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RecipesService,
        { provide: StorePrismaService, useValue: prisma },
        {
          provide: RequestContextService,
          useValue: {
            getContext: jest.fn().mockReturnValue({
              store_id: STORE_ID,
              is_super_admin: false,
              is_owner: true,
            }),
            getOrganizationId: jest.fn().mockReturnValue(STORE_ID),
          },
        },
      ],
    }).compile();

    return {
      service: mod.get(RecipesService),
      recipes,
      recipe_items,
    };
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByProduct sin variante (D3)', () => {
    it('devuelve la receta BASE aunque Postgres liste primero la de una variante', async () => {
      const { service } = await buildService([
        // El orden simula el orden ARBITRARIO en que puede llegar el heap:
        // la base NO es la primera fila.
        { id: 20, product_id: 1, product_variant_id: 470, is_active: true },
        { id: 30, product_id: 1, product_variant_id: 471, is_active: true },
        { id: 10, product_id: 1, product_variant_id: null, is_active: true },
      ]);

      const recipe = await service.findByProduct(1);

      expect(recipe.id).toBe(10);
      expect(recipe.product_variant_id).toBeNull();
    });

    it('sin receta base cae en la variante de MENOR id, no en la primera fila', async () => {
      const { service } = await buildService([
        { id: 30, product_id: 1, product_variant_id: 471, is_active: true },
        { id: 20, product_id: 1, product_variant_id: 470, is_active: true },
      ]);

      const recipe = await service.findByProduct(1);

      expect(recipe.id).toBe(20);
      expect(recipe.product_variant_id).toBe(470);
    });

    it('ignora la receta base INACTIVA y devuelve la variante activa', async () => {
      const { service } = await buildService([
        { id: 10, product_id: 1, product_variant_id: null, is_active: false },
        { id: 20, product_id: 1, product_variant_id: 470, is_active: true },
      ]);

      const recipe = await service.findByProduct(1);

      expect(recipe.id).toBe(20);
    });

    it('lanza RECIPE_NOT_FOUND cuando ninguna receta del producto esta activa', async () => {
      const { service } = await buildService([
        { id: 10, product_id: 1, product_variant_id: null, is_active: false },
      ]);

      await expect(service.findByProduct(1)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });

    it('con variante sigue resolviendo par exacto y luego base (sin regresion)', async () => {
      const { service } = await buildService([
        { id: 10, product_id: 1, product_variant_id: null, is_active: true },
        { id: 20, product_id: 1, product_variant_id: 470, is_active: true },
      ]);

      await expect(service.findByProduct(1, 470)).resolves.toMatchObject({
        id: 20,
      });
      // La variante 471 no tiene receta propia: cae a la BASE.
      await expect(service.findByProduct(1, 471)).resolves.toMatchObject({
        id: 10,
      });
    });
  });

  describe('sub-receta = receta BASE del insumo (D4)', () => {
    it('explodeBom explota la BASE del componente, no la receta de una variante', async () => {
      // Receta raiz 10 (producto 1) consume el producto 2.
      // El producto 2 tiene DOS recetas activas y la de la variante esta
      // listada primero: sin `product_variant_id: null` el `findFirst`
      // engancharia la 21 y la explosion emitiria el insumo 99.
      const { service } = await buildService([
        {
          id: 10,
          product_id: 1,
          product_variant_id: null,
          is_active: true,
          items: [{ component_product_id: 2, quantity: 1, waste_percent: 0 }],
        },
        {
          id: 21,
          product_id: 2,
          product_variant_id: 471,
          is_active: true,
          items: [{ component_product_id: 99, quantity: 1, waste_percent: 0 }],
        },
        {
          id: 20,
          product_id: 2,
          product_variant_id: null,
          is_active: true,
          items: [{ component_product_id: 42, quantity: 1, waste_percent: 0 }],
        },
      ]);

      const lines = await service.explodeBom(10, { 10: 1 });

      expect(lines).toHaveLength(1);
      expect(lines[0].component_product_id).toBe(42);
      expect(lines.map((l) => l.component_product_id)).not.toContain(99);
    });

    it('el anticiclos camina la BASE del insumo y detecta el ciclo que ella cierra', async () => {
      // Producto 2: receta de variante 21 (vacia, listada PRIMERO) + receta
      // BASE 20 que consume el producto 1. Agregar el producto 2 como insumo
      // de la receta 10 (cuyo yield es el producto 1) cierra 1 -> 2 -> 1.
      // Si el recorrido toma la receta 21 (sin el filtro de base) no ve el
      // ciclo y deja pasar el renglon.
      const { service, recipe_items } = await buildService([
        {
          id: 10,
          product_id: 1,
          product_variant_id: null,
          is_active: true,
          items: [],
        },
        {
          id: 21,
          product_id: 2,
          product_variant_id: 471,
          is_active: true,
          items: [],
        },
        {
          id: 20,
          product_id: 2,
          product_variant_id: null,
          is_active: true,
          items: [{ component_product_id: 1, quantity: 1, waste_percent: 0 }],
        },
      ]);

      await expect(
        service.addItem(10, { component_product_id: 2, quantity: 1 }),
      ).rejects.toBeInstanceOf(VendixHttpException);
      expect(recipe_items.create).not.toHaveBeenCalled();
    });
  });
});

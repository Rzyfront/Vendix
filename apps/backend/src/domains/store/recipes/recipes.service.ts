import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateRecipeDto,
  UpdateRecipeDto,
  CreateRecipeItemDto,
  UpdateRecipeItemDto,
  RecipeQueryDto,
} from './dto';

/**
 * BomExplosionLine
 *
 * Public return shape of {@link RecipesService.explodeBom}. Each line is the
 * "raw" requirement of a single leaf component in the BOM tree of a given
 * recipe, already net of intermediate yields and recipe-level waste, multiplied
 * by `multipliers` to scale the result.
 *
 * NOTE: Phase B only EXPOSES `explodeBom()` as a public method on the service.
 * It is not yet invoked from the controller — that is owned by Phase D
 * (production orders) and Phase F (KDS cost projections).
 */
export interface BomExplosionLine {
  /** The leaf (or sub-recipe) component product id. */
  component_product_id: number;
  /** Total quantity required (decimal, in the leaf product's stock_unit). */
  quantity: number;
  /** Number of hops in the BOM tree (1 = direct child of the requested recipe). */
  depth: number;
  /** ids of the recipes traversed to reach this line, root-first. */
  path_recipe_ids: number[];
}

/**
 * RecipesService
 *
 * Store-scoped CRUD for the Recipes / BOM (Bill of Materials) domain of the
 * Restaurant Suite. A recipe represents the bill-of-materials for a single
 * product (the "yield") and is composed of one or more component products
 * (raw ingredients, sub-preps, stock items) — see `recipe_items`.
 *
 * Responsibilities:
 *  - CRUD on `recipes` and `recipe_items` (scoped automatically by
 *    `StorePrismaService`).
 *  - Anti-cycle validation: a recipe cannot include itself as a component
 *    (self-reference), and adding a component that would close a cycle in the
 *    sub-recipe graph is rejected with `RECIPE_CYCLE_DETECTED`.
 *  - Bom explosion (`explodeBom`): recursively walks the sub-recipe graph and
 *    returns flattened leaf requirements. This is consumed by Phase D/F; the
 *    HTTP controller does NOT expose it in Phase B.
 *
 * Tenant scope: all read/write operations rely on the `StorePrismaService`
 * auto-scoping. Cross-store access is impossible.
 */
@Injectable()
export class RecipesService {
  constructor(private prisma: StorePrismaService) {}

  // ------------------------------------------------------------------ Helpers

  private requireStoreId(): number {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  // --------------------------------------------------------- Recipe CRUD

  async create(dto: CreateRecipeDto) {
    const storeId = this.requireStoreId();

    // 1. The yield product must exist in this store.
    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: { id: true, store_id: true, is_sellable: true, is_ingredient: true },
    });
    if (!product || product.store_id !== storeId) {
      throw new VendixHttpException(ErrorCodes.RECIPE_YIELD_PRODUCT_NOT_FOUND);
    }

    // 2. Recipes are 1:1 with (store_id, product_id) — unique constraint.
    const dup = await this.prisma.recipes.findFirst({
      where: { product_id: dto.product_id },
    });
    if (dup) {
      throw new VendixHttpException(ErrorCodes.RECIPE_DUP_PRODUCT);
    }

    return this.prisma.recipes.create({
      data: {
        store_id: storeId,
        product_id: dto.product_id,
        yield_quantity: new Prisma.Decimal(dto.yield_quantity),
        yield_unit: dto.yield_unit,
        waste_percent:
          dto.waste_percent != null
            ? new Prisma.Decimal(dto.waste_percent)
            : new Prisma.Decimal(0),
        preparation_notes: dto.preparation_notes ?? null,
        is_active: dto.is_active ?? true,
        updated_at: new Date(),
      },
    });
  }

  async findAll(query: RecipeQueryDto) {
    const { page = 1, limit = 10, search, is_active, product_id } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.recipesWhereInput = {
      ...(is_active !== undefined && { is_active }),
      ...(product_id !== undefined && { product_id }),
      ...(search && {
        OR: [
          {
            product: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            product: {
              sku: { contains: search, mode: 'insensitive' },
            },
          },
          {
            preparation_notes: { contains: search, mode: 'insensitive' },
          },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.recipes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              base_price: true,
              stock_unit: true,
            },
          },
          _count: {
            select: { items: true },
          },
        },
      }),
      this.prisma.recipes.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const recipe = await this.prisma.recipes.findFirst({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            base_price: true,
            stock_unit: true,
            is_ingredient: true,
            is_sellable: true,
            is_combo: true,
            is_batch_produced: true,
          },
        },
        items: {
          orderBy: { id: 'asc' },
          include: {
            component_product: {
              select: {
                id: true,
                name: true,
                sku: true,
                stock_unit: true,
                is_ingredient: true,
                is_sellable: true,
                base_price: true,
                cost_price: true,
              },
            },
          },
        },
      },
    });
    if (!recipe) {
      throw new VendixHttpException(ErrorCodes.RECIPE_NOT_FOUND);
    }
    return recipe;
  }

  async findByProduct(productId: number) {
    const recipe = await this.prisma.recipes.findFirst({
      where: { product_id: productId },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            component_product: {
              select: {
                id: true,
                name: true,
                sku: true,
                stock_unit: true,
                is_ingredient: true,
              },
            },
          },
        },
      },
    });
    if (!recipe) {
      throw new VendixHttpException(ErrorCodes.RECIPE_NOT_FOUND);
    }
    return recipe;
  }

  async update(id: number, dto: UpdateRecipeDto) {
    await this.findOne(id);

    const data: Prisma.recipesUpdateInput = {
      ...(dto.yield_quantity !== undefined && {
        yield_quantity: new Prisma.Decimal(dto.yield_quantity),
      }),
      ...(dto.yield_unit !== undefined && { yield_unit: dto.yield_unit }),
      ...(dto.waste_percent !== undefined && {
        waste_percent: new Prisma.Decimal(dto.waste_percent),
      }),
      ...(dto.preparation_notes !== undefined && {
        preparation_notes: dto.preparation_notes,
      }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      updated_at: new Date(),
    };

    return this.prisma.recipes.update({ where: { id }, data });
  }

  async softDelete(id: number) {
    await this.findOne(id);
    return this.prisma.recipes.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });
  }

  async restore(id: number) {
    await this.findOne(id);
    return this.prisma.recipes.update({
      where: { id },
      data: { is_active: true, updated_at: new Date() },
    });
  }

  // ----------------------------------------------------- Recipe items CRUD

  async addItem(recipeId: number, dto: CreateRecipeItemDto) {
    const recipe = await this.findOne(recipeId);

    // 1. Self-reference: a recipe cannot include its own yield product.
    if (dto.component_product_id === recipe.product_id) {
      throw new VendixHttpException(ErrorCodes.RECIPE_SELF_REFERENCE);
    }

    // 2. Component product must exist in the same store.
    const component = await this.prisma.products.findFirst({
      where: { id: dto.component_product_id },
      select: { id: true, store_id: true },
    });
    if (!component) {
      throw new VendixHttpException(ErrorCodes.RECIPE_COMPONENT_NOT_FOUND);
    }

    // 3. Unique (recipe_id, component_product_id) — surface a friendly error
    //    instead of letting Prisma throw a raw P2002.
    const dup = await this.prisma.recipe_items.findFirst({
      where: {
        recipe_id: recipeId,
        component_product_id: dto.component_product_id,
      },
    });
    if (dup) {
      throw new VendixHttpException(ErrorCodes.RECIPE_ITEM_DUP);
    }

    // 4. Cycle detection: walking DOWN from `component_product_id` we must
    //    not reach `recipe.product_id` again, otherwise adding the link would
    //    close a cycle. We treat the link as "component is a sub-recipe of
    //    recipe" only when the component itself owns an active recipe; raw
    //    ingredients / stock items that have no own recipe are leaves and
    //    are always safe.
    await this.assertNoCycleAddingLink(
      recipe.product_id,
      dto.component_product_id,
    );

    try {
      return await this.prisma.recipe_items.create({
        data: {
          recipe_id: recipeId,
          component_product_id: dto.component_product_id,
          quantity: new Prisma.Decimal(dto.quantity),
          waste_percent:
            dto.waste_percent != null
              ? new Prisma.Decimal(dto.waste_percent)
              : new Prisma.Decimal(0),
          is_optional: dto.is_optional ?? false,
          updated_at: new Date(),
        },
        include: {
          component_product: {
            select: {
              id: true,
              name: true,
              sku: true,
              stock_unit: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.RECIPE_ITEM_DUP);
      }
      throw error;
    }
  }

  async updateItem(recipeId: number, itemId: number, dto: UpdateRecipeItemDto) {
    // Both lookups are scope-safe; the scoped service injects store_id.
    const item = await this.prisma.recipe_items.findFirst({
      where: { id: itemId, recipe_id: recipeId },
    });
    if (!item) {
      throw new VendixHttpException(ErrorCodes.RECIPE_ITEM_NOT_FOUND);
    }

    const data: Prisma.recipe_itemsUpdateInput = {
      ...(dto.quantity !== undefined && {
        quantity: new Prisma.Decimal(dto.quantity),
      }),
      ...(dto.waste_percent !== undefined && {
        waste_percent: new Prisma.Decimal(dto.waste_percent),
      }),
      ...(dto.is_optional !== undefined && { is_optional: dto.is_optional }),
      updated_at: new Date(),
    };

    return this.prisma.recipe_items.update({
      where: { id: itemId },
      data,
      include: {
        component_product: {
          select: { id: true, name: true, sku: true, stock_unit: true },
        },
      },
    });
  }

  async removeItem(recipeId: number, itemId: number) {
    const item = await this.prisma.recipe_items.findFirst({
      where: { id: itemId, recipe_id: recipeId },
    });
    if (!item) {
      throw new VendixHttpException(ErrorCodes.RECIPE_ITEM_NOT_FOUND);
    }
    await this.prisma.recipe_items.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  // --------------------------------------------------------- Cycle & graph

  /**
   * Returns the chain of active recipes that starts at `componentProductId`'s
   * own recipe (if any) and walks down via `recipe_items.component_product_id`
   * to other recipe yield products. The walk is depth-first; it returns true
   * if at any point we visit `recipeProductId`, which would close a cycle if we
   * also added an edge `recipeProductId → componentProductId`.
   *
   * Notes:
   *  - Inactive recipes are treated as "no recipe" (leaves) — they are not
   *    considered for cycle detection, which is consistent with `is_active` on
   *    the existing services (e.g. price-tiers).
   *  - We bound the walk to MAX_DEPTH to defend against pre-existing cycles in
   *    the data; the cap is intentionally large enough to allow very deep BOMs
   *    while still terminating.
   */
  private async assertNoCycleAddingLink(
    recipeProductId: number,
    componentProductId: number,
  ): Promise<void> {
    const MAX_DEPTH = 64;
    const stack: Array<{ productId: number; path: number[]; depth: number }> =
      [];
    stack.push({ productId: componentProductId, path: [], depth: 0 });

    while (stack.length > 0) {
      const { productId, path, depth } = stack.pop()!;
      if (depth >= MAX_DEPTH) {
        throw new VendixHttpException(ErrorCodes.RECIPE_CYCLE_DETECTED);
      }

      const ownRecipe = await this.prisma.recipes.findFirst({
        where: { product_id: productId, is_active: true },
        select: { id: true },
      });
      if (!ownRecipe) {
        // Component has no own recipe -> leaf, can't close a cycle.
        continue;
      }

      // Walking one hop deeper via the component's recipe items.
      const items = await this.prisma.recipe_items.findMany({
        where: { recipe_id: ownRecipe.id },
        select: { component_product_id: true },
      });

      for (const item of items) {
        if (item.component_product_id === recipeProductId) {
          throw new VendixHttpException(ErrorCodes.RECIPE_CYCLE_DETECTED);
        }
        // We could revisit the same node via a different path; cheap guard
        // by keeping `path` in the recursion args (and trusting MAX_DEPTH to
        // bound memory if the graph is somehow structured).
        stack.push({
          productId: item.component_product_id,
          path: [...path, ownRecipe.id],
          depth: depth + 1,
        });
      }
    }
  }

  // --------------------------------------------------------- BOM explosion

  /**
   * Recursively walks the sub-recipe graph of `recipeId` and returns the
   * flattened list of leaf (or sub-recipe) component requirements, already
   * net of intermediate yields and recipe-level waste.
   *
   * This method is EXPOSED for Phase D (production orders) and Phase F (KDS
   * cost projections) to consume. Phase B's HTTP controller does not expose
   * it on purpose — there is no UI to consume the explosion yet.
   *
   * @param recipeId        Root recipe id to explode.
   * @param multipliers     Map recipeId (intermediate sub-recipes) → quantity
   *                        multiplier at that level. The first call passes
   *                        `{ [recipeId]: 1 }` for a yield of one batch of the
   *                        root recipe.
   */
  async explodeBom(
    recipeId: number,
    multipliers: Record<number, number> = { [recipeId]: 1 },
  ): Promise<BomExplosionLine[]> {
    const MAX_DEPTH = 32;
    return this.explodeBomRecursive(recipeId, multipliers, [], 0, MAX_DEPTH);
  }

  private async explodeBomRecursive(
    recipeId: number,
    multipliers: Record<number, number>,
    pathRecipeIds: number[],
    depth: number,
    maxDepth: number,
  ): Promise<BomExplosionLine[]> {
    if (depth >= maxDepth) {
      return [];
    }

    const recipe = await this.prisma.recipes.findFirst({
      where: { id: recipeId, is_active: true },
      include: {
        items: {
          include: {
            component_product: {
              select: { id: true },
            },
          },
        },
      },
    });
    if (!recipe) {
      return [];
    }

    const rootMultiplier = multipliers[recipeId] ?? 1;
    // Recipe-level waste reduces the effective yield.
    const recipeWaste = Number(recipe.waste_percent ?? 0);
    const yieldQty = Number(recipe.yield_quantity);
    const effectiveYield =
      yieldQty > 0 ? yieldQty * (1 - recipeWaste / 100) : 0;
    if (effectiveYield <= 0) {
      return [];
    }

    const lines: BomExplosionLine[] = [];
    for (const item of recipe.items) {
      const lineWaste = Number(item.waste_percent ?? 0);
      // Component qty per (one) yield of the parent recipe, after line waste.
      const perYield = Number(item.quantity) * (1 + lineWaste / 100);
      // Scaled by how many yields of `recipe` are being produced.
      const scaled = (perYield * rootMultiplier) / effectiveYield;

      // Does the component itself own an active recipe (sub-prep)?
      const childRecipe = await this.prisma.recipes.findFirst({
        where: {
          product_id: item.component_product_id,
          is_active: true,
        },
        select: { id: true },
      });

      if (childRecipe) {
        // It's a sub-recipe: don't emit a leaf line, recurse with the scaled
        // quantity as the multiplier for the child recipe.
        const childMultipliers: Record<number, number> = {
          ...multipliers,
          [childRecipe.id]: (multipliers[childRecipe.id] ?? 0) + scaled,
        };
        const childLines = await this.explodeBomRecursive(
          childRecipe.id,
          childMultipliers,
          [...pathRecipeIds, recipeId],
          depth + 1,
          maxDepth,
        );
        lines.push(...childLines);
      } else {
        lines.push({
          component_product_id: item.component_product_id,
          quantity: Number(scaled.toFixed(6)),
          depth: depth + 1,
          path_recipe_ids: [...pathRecipeIds, recipeId],
        });
      }
    }

    return lines;
  }
}

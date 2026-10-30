import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { signProductImageUrls } from '@common/helpers/sign-product-images.helper';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { RecipesService } from '../../recipes/recipes.service';
import {
  CreateFormulaDto,
  FormulaExplosionQueryDto,
  FormulaQueryDto,
  FormulaStatus,
  UpdateFormulaDto,
} from '../dto';
import { RecipeItemInputDto } from '../../recipes/dto';

export interface FormulaCostLine {
  component_product_id: number;
  name: string;
  quantity: number;
  waste_percent: number;
  effective_quantity: number;
  unit_cost: number;
  line_cost: number;
  cost_source: 'stock_level' | 'product';
}

export interface FormulaCost {
  recipe_id: number;
  yield_quantity: number;
  total_cost: number;
  unit_cost: number;
  lines: FormulaCostLine[];
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Fórmulas = recetas (`recipes`) con `code`, `version` y `status`.
 * Envuelve `RecipesService` (validaciones de variantes, ciclos y componentes)
 * y solo agrega lo propio de manufactura: estado, código y costo teórico.
 */
@Injectable()
export class FormulasService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly recipesService: RecipesService,
    private readonly s3Service: S3Service,
  ) {}

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  async findAll(query: FormulaQueryDto) {
    this.requireStoreId();
    const { page = 1, limit = 10, search, status } = query ?? {};
    const where: Prisma.recipesWhereInput = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { sku: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.recipes.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              stock_unit: true,
              description: true,
              preparation_time_minutes: true,
              // Miniatura para la lista de fórmulas: misma forma que recetas
              // (`recipe-profile-ui` S6), una sola foto para no inflar el payload.
              product_images: {
                select: {
                  id: true,
                  image_url: true,
                  is_main: true,
                  alt_text: true,
                  sort_order: true,
                },
                orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }],
                take: 1,
              },
            },
          },
          product_variant: { select: { id: true, name: true, sku: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.recipes.count({ where }),
    ]);
    // `image_url` is the S3 key: sign the thumbnail before it leaves the API.
    await signProductImageUrls(this.s3Service, data);
    return { data, total, page, limit };
  }

  findOne(id: number) {
    return this.recipesService.findOne(id);
  }

  async create(dto: CreateFormulaDto) {
    this.requireStoreId();
    const { code, version, status, items, ...recipeFields } = dto;
    const finalStatus: FormulaStatus = status ?? 'active';

    const created = await this.recipesService.create({
      ...recipeFields,
      is_active: finalStatus === 'active',
    });
    await this.prisma.recipes.update({
      where: { id: created.id },
      data: {
        code: code ?? null,
        version: version ?? 1,
        status: finalStatus,
        updated_at: new Date(),
      },
    });
    if (items && items.length > 0) {
      await this.recipesService.replaceItems(created.id, items);
    }
    return this.recipesService.findOne(created.id);
  }

  async update(id: number, dto: UpdateFormulaDto) {
    await this.recipesService.findOne(id);
    const { code, version, status, items, ...recipeFields } = dto;

    if (items) {
      await this.recipesService.replaceItems(id, items);
    }
    await this.recipesService.update(id, {
      ...recipeFields,
      ...(status !== undefined && { is_active: status === 'active' }),
    });
    if (code !== undefined || version !== undefined || status !== undefined) {
      await this.prisma.recipes.update({
        where: { id },
        data: {
          ...(code !== undefined && { code }),
          ...(version !== undefined && { version }),
          ...(status !== undefined && { status }),
          updated_at: new Date(),
        },
      });
    }
    return this.recipesService.findOne(id);
  }

  async replaceItems(id: number, items: RecipeItemInputDto[]) {
    await this.recipesService.replaceItems(id, items);
    return this.recipesService.findOne(id);
  }

  /** Borrado lógico: `is_active=false` + `status='archived'`. */
  async archive(id: number) {
    await this.recipesService.findOne(id);
    await this.prisma.recipes.update({
      where: { id },
      data: { is_active: false, status: 'archived', updated_at: new Date() },
    });
  }

  explosion(id: number, query: FormulaExplosionQueryDto) {
    const quantity = query?.quantity ?? 1;
    return this.recipesService
      .findOne(id)
      .then(() => this.recipesService.explodeBom(id, { [id]: quantity }));
  }

  /**
   * Costo teórico de UNA tanda (`yield_quantity`):
   * Σ(cantidad × (1+merma línea) × (1+merma receta) × costo del insumo).
   * Costo del insumo: `cost_per_unit` de `stock_levels` (promedio ponderado
   * por existencias) y, si no hay, `cost_price` del producto.
   */
  async calculateCost(recipeId: number): Promise<FormulaCost> {
    this.requireStoreId();
    const recipe = await this.prisma.recipes.findFirst({
      where: { id: recipeId },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            component_product: {
              select: { id: true, name: true, cost_price: true },
            },
          },
        },
      },
    });
    if (!recipe) {
      throw new VendixHttpException(ErrorCodes.RECIPE_NOT_FOUND);
    }

    const stockCosts = await this.loadStockCosts(
      recipe.items.map((i) => i.component_product_id),
    );
    const recipeWaste = Number(recipe.waste_percent ?? 0);

    const lines: FormulaCostLine[] = recipe.items.map((item) => {
      const quantity = Number(item.quantity);
      const wastePercent = Number(item.waste_percent ?? 0);
      const wasteMode =
        (item as { waste_mode?: string | null }).waste_mode ?? 'percent';
      const wasteAbs = Number(
        (item as { waste_absolute?: unknown }).waste_absolute ?? 0,
      );
      const withLineWaste =
        wasteMode === 'absolute'
          ? quantity + (Number.isFinite(wasteAbs) ? wasteAbs : 0)
          : quantity * (1 + wastePercent / 100);
      const effective = withLineWaste * (1 + recipeWaste / 100);

      const fromStock = stockCosts.get(item.component_product_id);
      const unit_cost =
        fromStock !== undefined
          ? fromStock
          : Number(item.component_product?.cost_price ?? 0);
      return {
        component_product_id: item.component_product_id,
        name: item.component_product?.name ?? '',
        quantity,
        waste_percent: wastePercent,
        effective_quantity: round4(effective),
        unit_cost: round4(unit_cost),
        line_cost: round4(effective * unit_cost),
        cost_source: fromStock !== undefined ? 'stock_level' : 'product',
      };
    });

    const total_cost = round4(lines.reduce((acc, l) => acc + l.line_cost, 0));
    const yield_quantity = Number(recipe.yield_quantity);
    return {
      recipe_id: recipe.id,
      yield_quantity,
      total_cost,
      unit_cost: yield_quantity > 0 ? round4(total_cost / yield_quantity) : 0,
      lines,
    };
  }

  /** product_id → costo ponderado por existencias (solo costos > 0). */
  private async loadStockCosts(
    productIds: number[],
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (productIds.length === 0) return result;
    const levels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: { in: productIds },
        cost_per_unit: { gt: 0 },
      },
      select: {
        product_id: true,
        quantity_on_hand: true,
        cost_per_unit: true,
      },
    });
    const acc = new Map<number, { qty: number; value: number; plain: number; n: number }>();
    for (const level of levels) {
      const cost = Number(level.cost_per_unit);
      const qty = Math.max(0, Number(level.quantity_on_hand ?? 0));
      const cur = acc.get(level.product_id) ?? { qty: 0, value: 0, plain: 0, n: 0 };
      cur.qty += qty;
      cur.value += qty * cost;
      cur.plain += cost;
      cur.n += 1;
      acc.set(level.product_id, cur);
    }
    for (const [product_id, cur] of acc) {
      result.set(product_id, cur.qty > 0 ? cur.value / cur.qty : cur.plain / cur.n);
    }
    return result;
  }
}

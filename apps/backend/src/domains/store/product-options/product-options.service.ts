import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { mergeStoreSettingsWithDefaults } from '../settings/defaults/default-store-settings';
import { ProductOptionGroupInputDto } from './dto/product-options.dto';

const GROUP_INCLUDE = {
  options: {
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    include: { component_product: { select: { id: true, name: true, cost_price: true } } },
  },
  assignments: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.product_option_groupsInclude;

type GroupWithOptions = Prisma.product_option_groupsGetPayload<{ include: typeof GROUP_INCLUDE }>;

/** Costo estimado de una opción: costo del componente × cantidad. Nunca digitado. */
export function estimatedOptionCost(
  cost_price: Prisma.Decimal | number | string | null | undefined,
  quantity: Prisma.Decimal | number | string,
): string | null {
  if (cost_price === null || cost_price === undefined) return null;
  return new Prisma.Decimal(cost_price).mul(new Prisma.Decimal(quantity)).toFixed(2);
}

/**
 * Grupos de adiciones reutilizables por tienda, enganchables a producto o
 * categoría. Cada opción apunta SIEMPRE a un componente (sin texto libre).
 */
@Injectable()
export class ProductOptionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  async isEnabled(store_id: number): Promise<boolean> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    return !!mergeStoreSettingsWithDefaults(row?.settings).product_options?.enabled;
  }

  private present(group: GroupWithOptions, withCost = true) {
    return {
      ...group,
      options: group.options.map(({ component_product, ...option }) => ({
        ...option,
        component_product: { id: component_product.id, name: component_product.name },
        ...(withCost
          ? { estimated_cost: estimatedOptionCost(component_product.cost_price, option.quantity) }
          : {}),
      })),
    };
  }

  async list() {
    const groups = await this.prisma.product_option_groups.findMany({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      include: GROUP_INCLUDE,
    });
    return groups.map((g) => this.present(g));
  }

  async findOne(id: number) {
    const group = await this.prisma.product_option_groups.findFirst({
      where: { id },
      include: GROUP_INCLUDE,
    });
    if (!group) throw new VendixHttpException(ErrorCodes.OPT_GROUP_NOT_FOUND);
    return this.present(group);
  }

  /** Reglas de negocio que el DTO no puede expresar. */
  private async validate(dto: ProductOptionGroupInputDto) {
    const min = dto.is_required ? Math.max(1, dto.min_select) : dto.min_select;
    if (min > dto.max_select) throw new VendixHttpException(ErrorCodes.OPT_GROUP_RULES);

    for (const option of dto.options) {
      if (!option.component_product_id) {
        throw new VendixHttpException(ErrorCodes.OPT_COMPONENT_REQUIRED);
      }
    }
    for (const a of dto.assignments ?? []) {
      if (!!a.product_id === !!a.category_id) {
        throw new VendixHttpException(ErrorCodes.OPT_ASSIGNMENT_TARGET);
      }
    }

    // Los componentes deben ser productos de la tienda (el cliente scoped filtra).
    const componentIds = [...new Set(dto.options.map((o) => o.component_product_id!))];
    const found = await this.prisma.products.findMany({
      where: { id: { in: componentIds } },
      select: { id: true },
    });
    if (found.length !== componentIds.length) {
      throw new VendixHttpException(ErrorCodes.OPT_COMPONENT_REQUIRED);
    }

    const recipeIds = [
      ...new Set(dto.options.filter((o) => o.component_type === 'recipe').map((o) => o.component_product_id!)),
    ];
    if (recipeIds.length) {
      const withRecipe = await this.prisma.recipes.findMany({
        where: { product_id: { in: recipeIds }, is_active: true },
        select: { product_id: true },
      });
      const ok = new Set(withRecipe.map((r) => r.product_id));
      if (recipeIds.some((id) => !ok.has(id))) {
        throw new VendixHttpException(
          ErrorCodes.OPT_COMPONENT_REQUIRED,
          'La preparación elegida no tiene una receta activa.',
        );
      }
    }
    return min;
  }

  private groupData(dto: ProductOptionGroupInputDto, min_select: number) {
    return {
      name: dto.name.trim(),
      description: dto.description ?? null,
      min_select,
      max_select: dto.max_select,
      is_required: dto.is_required,
      scope: dto.scope,
      sort_order: dto.sort_order ?? 0,
      is_active: dto.is_active ?? true,
    };
  }

  private optionData(option: ProductOptionGroupInputDto['options'][number], index: number) {
    return {
      name: option.name.trim(),
      price_delta: new Prisma.Decimal(option.price_delta),
      component_type: option.component_type,
      component_product_id: option.component_product_id!,
      component_variant_id: option.component_variant_id ?? null,
      quantity: new Prisma.Decimal(option.quantity),
      uom: option.uom ?? null,
      sort_order: option.sort_order ?? index,
      is_active: option.is_active ?? true,
    };
  }

  async create(dto: ProductOptionGroupInputDto) {
    const min = await this.validate(dto);
    const store_id = this.storeId();
    const group = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.product_option_groups.create({
        data: { store_id, ...this.groupData(dto, min) },
      });
      await tx.product_options.createMany({
        data: dto.options.map((o, i) => ({ store_id, group_id: created.id, ...this.optionData(o, i) })),
      });
      if (dto.assignments?.length) {
        await tx.product_option_group_assignments.createMany({
          data: dto.assignments.map((a, i) => ({
            store_id,
            group_id: created.id,
            product_id: a.product_id ?? null,
            category_id: a.category_id ?? null,
            sort_order: a.sort_order ?? i,
          })),
        });
      }
      return created;
    });
    return this.findOne(group.id);
  }

  /**
   * Reemplaza el grupo completo: opciones con id se actualizan, sin id se
   * crean, las ausentes se desactivan (las ventas viejas guardan su snapshot);
   * los enganches se reemplazan.
   */
  async replace(id: number, dto: ProductOptionGroupInputDto) {
    const store_id = this.storeId();
    const existing = await this.prisma.product_option_groups.findFirst({
      where: { id },
      include: { options: { select: { id: true } } },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.OPT_GROUP_NOT_FOUND);
    const min = await this.validate(dto);

    const ownOptionIds = new Set(existing.options.map((o) => o.id));
    for (const option of dto.options) {
      if (option.id && !ownOptionIds.has(option.id)) {
        throw new VendixHttpException(ErrorCodes.OPT_NOT_FOUND);
      }
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.product_option_groups.update({ where: { id }, data: this.groupData(dto, min) });

      const kept: number[] = [];
      for (const [i, option] of dto.options.entries()) {
        if (option.id) {
          await tx.product_options.update({ where: { id: option.id }, data: this.optionData(option, i) });
          kept.push(option.id);
        } else {
          const created = await tx.product_options.create({
            data: { store_id, group_id: id, ...this.optionData(option, i) },
          });
          kept.push(created.id);
        }
      }
      await tx.product_options.updateMany({
        where: { group_id: id, store_id, id: { notIn: kept } },
        data: { is_active: false },
      });

      await tx.product_option_group_assignments.deleteMany({ where: { group_id: id, store_id } });
      if (dto.assignments?.length) {
        await tx.product_option_group_assignments.createMany({
          data: dto.assignments.map((a, i) => ({
            store_id,
            group_id: id,
            product_id: a.product_id ?? null,
            category_id: a.category_id ?? null,
            sort_order: a.sort_order ?? i,
          })),
        });
      }
    });
    return this.findOne(id);
  }

  async deactivate(id: number) {
    const existing = await this.prisma.product_option_groups.findFirst({ where: { id } });
    if (!existing) throw new VendixHttpException(ErrorCodes.OPT_GROUP_NOT_FOUND);
    await this.prisma.product_option_groups.update({ where: { id }, data: { is_active: false } });
    return { id, is_active: false };
  }

  /**
   * Grupos activos aplicables a un producto: los propios + los de sus
   * categorías, sin repetir el mismo grupo. Con el ajuste apagado → [].
   * `client` permite leer dentro de una transacción (sin scoping automático).
   */
  async applicableForProduct(
    store_id: number,
    product_id: number,
    options: { withCost?: boolean; client?: Prisma.TransactionClient } = {},
  ) {
    if (!(await this.isEnabled(store_id))) return [];
    const client = options.client ?? (this.prisma.withoutScope() as unknown as Prisma.TransactionClient);

    const categories = await client.product_categories.findMany({
      where: { product_id },
      select: { category_id: true },
    });
    const categoryIds = categories.map((c) => c.category_id);

    const assignments = await client.product_option_group_assignments.findMany({
      where: {
        store_id,
        OR: [{ product_id }, ...(categoryIds.length ? [{ category_id: { in: categoryIds } }] : [])],
        group: { is_active: true },
      },
      orderBy: [{ product_id: { sort: 'asc', nulls: 'last' } }, { sort_order: 'asc' }],
      select: { group_id: true },
    });
    const groupIds = [...new Set(assignments.map((a) => a.group_id))];
    if (!groupIds.length) return [];

    const groups = await client.product_option_groups.findMany({
      where: { id: { in: groupIds }, store_id },
      include: GROUP_INCLUDE,
    });
    const byId = new Map(groups.map((g) => [g.id, g]));
    return groupIds
      .map((id) => byId.get(id))
      .filter((g): g is GroupWithOptions => !!g && g.options.length > 0)
      .map((g) => this.present(g, options.withCost ?? true));
  }
}

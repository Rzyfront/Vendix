import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { ProductionOrdersService } from '../../production/production-orders.service';
import { FormulasService } from '../formulas/formulas.service';
import { ManufacturingSettingsService } from '../settings/manufacturing-settings.service';
import { OrderSequenceService } from './order-sequence.service';
import {
  CompleteManufacturingOrderDto,
  CreateManufacturingOrderDto,
  ManufacturingOrderQueryDto,
  UpdateManufacturingOrderDto,
} from '../dto';

export interface ShortageLine {
  product_id: number;
  name: string;
  required: number;
  available: number;
  missing: number;
}

const ORDER_INCLUDE = {
  product: { select: { id: true, name: true } },
  recipe: { select: { id: true, code: true, version: true } },
  lines: {
    orderBy: { sort_order: 'asc' },
    include: {
      component_product: {
        select: { id: true, name: true, sku: true, stock_unit: true },
      },
    },
  },
} satisfies Prisma.production_ordersInclude;

const EPS = 1e-9;

/**
 * Órdenes de producción de manufactura. Orquesta el ciclo de vida
 * (draft → released → in_progress → partially_completed → completed) y delega
 * el consumo/producción de inventario en `ProductionOrdersService.complete()`,
 * agregando encima las líneas planificado vs consumido, el costo real y el lote.
 */
@Injectable()
export class ManufacturingOrdersService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productionOrders: ProductionOrdersService,
    private readonly formulas: FormulasService,
    private readonly settingsService: ManufacturingSettingsService,
    private readonly sequences: OrderSequenceService,
    private readonly stockLevelManager: StockLevelManager,
  ) {}

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  private async assertLocation(location_id?: number | null): Promise<void> {
    if (location_id == null) return;
    const location = await this.prisma.inventory_locations.findFirst({
      where: { id: location_id },
      select: { id: true },
    });
    if (!location) {
      throw new VendixHttpException(ErrorCodes.MFG_INVALID_LOCATION);
    }
  }

  /** Solo órdenes de manufactura (tienen consecutivo); las del restaurante no. */
  private async loadOrder(id: number) {
    const order = await this.prisma.production_orders.findFirst({
      where: { id, order_number: { not: null } },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new VendixHttpException(ErrorCodes.MFG_ORDER_NOT_FOUND);
    }
    return order;
  }

  private async loadRecipeForRequirements(recipe_id: number) {
    const recipe = await this.prisma.recipes.findFirst({
      where: { id: recipe_id },
      select: {
        id: true,
        product_id: true,
        status: true,
        is_active: true,
        yield_quantity: true,
        waste_percent: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            component_product_id: true,
            quantity: true,
            waste_percent: true,
            waste_mode: true,
            waste_absolute: true,
          },
        },
      },
    });
    if (!recipe) throw new VendixHttpException(ErrorCodes.RECIPE_NOT_FOUND);
    return recipe;
  }

  // ------------------------------------------------------------------- read
  async findAll(query: ManufacturingOrderQueryDto) {
    this.requireStoreId();
    const {
      page = 1,
      limit = 25,
      status,
      product_id,
      date_from,
      date_to,
      search,
    } = query ?? {};

    const where: Prisma.production_ordersWhereInput = {
      order_number: { not: null },
      ...(status && { status }),
      ...(product_id && { product_id }),
      ...((date_from || date_to) && {
        created_at: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
      ...(search && {
        OR: [
          { order_number: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.production_orders.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: 'desc' },
        include: ORDER_INCLUDE,
      }),
      this.prisma.production_orders.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  findOne(id: number) {
    this.requireStoreId();
    return this.loadOrder(id);
  }

  // ----------------------------------------------------------------- create
  async create(dto: CreateManufacturingOrderDto) {
    const store_id = this.requireStoreId();
    const context = RequestContextService.getContext();

    const recipe = await this.loadRecipeForRequirements(dto.recipe_id);
    if (recipe.status !== 'active' || !recipe.is_active) {
      throw new VendixHttpException(ErrorCodes.MFG_FORMULA_NOT_ACTIVE);
    }
    if (recipe.items.length === 0) {
      throw new VendixHttpException(ErrorCodes.PRODUCTION_RECIPE_EMPTY);
    }
    await this.assertLocation(dto.location_id);

    const cost = await this.formulas.calculateCost(recipe.id);
    const requirements = this.productionOrders.computeComponentRequirements(
      recipe,
      dto.planned_qty,
    );
    const planned_cost = new Prisma.Decimal(
      (cost.unit_cost * dto.planned_qty).toFixed(4),
    );

    const created = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const order_number = await this.sequences.next(tx, store_id);
        return tx.production_orders.create({
          data: {
            store_id,
            product_id: recipe.product_id,
            recipe_id: recipe.id,
            planned_qty: new Prisma.Decimal(dto.planned_qty),
            status: 'draft',
            order_number,
            due_date: dto.due_date ? new Date(dto.due_date) : null,
            location_id: dto.location_id ?? null,
            priority: dto.priority ?? 'normal',
            notes: dto.notes ?? null,
            created_by: context?.user_id ?? null,
            source: 'manual',
            planned_cost,
            lines: {
              create: requirements.map((r, index) => ({
                component_product_id: r.component_product_id,
                planned_qty: new Prisma.Decimal(r.quantity),
                sort_order: index,
              })),
            },
          },
          select: { id: true },
        });
      },
    );
    return this.loadOrder(created.id);
  }

  // ----------------------------------------------------------------- update
  async update(id: number, dto: UpdateManufacturingOrderDto) {
    this.requireStoreId();
    const order = await this.loadOrder(id);
    if (order.status !== 'draft' && order.status !== 'released') {
      throw new VendixHttpException(ErrorCodes.MFG_ORDER_NOT_EDITABLE, undefined, {
        status: order.status,
      });
    }
    await this.assertLocation(dto.location_id);

    const qtyChanged =
      dto.planned_qty !== undefined &&
      Math.abs(dto.planned_qty - Number(order.planned_qty)) > EPS;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const data: Prisma.production_ordersUncheckedUpdateInput = {
        ...(dto.due_date !== undefined && { due_date: new Date(dto.due_date) }),
        ...(dto.location_id !== undefined && { location_id: dto.location_id }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updated_at: new Date(),
      };

      if (qtyChanged && dto.planned_qty !== undefined) {
        // Sin producción aún: se recalculan líneas y costo planificado.
        const recipe = await this.loadRecipeForRequirements(order.recipe_id);
        const cost = await this.formulas.calculateCost(order.recipe_id);
        const requirements = this.productionOrders.computeComponentRequirements(
          recipe,
          dto.planned_qty,
        );
        data.planned_qty = new Prisma.Decimal(dto.planned_qty);
        data.planned_cost = new Prisma.Decimal(
          (cost.unit_cost * dto.planned_qty).toFixed(4),
        );
        await tx.production_order_lines.deleteMany({ where: { order_id: id } });
        await tx.production_order_lines.createMany({
          data: requirements.map((r, index) => ({
            order_id: id,
            component_product_id: r.component_product_id,
            planned_qty: new Prisma.Decimal(r.quantity),
            sort_order: index,
          })),
        });
      }
      await tx.production_orders.update({ where: { id }, data });
    });
    return this.loadOrder(id);
  }

  // ------------------------------------------------------------- transitions
  private async transition(
    id: number,
    from: string[],
    to: 'released' | 'in_progress',
    extra: Prisma.production_ordersUncheckedUpdateInput = {},
  ) {
    this.requireStoreId();
    const order = await this.loadOrder(id);
    if (!from.includes(order.status)) {
      throw new VendixHttpException(
        ErrorCodes.MFG_ORDER_INVALID_STATE,
        `No se puede pasar la orden de "${order.status}" a "${to}"`,
        { from: order.status, to },
      );
    }
    await this.prisma.production_orders.update({
      where: { id },
      data: { status: to, updated_at: new Date(), ...extra },
    });
    return this.loadOrder(id);
  }

  release(id: number) {
    return this.transition(id, ['draft'], 'released');
  }

  start(id: number) {
    return this.transition(id, ['released'], 'in_progress', {
      started_at: new Date(),
    });
  }

  async cancel(id: number) {
    this.requireStoreId();
    const order = await this.loadOrder(id);
    if (order.status === 'partially_completed') {
      throw new VendixHttpException(ErrorCodes.MFG_CANCEL_AFTER_PARTIAL, undefined, {
        from: order.status,
      });
    }
    if (!['draft', 'released', 'in_progress'].includes(order.status)) {
      throw new VendixHttpException(
        ErrorCodes.MFG_ORDER_INVALID_STATE,
        `No se puede cancelar una orden en estado "${order.status}"`,
        { from: order.status, to: 'cancelled' },
      );
    }
    // En estos estados todavía no hubo movimientos de inventario: no quedan huérfanos.
    await this.prisma.production_orders.update({
      where: { id },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    return this.loadOrder(id);
  }

  // --------------------------------------------------------------- shortages
  async shortages(id: number): Promise<ShortageLine[]> {
    this.requireStoreId();
    const order = await this.loadOrder(id);
    const recipe = await this.loadRecipeForRequirements(order.recipe_id);
    const settings = await this.settingsService.get();

    const remaining = Math.max(
      0,
      Number(order.planned_qty) - Number(order.produced_qty ?? 0),
    );
    const requirements = this.productionOrders.computeComponentRequirements(
      recipe,
      remaining,
    );
    const names = new Map<number, string>(
      order.lines.map((l): [number, string] => [
        l.component_product_id,
        l.component_product?.name ?? '',
      ]),
    );

    const result: ShortageLine[] = [];
    for (const req of requirements) {
      const location_id =
        settings.default_input_location_id ??
        (await this.stockLevelManager.getDefaultLocationForProduct(
          req.component_product_id,
        ));
      const level = await this.prisma.stock_levels.findFirst({
        where: {
          product_id: req.component_product_id,
          product_variant_id: null,
          location_id,
        },
        select: { quantity_available: true },
      });
      const available = Number(level?.quantity_available ?? 0);
      result.push({
        product_id: req.component_product_id,
        name: names.get(req.component_product_id) ?? '',
        required: req.quantity,
        available,
        missing: Math.max(0, req.quantity - available),
      });
    }
    return result;
  }

  // --------------------------------------------------------------- complete
  async complete(id: number, dto: CompleteManufacturingOrderDto) {
    this.requireStoreId();
    const order = await this.loadOrder(id);
    if (order.status !== 'in_progress' && order.status !== 'partially_completed') {
      throw new VendixHttpException(
        ErrorCodes.MFG_ORDER_INVALID_STATE,
        `No se puede completar una orden en estado "${order.status}"`,
        { from: order.status, to: 'completed' },
      );
    }

    const planned = Number(order.planned_qty);
    const done = Number(order.produced_qty ?? 0);
    const remaining = planned - done;
    // El stock es entero (unidad mínima): cantidades enteras, sin redondeo
    // que pueda superar lo pendiente. El DTO ya exige enteros.
    const producedQty = dto.produced_qty ?? remaining;
    if (!Number.isInteger(producedQty) || producedQty <= 0) {
      throw new VendixHttpException(ErrorCodes.PRODUCTION_INVALID_QTY);
    }
    if (producedQty > remaining + EPS) {
      throw new VendixHttpException(
        ErrorCodes.MFG_QTY_EXCEEDS_REMAINING,
        `La cantidad (${producedQty}) excede lo pendiente de la orden (${remaining})`,
        { remaining, requested: producedQty },
      );
    }

    await this.assertLocation(dto.location_id);
    const settings = await this.settingsService.get();
    const outputLocationId =
      dto.location_id ??
      order.location_id ??
      settings.default_output_location_id ??
      undefined;

    await this.productionOrders.complete(
      id,
      { produced_qty: producedQty },
      {
        allowPartialBatch: true,
        sourceModule: 'manufacturing',
        outputLocationId,
        inputLocationId: settings.default_input_location_id ?? undefined,
        costingMethod: settings.cost_method === 'cpp' ? 'weighted_average' : 'fifo',
        onProduced: async (tx, info) => {
          // Bloqueo optimista: si otro completado cambió la orden después de
          // leerla, se aborta la transacción (revierte el stock movido).
          const claimed = await tx.production_orders.updateMany({
            where: { id, status: order.status, produced_qty: order.produced_qty },
            data: { updated_at: new Date() },
          });
          if (claimed.count !== 1) {
            throw new VendixHttpException(ErrorCodes.MFG_ORDER_CONCURRENT_UPDATE);
          }
          const newProduced = done + info.producedQty;
          const actualCost = Number(order.actual_cost ?? 0) + info.totalCost;
          const finished = newProduced >= planned - EPS;

          await this.persistLines(tx, id, info.consumptions);

          let batch_id = order.batch_id ?? undefined;
          if (settings.lot_required) {
            batch_id = await this.upsertBatch(tx, {
              order,
              dto,
              quantity: info.producedQty,
              location_id: outputLocationId,
            });
          }

          return {
            status: finished ? 'completed' : 'partially_completed',
            produced_qty: new Prisma.Decimal(newProduced),
            actual_cost: new Prisma.Decimal(actualCost.toFixed(4)),
            unit_cost: new Prisma.Decimal(
              (newProduced > 0 ? actualCost / newProduced : 0).toFixed(4),
            ),
            ...(batch_id !== undefined && { batch_id }),
          };
        },
      },
    );
    return this.loadOrder(id);
  }

  /** Acumula consumo y costo por línea (planificado vs consumido). */
  private async persistLines(
    tx: Prisma.TransactionClient,
    order_id: number,
    consumptions: Array<{
      component_product_id: number;
      consumed_qty: number;
      cost_snapshot: { unit_cost: number; total_cost: number } | null;
    }>,
  ): Promise<void> {
    const lines = await tx.production_order_lines.findMany({
      where: { order_id },
    });
    const byComponent = new Map(lines.map((l) => [l.component_product_id, l]));

    for (const c of consumptions) {
      const total = Number(c.cost_snapshot?.total_cost ?? 0);
      const existing = byComponent.get(c.component_product_id);
      const entry = {
        quantity: c.consumed_qty,
        unit_cost: Number(c.cost_snapshot?.unit_cost ?? 0),
        total_cost: total,
        at: new Date().toISOString(),
      };
      if (!existing) {
        await tx.production_order_lines.create({
          data: {
            order_id,
            component_product_id: c.component_product_id,
            planned_qty: new Prisma.Decimal(c.consumed_qty),
            consumed_qty: new Prisma.Decimal(c.consumed_qty),
            unit_cost: new Prisma.Decimal(
              (c.consumed_qty > 0 ? total / c.consumed_qty : 0).toFixed(4),
            ),
            total_cost: new Prisma.Decimal(total.toFixed(4)),
            cost_snapshot: { entries: [entry] },
          },
        });
        continue;
      }
      const consumed = Number(existing.consumed_qty) + c.consumed_qty;
      const totalCost = Number(existing.total_cost ?? 0) + total;
      const previous: Prisma.InputJsonValue[] =
        (existing.cost_snapshot as { entries?: Prisma.InputJsonValue[] } | null)
          ?.entries ?? [];
      await tx.production_order_lines.update({
        where: { id: existing.id },
        data: {
          consumed_qty: new Prisma.Decimal(consumed),
          total_cost: new Prisma.Decimal(totalCost.toFixed(4)),
          unit_cost: new Prisma.Decimal(
            (consumed > 0 ? totalCost / consumed : 0).toFixed(4),
          ),
          cost_snapshot: { entries: [...previous, entry] },
          updated_at: new Date(),
        },
      });
    }
  }

  /** Un lote por orden: se crea en la primera entrega y se incrementa después. */
  private async upsertBatch(
    tx: Prisma.TransactionClient,
    args: {
      order: { id: number; product_id: number; order_number: string | null; batch_id: number | null };
      dto: CompleteManufacturingOrderDto;
      quantity: number;
      location_id?: number;
    },
  ): Promise<number> {
    const { order, dto, quantity, location_id } = args;
    if (order.batch_id) {
      await tx.inventory_batches.update({
        where: { id: order.batch_id },
        data: { quantity: { increment: quantity }, updated_at: new Date() },
      });
      return order.batch_id;
    }
    const batch_number = dto.batch?.batch_number ?? order.order_number ?? `OP-${order.id}`;
    const duplicate = await tx.inventory_batches.findFirst({
      where: { product_id: order.product_id, batch_number },
      select: { id: true },
    });
    if (duplicate) {
      throw new VendixHttpException(
        ErrorCodes.MFG_BATCH_NUMBER_DUPLICATE,
        `Ya existe el lote "${batch_number}" para este producto`,
      );
    }
    const batch = await tx.inventory_batches.create({
      data: {
        product_id: order.product_id,
        batch_number,
        quantity,
        manufacturing_date: dto.batch?.manufacturing_date
          ? new Date(dto.batch.manufacturing_date)
          : new Date(),
        expiration_date: dto.batch?.expiration_date
          ? new Date(dto.batch.expiration_date)
          : null,
        location_id: location_id ?? null,
      },
      select: { id: true },
    });
    return batch.id;
  }
}

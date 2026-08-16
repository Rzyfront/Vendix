import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { UpdateReturnOrderDto } from './dto/update-return-order.dto';
import { ReturnOrderQueryDto } from './dto/return-order-query.dto';
import {
  Prisma,
  item_condition_enum,
  return_order_status_enum,
  return_order_type_enum,
} from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import {
  buildTaxBreakdown,
  scaleBreakdownToTotal,
  TaxBreakdownItem,
} from 'src/common/interfaces/tax-breakdown.interface';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';

@Injectable()
export class ReturnOrdersService {
  private readonly logger = new Logger(ReturnOrdersService.name);

  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Alta de una devolución con sus líneas.
   *
   * La versión anterior no podía funcionar: hacía `...createReturnOrderDto`
   * sobre el `data` —volcando siete claves que no son columnas— y le añadía
   * `return_number`, `return_date` y `total_refund_amount`, que tampoco
   * existen. Antes de llegar ahí llamaba a `generateReturnNumber`, que
   * consultaba `return_number`: esa consulta era la que reventaba primero, así
   * que el endpoint respondía 500 con cualquier cuerpo, incluso perfectamente
   * válido. Y las líneas nunca se creaban, porque el `create` jamás enviaba la
   * relación `return_order_items`.
   *
   * `organization_id` se escribe explícitamente: `return_orders` es un modelo
   * org-scoped, y el interceptor de `StorePrismaService` sólo inyecta
   * `store_id` en los store-scoped. Dentro de `$transaction` el cliente pierde
   * además el filtro de tenant, de modo que omitirlo no era «heredarlo»: era
   * violar un `NOT NULL`.
   */
  async create(createReturnOrderDto: CreateReturnOrderDto) {
    const organization_id = RequestContextService.getContext()?.organization_id;
    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    return this.prisma.$transaction(async (tx) =>
      tx.return_orders.create({
        data: {
          organization_id,
          type: createReturnOrderDto.type,
          status: return_order_status_enum.draft,
          related_order_id: createReturnOrderDto.related_order_id ?? null,
          related_order_type: createReturnOrderDto.related_order_type ?? null,
          related_dispatch_id: createReturnOrderDto.related_dispatch_id ?? null,
          partner_id: createReturnOrderDto.partner_id ?? null,
          partner_type: createReturnOrderDto.partner_type ?? null,
          reason_id: createReturnOrderDto.reason_id ?? null,
          return_order_items: {
            create: createReturnOrderDto.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id ?? null,
              quantity: item.quantity,
              condition: item.condition ?? item_condition_enum.good,
            })),
          },
        },
        include: {
          return_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      }),
    );
  }

  /**
   * Listado de devoluciones.
   *
   * Cada clave de `where` y de `orderBy` corresponde a una columna real de
   * `return_orders`. Antes no era así: el `orderBy` fijo apuntaba a
   * `return_date`, que no existe, de modo que este método —y los cuatro
   * listados que delegan en él— respondían 500 SIEMPRE, sin filtro alguno. El
   * `where` añadía además `order_id` y un `OR` sobre cuatro columnas de texto
   * inexistentes.
   */
  findAll(query: ReturnOrderQueryDto) {
    const where: Prisma.return_ordersWhereInput = {
      // La columna es `related_order_id`; `order_id` se conserva como nombre
      // del filtro porque es el que entiende quien consume la API.
      related_order_id: query.order_id,
      partner_id: query.partner_id,
      related_dispatch_id: query.related_dispatch_id,
      type: query.type,
      status: query.status,
      // store_id filter dropped (phase3-round2): StorePrismaService auto-scopes.
    };

    if (query.created_from || query.created_to) {
      where.created_at = {
        ...(query.created_from && { gte: query.created_from }),
        ...(query.created_to && { lte: query.created_to }),
      };
    }

    if (query.product_id) {
      where.return_order_items = {
        some: {
          product_id: query.product_id,
        },
      };
    }

    return this.prisma.return_orders.findMany({
      where,
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
      orderBy: {
        [query.sort_by ?? 'created_at']: query.sort_order ?? 'desc',
      },
    });
  }

  findByStatus(status: return_order_status_enum, query: ReturnOrderQueryDto) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findByType(
    type: return_order_type_enum,
    query: ReturnOrderQueryDto,
  ) {
    return this.findAll({
      ...query,
      type,
    });
  }

  findByPartner(partnerId: number, query: ReturnOrderQueryDto) {
    return this.findAll({
      ...query,
      partner_id: partnerId,
    });
  }

  async findOne(id: number) {
    const returnOrder = await this.prisma.return_orders.findUnique({
      where: { id },
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });

    if (!returnOrder) {
      throw new NotFoundException(`Devolución #${id} no encontrada`);
    }

    return returnOrder;
  }

  async remove(id: number) {
    // `delete` sobre un id inexistente lanza `P2025`; se comprueba antes para
    // devolver un 404 con mensaje en vez de dejar que el error de Prisma
    // atraviese el filtro genérico.
    await this.findOne(id);

    return this.prisma.return_orders.delete({
      where: { id },
    });
  }

  async update(id: number, updateReturnOrderDto: UpdateReturnOrderDto) {
    // Only allow updates if status is draft
    const existingReturn = await this.prisma.return_orders.findUnique({
      where: { id },
    });

    if (!existingReturn) {
      throw new NotFoundException(`Devolución #${id} no encontrada`);
    }

    if (existingReturn.status !== return_order_status_enum.draft) {
      throw new BadRequestException('Only draft returns can be updated');
    }

    return this.prisma.return_orders.update({
      where: { id },
      data: updateReturnOrderDto,
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async process(
    id: number,
    items: Array<{ id: number; action: string; location_id?: number }>,
  ) {
    const processed_return = await this.prisma.$transaction(async (tx) => {
      const returnOrder = await tx.return_orders.findUnique({
        where: { id },
        include: { return_order_items: true },
      });

      if (!returnOrder) {
        throw new NotFoundException(`Devolución #${id} no encontrada`);
      }

      if (returnOrder.status !== return_order_status_enum.draft) {
        throw new BadRequestException('Only draft returns can be processed');
      }

      // Process each item
      for (const item of items) {
        const returnItem = returnOrder.return_order_items.find(
          (ri) => ri.id === item.id,
        );
        if (!returnItem) continue;

        switch (item.action) {
          case 'restock':
            // Add items back to inventory
            await this.restockItem(
              tx,
              returnOrder,
              returnItem,
              item.location_id,
            );
            break;

          case 'write_off':
            // Write off damaged items
            await this.writeOffItem(
              tx,
              returnOrder,
              returnItem,
              item.location_id,
            );
            break;

          case 'repair':
            // Send items for repair
            await this.repairItem(
              tx,
              returnOrder,
              returnItem,
              item.location_id,
            );
            break;
        }
      }

      // Update return order status
      return tx.return_orders.update({
        where: { id },
        data: {
          status: return_order_status_enum.processed,
          processed_date: new Date(),
        },
        include: {
          return_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });

    // Emit refund.completed for accounting after successful transaction
    try {
      const refund_amount = await this.resolveRefundAmount(processed_return);
      if (refund_amount > 0) {
        // Derive tax proportion from the original order if linked
        let tax_amount = 0;
        let store_id: number | undefined;
        let tax_breakdown: TaxBreakdownItem[] = [];
        if (processed_return.related_order_id) {
          const original_order = await this.prisma.orders.findUnique({
            where: { id: processed_return.related_order_id },
            select: {
              tax_amount: true,
              grand_total: true,
              store_id: true,
            },
          });
          if (original_order) {
            store_id = original_order.store_id;
            const order_total = Number(original_order.grand_total || 0);
            const order_tax = Number(original_order.tax_amount || 0);
            if (order_total > 0 && order_tax > 0) {
              // Proportional tax: refund_amount / grand_total * tax_amount
              tax_amount =
                Math.round((refund_amount / order_total) * order_tax * 100) /
                100;
              // Preserve the original fiscal-type mix when reversing taxes, so
              // an IVA+INC sale reverses against 2408 and 2436 proportionally.
              const items = await this.prisma.order_items.findMany({
                where: { order_id: processed_return.related_order_id },
                select: {
                  order_item_taxes: {
                    select: { tax_type: true, tax_amount: true },
                  },
                },
              });
              const baseBreakdown = buildTaxBreakdown(
                items.flatMap((i) => i.order_item_taxes || []),
              );
              tax_breakdown = scaleBreakdownToTotal(baseBreakdown, tax_amount);
            }
          }
        }

        this.eventEmitter.emit('refund.completed', {
          refund_id: processed_return.id,
          organization_id: processed_return.organization_id,
          store_id,
          amount: refund_amount,
          tax_amount,
          tax_breakdown,
          return_type: processed_return.type,
          user_id: RequestContextService.getUserId(),
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit refund.completed for return order #${id}: ${error.message}`,
      );
    }

    return processed_return;
  }

  async cancel(id: number) {
    const returnOrder = await this.prisma.return_orders.findUnique({
      where: { id },
    });

    if (!returnOrder) {
      throw new NotFoundException(`Devolución #${id} no encontrada`);
    }

    if (returnOrder.status === return_order_status_enum.processed) {
      throw new BadRequestException('Processed returns cannot be cancelled');
    }

    return this.prisma.return_orders.update({
      where: { id },
      data: {
        status: return_order_status_enum.cancelled,
        cancelled_date: new Date(),
      },
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }


  /**
   * Importe a reembolsar por una devolución ya procesada.
   *
   * `return_orders` no tiene ninguna columna monetaria — el código leía
   * `total_refund_amount`, que no existe, así que el valor era siempre
   * `undefined`, el importe salía 0 y **el evento contable `refund.completed`
   * no se emitía nunca**: procesar una devolución no reversaba nada.
   *
   * El importe se deriva de la orden de venta enlazada: por cada línea
   * devuelta se toma el precio unitario efectivo de la línea original
   * (`total_price / quantity`, que ya incorpora descuentos y
   * `price_unit_quantity`) y se multiplica por la cantidad devuelta. Si no hay
   * orden enlazada o ninguna línea casa, se devuelve 0 y no se emite evento —
   * como antes, pero ahora por una razón declarada en vez de por una columna
   * fantasma.
   */
  private async resolveRefundAmount(returnOrder: any): Promise<number> {
    if (!returnOrder.related_order_id) return 0;

    const original_items = await this.prisma.order_items.findMany({
      where: { order_id: returnOrder.related_order_id },
      select: {
        product_id: true,
        product_variant_id: true,
        quantity: true,
        total_price: true,
      },
    });
    if (!original_items.length) return 0;

    const unit_price_by_key = new Map<string, number>();
    for (const line of original_items) {
      const quantity = Number(line.quantity || 0);
      if (quantity <= 0) continue;
      const key = `${line.product_id}-${line.product_variant_id ?? 'null'}`;
      unit_price_by_key.set(key, Number(line.total_price || 0) / quantity);
    }

    let total = 0;
    for (const item of returnOrder.return_order_items ?? []) {
      const key = `${item.product_id}-${item.product_variant_id ?? 'null'}`;
      const unit_price = unit_price_by_key.get(key);
      if (unit_price === undefined) continue;
      total += unit_price * Number(item.quantity || 0);
    }

    return Math.round(total * 100) / 100;
  }

  /**
   * Bodega sobre la que se mueve el stock de una línea devuelta.
   *
   * Los tres manejadores leían `returnOrder.location_id`, que no es columna de
   * `return_orders`: valía `undefined` y llegaba así a `updateStock`, cuyo
   * parámetro `location_id` es obligatorio. Cuando el cliente no manda una
   * bodega explícita se resuelve la misma que usan POS y ecommerce, que además
   * falla con `INV_LOC_001` tipado si la tienda no tiene ninguna vendible.
   */
  private resolveItemLocation(
    returnItem: any,
    locationId?: number,
  ): Promise<number> {
    if (locationId) return Promise.resolve(locationId);
    return this.stockLevelManager.getDefaultLocationForProduct(
      returnItem.product_id,
      returnItem.product_variant_id || undefined,
    );
  }

  /**
   * Texto del movimiento. Se apoyaba en `returnItem.reason`, que tampoco
   * existe: el motivo vive —cuando vive— en `return_orders.reason_id`, y la
   * línea sólo tiene `condition`.
   */
  private movementReason(
    action: string,
    returnOrder: any,
    returnItem: any,
  ): string {
    const suffix = returnOrder.reason_id ? ` motivo ${returnOrder.reason_id}` : '';
    return `Devolución #${returnOrder.id} · ${action} · estado ${returnItem.condition}${suffix}`;
  }

  private async restockItem(
    tx: any,
    returnOrder: any,
    returnItem: any,
    locationId?: number,
  ) {
    const target_location_id = await this.resolveItemLocation(
      returnItem,
      locationId,
    );

    // Update stock levels using StockLevelManager (handles sync + movement + transaction)
    await this.stockLevelManager.updateStock(
      {
        product_id: returnItem.product_id,
        variant_id: returnItem.product_variant_id || undefined,
        location_id: target_location_id,
        quantity_change: returnItem.quantity,
        movement_type: 'return',
        reason: this.movementReason('reingreso', returnOrder, returnItem),
        create_movement: true,
      },
      tx,
    );
  }

  private async writeOffItem(
    tx: any,
    returnOrder: any,
    returnItem: any,
    locationId?: number,
  ) {
    const target_location_id = await this.resolveItemLocation(
      returnItem,
      locationId,
    );

    // Update stock levels using StockLevelManager (handles sync + movement + transaction)
    // Note: write-off is damage, so quantity_change is negative
    await this.stockLevelManager.updateStock(
      {
        product_id: returnItem.product_id,
        variant_id: returnItem.product_variant_id || undefined,
        location_id: target_location_id,
        quantity_change: -returnItem.quantity,
        movement_type: 'damage',
        reason: this.movementReason('baja', returnOrder, returnItem),
        create_movement: true,
        from_location_id: target_location_id,
      },
      tx,
    );
  }

  private async repairItem(
    tx: any,
    returnOrder: any,
    returnItem: any,
    locationId?: number,
  ) {
    const target_location_id = await this.resolveItemLocation(
      returnItem,
      locationId,
    );

    // Update stock levels using StockLevelManager (handles sync + movement + transaction)
    await this.stockLevelManager.updateStock(
      {
        product_id: returnItem.product_id,
        variant_id: returnItem.product_variant_id || undefined,
        location_id: target_location_id,
        quantity_change: returnItem.quantity,
        movement_type: 'adjustment',
        reason: this.movementReason('reparación', returnOrder, returnItem),
        create_movement: true,
      },
      tx,
    );
  }
}

import {
  Injectable,
  BadRequestException,
  NotFoundException,
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
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';

/**
 * QUI-893 B1 — a return that gives goods (and money) back to a CUSTOMER. The
 * only way to do that is "Reembolsar" from the order detail
 * (`RefundFlowService`: cash-session gate, drawer movement, refund entry and
 * restock in one flow). A supplier-typed return pointing at a customer sale or
 * partner is the same thing under another label, so it is caught too.
 */
function isCustomerReturn(fields: {
  type?: string | null;
  related_order_type?: string | null;
  partner_type?: string | null;
}): boolean {
  return (
    fields.type === return_order_type_enum.sales_return ||
    fields.related_order_type === 'sales_order' ||
    fields.partner_type === 'customer'
  );
}

function assertNotCustomerReturn(fields: Parameters<typeof isCustomerReturn>[0]) {
  if (isCustomerReturn(fields)) {
    throw new VendixHttpException(ErrorCodes.RETURN_ORDER_SALES_USE_REFUND_001);
  }
}

@Injectable()
export class ReturnOrdersService {
  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
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
    assertNotCustomerReturn(createReturnOrderDto);
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
    // A draft can not be relabeled into a customer return (nor an old
    // customer-return draft into a supplier one to get it processed).
    assertNotCustomerReturn(existingReturn);
    assertNotCustomerReturn(updateReturnOrderDto);

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

      // Legacy customer-return drafts are closed: no stock, no accounting.
      // The refund from the order detail does the restock with the money.
      assertNotCustomerReturn(returnOrder);

      // A supplier return moves the logical quantity of each line.
      const stockUnitsFor = (returnItem: { quantity: number }): number =>
        Number(returnItem.quantity);

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
              stockUnitsFor(returnItem),
              item.location_id,
            );
            break;

          case 'write_off':
            // Write off damaged items
            await this.writeOffItem(
              tx,
              returnOrder,
              returnItem,
              stockUnitsFor(returnItem),
              item.location_id,
            );
            break;

          case 'repair':
            // Send items for repair
            await this.repairItem(
              tx,
              returnOrder,
              returnItem,
              stockUnitsFor(returnItem),
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
    }, { timeout: 20_000, maxWait: 5_000 });

    // QUI-893 B1 — no `refund.completed` here: a supplier return moves no
    // money to a customer, and customer refunds are booked by RefundFlowService
    // when the money actually leaves.
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
   * Bodega sobre la que se mueve el stock de una línea devuelta.
   *
   * Los tres manejadores leían `returnOrder.location_id`, que no es columna de
   * `return_orders`: valía `undefined` y llegaba así a `updateStock`, cuyo
   * parámetro `location_id` es obligatorio. Cuando el cliente no manda una
   * bodega explícita se resuelve la misma que usan POS y ecommerce, que además
   * falla con `INV_LOC_001` tipado si la tienda no tiene ninguna vendible.
   *
   * La consulta corre con la `tx` de la devolución: sin ella cada línea pide
   * otra conexión del pool mientras la transacción sigue abierta.
   */
  private resolveItemLocation(
    tx: Prisma.TransactionClient,
    returnItem: any,
    locationId?: number,
  ): Promise<number> {
    if (locationId) return Promise.resolve(locationId);
    return this.stockLevelManager.getDefaultLocationForProduct(
      returnItem.product_id,
      returnItem.product_variant_id || undefined,
      tx,
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
    stockUnits: number,
    locationId?: number,
  ) {
    const target_location_id = await this.resolveItemLocation(
      tx,
      returnItem,
      locationId,
    );

    // Update stock levels using StockLevelManager (handles sync + movement + transaction)
    await this.stockLevelManager.updateStock(
      {
        product_id: returnItem.product_id,
        variant_id: returnItem.product_variant_id || undefined,
        location_id: target_location_id,
        quantity_change: stockUnits,
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
    stockUnits: number,
    locationId?: number,
  ) {
    const target_location_id = await this.resolveItemLocation(
      tx,
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
        quantity_change: -stockUnits,
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
    stockUnits: number,
    locationId?: number,
  ) {
    const target_location_id = await this.resolveItemLocation(
      tx,
      returnItem,
      locationId,
    );

    // Update stock levels using StockLevelManager (handles sync + movement + transaction)
    await this.stockLevelManager.updateStock(
      {
        product_id: returnItem.product_id,
        variant_id: returnItem.product_variant_id || undefined,
        location_id: target_location_id,
        quantity_change: stockUnits,
        movement_type: 'adjustment',
        reason: this.movementReason('reparación', returnOrder, returnItem),
        create_movement: true,
      },
      tx,
    );
  }
}

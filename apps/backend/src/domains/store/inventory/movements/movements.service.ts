import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
import {
  INBOUND_MOVEMENT_TYPES,
  OUTBOUND_MOVEMENT_TYPES,
  TRANSFER_MOVEMENT_TYPE,
} from '../../analytics/analytics-metrics.contract';

@Injectable()
export class MovementsService {
  constructor(private prisma: StorePrismaService) {}

  async create(createMovementDto: CreateMovementDto) {
    return this.prisma.$transaction(async (tx) => {
      // Create the movement record
      const movement = await tx.inventory_movements.create({
        data: {
          ...createMovementDto,
          created_at: new Date(),
        },
        include: {
          products: true,
          product_variants: true,
          from_location: true,
          to_location: true,
          users: true,
        },
      });

      // Update stock levels based on movement type
      await this.updateStockLevels(tx, movement);

      return movement;
    });
  }

  /**
   * Filtro del listado. Vive en UN solo lugar a propósito: cuando el listado y
   * las tarjetas lo construían cada uno por su cuenta, un filtro que se
   * agregaba en uno quedaba fuera del otro y las cifras dejaban de hablar del
   * mismo conjunto sin que nada fallara.
   */
  private buildWhere(query: MovementQueryDto): any {
    const where: any = {
      product_id: query.product_id,
      product_variant_id: query.product_variant_id,
      from_location_id: query.from_location_id,
      to_location_id: query.to_location_id,
      movement_type: query.movement_type,
      user_id: query.user_id,
    };

    // Add date range filter
    if (query.start_date || query.end_date) {
      where.created_at = {};
      if (query.start_date) {
        where.created_at.gte = new Date(query.start_date);
      }
      if (query.end_date) {
        where.created_at.lte = new Date(query.end_date);
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { reason: { contains: query.search } },
        { notes: { contains: query.search } },
        { products: { name: { contains: query.search } } },
      ];
    }

    return where;
  }

  async findAll(query: MovementQueryDto) {
    const {
      page = 1,
      limit = 25,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);

    const [data, total] = await Promise.all([
      this.prisma.inventory_movements.findMany({
        where,
        skip,
        take: limit,
        include: {
          products: true,
          product_variants: true,
          from_location: true,
          to_location: true,
          users: true,
        },
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.inventory_movements.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  findByProduct(productId: number, query: MovementQueryDto) {
    return this.findAll({
      ...query,
      product_id: productId,
    });
  }

  findByLocation(locationId: number, query: MovementQueryDto) {
    return this.findAll({
      ...query,
      from_location_id: locationId,
    });
  }

  findByUser(userId: number, query: MovementQueryDto) {
    return this.findAll({
      ...query,
      user_id: userId,
    });
  }

  /**
   * Conteos agregados de TODO el conjunto filtrado, para las tarjetas.
   *
   * No se puede resolver con la página que ya trae el listado: la página son 25
   * filas y la tarjeta habla del total. Antes las tarjetas de entradas, salidas
   * y transferencias venían fijas en 0 desde el frontend, así que mostraban cero
   * sobre cientos de movimientos reales — un dato falso, no un dato faltante.
   *
   * La dirección de un movimiento la dicen sus dos patas de ubicación, no su
   * tipo: sale de `from_location_id` y entra a `to_location_id`. Sólo
   * `adjustment` es ambiguo (sube o baja stock), y se resuelve igual que en el
   * listado: si perdió la pata de destino, salió. Los demás tipos existen en un
   * único sentido, así que se clasifican por tipo. Las tres cifras y el total
   * cierran: entradas + salidas + transferencias = total.
   */
  async getStats(query: MovementQueryDto) {
    const where = this.buildWhere(query);

    // Las listas viven en el contrato de métricas, no aquí. Cuando la serie de
    // analítica y estas tarjetas definían "entrada" cada una por su lado, las
    // dos pantallas respondían distinto a la misma pregunta —16.444 unidades de
    // diferencia— y ninguna fallaba.
    const INBOUND_TYPES = [...INBOUND_MOVEMENT_TYPES];
    const OUTBOUND_TYPES = [...OUTBOUND_MOVEMENT_TYPES];

    const [
      total,
      inboundTyped,
      outboundTyped,
      transfers,
      adjustmentsOut,
      adjustmentsIn,
    ] = await Promise.all([
      this.prisma.inventory_movements.count({ where }),
      // Se compone con AND, no con spread: si el usuario ya filtró por tipo, el
      // spread pisaba SU filtro y la tarjeta contaba fuera de lo que la tabla
      // muestra. Con AND las dos condiciones se respetan y filtrar por
      // "transferencia" deja entradas y salidas en 0, que es la verdad.
      this.prisma.inventory_movements.count({
        where: { AND: [where, { movement_type: { in: INBOUND_TYPES as any } }] },
      }),
      this.prisma.inventory_movements.count({
        where: {
          AND: [where, { movement_type: { in: OUTBOUND_TYPES as any } }],
        },
      }),
      this.prisma.inventory_movements.count({
        where: { AND: [where, { movement_type: TRANSFER_MOVEMENT_TYPE }] },
      }),
      // Ajuste que sacó stock: conserva la pata de origen y perdió la de
      // destino. Es la forma de toda salida nueva.
      this.prisma.inventory_movements.count({
        where: {
          AND: [where, { movement_type: 'adjustment', to_location_id: null }],
        },
      }),
      this.prisma.inventory_movements.count({
        where: {
          AND: [
            where,
            { movement_type: 'adjustment', to_location_id: { not: null } },
          ],
        },
      }),
    ]);

    return {
      total,
      stock_in: inboundTyped + adjustmentsIn,
      stock_out: outboundTyped + adjustmentsOut,
      transfers,
    };
  }

  async findOne(id: number) {
    const movement = await this.prisma.inventory_movements.findUnique({
      where: { id },
      include: {
        products: true,
        product_variants: true,
        from_location: true,
        to_location: true,
        users: true,
      },
    });

    // Sin este throw el handler contestaba 200 con `data: null` y la pantalla
    // de detalle quedaba en blanco sin decir por qué.
    if (!movement) {
      throw new VendixHttpException(ErrorCodes.INV_FIND_001);
    }

    return movement;
  }

  private async updateStockLevels(tx: any, movement: any) {
    const {
      product_id,
      product_variant_id,
      from_location_id,
      to_location_id,
      quantity,
      movement_type,
    } = movement;

    switch (movement_type) {
      case 'stock_in':
        if (to_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            to_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;

      case 'stock_out':
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
        }
        break;

      case 'transfer':
        if (from_location_id && to_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
          await this.updateStockLevel(
            tx,
            product_id,
            to_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;

      case 'sale':
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
        }
        break;

      case 'return':
        if (to_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            to_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;

      case 'damage':
      case 'expiration':
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
        }
        break;

      case 'adjustment':
        // Adjustments can be positive or negative based on quantity
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;
    }
  }

  private async updateStockLevel(
    tx: any,
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    const existingStock = await tx.stock_levels.findUnique({
      where: {
        product_id_product_variant_id_location_id: {
          product_id: productId,
          product_variant_id: productVariantId || null,
          location_id: locationId,
        },
      },
    });

    if (existingStock) {
      const newQuantityOnHand = existingStock.quantity_on_hand + quantityChange;
      const newQuantityAvailable =
        existingStock.quantity_available + quantityChange;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_on_hand: Math.max(0, newQuantityOnHand),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
    } else {
      return tx.stock_levels.create({
        data: {
          product_id: productId,
          product_variant_id: productVariantId,
          location_id: locationId,
          quantity_on_hand: Math.max(0, quantityChange),
          quantity_reserved: 0,
          quantity_available: Math.max(0, quantityChange),
          last_updated: new Date(),
        },
      });
    }
  }
}

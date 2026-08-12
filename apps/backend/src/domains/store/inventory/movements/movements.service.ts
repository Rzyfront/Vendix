import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { movement_type_enum } from '@prisma/client';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
import {
  INBOUND_MOVEMENT_TYPES,
  OUTBOUND_MOVEMENT_TYPES,
  TRANSFER_MOVEMENT_TYPE,
} from '../../analytics/analytics-metrics.contract';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { CostingService } from '../shared/services/costing.service';
import { CostingMethodResolverService } from '../shared/services/costing-method-resolver.service';

@Injectable()
export class MovementsService {
  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private costingService: CostingService,
    private costingMethodResolver: CostingMethodResolverService,
  ) {}

  /**
   * ESTE ENDPOINT NUNCA FUNCIONÓ. `inventory_movements.organization_id` es
   * `NOT NULL` y ni el DTO lo pedía ni el servicio lo ponía, así que todo POST
   * moría con `PrismaClientValidationError` («Argument `organizations` is
   * missing») convertido en 500 — antes siquiera de tocar el stock. Por eso el
   * motor paralelo que vivía aquí jamás llegó a corromper nada: era inalcanzable.
   *
   * Se resuelve desde el contexto de la petición, como el resto del dominio: el
   * tenant no es dato de entrada del cliente, y aceptarlo por el cuerpo abriría
   * una escritura cruzada entre organizaciones.
   *
   * Segundo motivo por el que nunca funcionó: el DTO se volcaba entero con
   * spread, y declara DOS campos que la tabla no tiene —`unit_cost` y
   * `expiration_date`—. Mandar cualquiera de los dos hacía que Prisma rechazara
   * el `create` con otro 500. `unit_cost` no es un dato del movimiento: es el
   * costo con el que se valoriza la entrada, y su destinatario es el motor de
   * stock. Igual `expiration_date`: su destino es la capa de costo. Por eso
   * ahora los campos se nombran uno a uno en vez de volcarse.
   */
  async create(createMovementDto: CreateMovementDto) {
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;
    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }

    const { unit_cost, expiration_date, ...movementFields } = createMovementDto;

    this.assertMovementLocations(movementFields);

    return this.prisma.$transaction(async (tx) => {
      // Create the movement record
      const movement = await tx.inventory_movements.create({
        data: {
          ...movementFields,
          organization_id,
          // `user_id` es nulable, pero dejarlo vacío deja el movimiento sin
          // autor y la trazabilidad a medias: quién lo hizo sale del contexto.
          user_id: context?.user_id ?? undefined,
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

      // Aplica el movimiento al stock. El espejo denormalizado
      // (`products.stock_quantity`) lo sincroniza `StockLevelManager` en su
      // paso 7 — un solo dueño, que es justamente lo que faltaba: este endpoint
      // escribía `stock_levels` por su cuenta y dejaba la vitrina, las
      // analíticas y el validador leyendo el saldo anterior sin que nada fallara.
      await this.updateStockLevels(
        tx,
        movement,
        unit_cost,
        organization_id,
        expiration_date,
      );

      return movement;
    });
  }

  /**
   * Exige la pata de ubicación que el tipo necesita, ANTES de escribir nada.
   *
   * Sin esto el `switch` de `updateStockLevels` hace `if (to_location_id)` y, si
   * la pata falta, no entra a ninguna rama: el movimiento queda escrito en la
   * bitácora y el stock NO se mueve. El endpoint responde 201 y la existencia
   * sigue igual — el peor resultado posible, porque el usuario ve el registro y
   * cree que ajustó el inventario. Un 400 nombrando el campo que falta es
   * ruidoso; un 201 que no mueve stock es un descuadre silencioso.
   */
  private assertMovementLocations(movement: {
    movement_type: movement_type_enum;
    from_location_id?: number;
    to_location_id?: number;
  }) {
    const { movement_type, from_location_id, to_location_id } = movement;

    const needsDestination =
      movement_type === 'stock_in' ||
      movement_type === 'return' ||
      movement_type === TRANSFER_MOVEMENT_TYPE;
    const needsOrigin =
      movement_type === 'stock_out' ||
      movement_type === 'damage' ||
      movement_type === 'expiration' ||
      movement_type === 'adjustment' ||
      movement_type === TRANSFER_MOVEMENT_TYPE;

    const missing: string[] = [];
    if (needsOrigin && from_location_id == null) {
      missing.push('from_location_id');
    }
    if (needsDestination && to_location_id == null) {
      missing.push('to_location_id');
    }

    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.INV_MOVEMENT_LOCATION_001,
        `Movement type '${movement_type}' requires ${missing.join(' and ')}`,
      );
    }
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

  /**
   * Aplica el movimiento al stock a través de `StockLevelManager`, el motor
   * canónico. ANTES este método escribía `stock_levels` por su cuenta con un
   * helper privado (`updateStockLevel`), y por eso el endpoint no aplicaba
   * costeo, no registraba `inventory_transactions` y recortaba a cero en vez de
   * fallar: creaba existencias sin costo —diluyendo el CPP del producto— y sin
   * traza contable, con permiso concedido a owner, admin, manager y Preventista.
   *
   * El manager aporta las cuatro piezas que faltaban: capas de costo, la
   * transacción de inventario, la validación de disponible y la sincronización
   * del espejo denormalizado. `create_movement: false` porque `create` ya
   * insertó la fila de `inventory_movements`; dejarlo en `true` la duplicaría.
   *
   * CAMBIO DE COMPORTAMIENTO deliberado: las salidas (`stock_out`, `damage`,
   * `expiration`, el tramo de origen de un `transfer`) ahora VALIDAN disponible.
   * Antes una salida mayor al saldo se recortaba a cero en silencio y el
   * faltante desaparecía del registro; ahora responde con error igual que
   * el resto del sistema. Las entradas no validan: no tiene sentido.
   */
  private async updateStockLevels(
    tx: any,
    movement: any,
    // Llega aparte porque `inventory_movements` no tiene columna de costo: el
    // costo viaja del DTO al motor sin pasar por la fila del movimiento.
    unit_cost?: number,
    organization_id?: number,
    // Va a la CAPA de costo (`inventory_cost_layers.expiration_date`), no a la
    // fila del movimiento: la tabla de movimientos no tiene esa columna. Sin
    // esto el vencimiento que capturaba el formulario se descartaba en silencio.
    expiration_date?: string,
  ) {
    const {
      product_id,
      product_variant_id,
      from_location_id,
      to_location_id,
      quantity,
      movement_type,
      reason,
      user_id,
    } = movement;

    const apply = async (
      location_id: number,
      quantity_change: number,
      validate_availability: boolean,
    ) => {
      // Costeo de la ENTRADA, con el mismo orden que la recepción de compras:
      // el promedio se calcula ANTES de mover el stock, porque necesita leer el
      // saldo previo. `calculateCostOnReceipt` además crea la capa de costo.
      //
      // La distinción entre los dos parámetros importa y es fácil de invertir:
      //   · `unit_cost`          → el NUEVO promedio a persistir en stock_levels
      //   · `movement_unit_cost` → el costo de ESTA entrada, sólo para valorarla
      // Pasar el costo de la entrada como `unit_cost` pisaba el promedio del
      // producto con el precio de una sola compra (1 u. a 3.800 + 3 u. a 4.200
      // quedaba en 4.200 en vez de 4.100).
      let costed_unit_cost: number | undefined;
      const movement_unit_cost =
        unit_cost != null ? Number(unit_cost) : undefined;

      if (
        movement_unit_cost != null &&
        quantity_change > 0 &&
        movement_type !== 'transfer' &&
        organization_id != null
      ) {
        const costing_method =
          await this.costingMethodResolver.resolveCostingMethod(
            organization_id,
            RequestContextService.getStoreId() ?? undefined,
          );
        const costResult = await this.costingService.calculateCostOnReceipt(
          {
            product_id,
            variant_id: product_variant_id ?? undefined,
            location_id,
            quantity_received: quantity_change,
            unit_cost: movement_unit_cost,
            costing_method,
            expiration_date: expiration_date
              ? new Date(expiration_date)
              : undefined,
          },
          tx,
        );
        costed_unit_cost = costResult?.new_cost_per_unit ?? movement_unit_cost;
      }

      return this.stockLevelManager.updateStock(
        {
          product_id,
          variant_id: product_variant_id ?? undefined,
          location_id,
          quantity_change,
          movement_type,
          reason: reason ?? undefined,
          user_id: user_id ?? undefined,
          from_location_id: from_location_id ?? undefined,
          to_location_id: to_location_id ?? undefined,
          unit_cost: costed_unit_cost,
          movement_unit_cost,
          source_module: 'inventory_movements',
          // `create` ya escribió la fila del movimiento.
          create_movement: false,
          validate_availability,
        },
        tx,
      );
    };

    switch (movement_type) {
      case 'stock_in':
        if (to_location_id) {
          await apply(to_location_id, quantity, false);
        }
        break;

      case 'stock_out':
        if (from_location_id) {
          await apply(from_location_id, -quantity, true);
        }
        break;

      case 'transfer':
        if (from_location_id && to_location_id) {
          // Origen primero y validando: si no hay saldo, el destino no llega a
          // sumar y la transacción entera se deshace.
          await apply(from_location_id, -quantity, true);
          await apply(to_location_id, quantity, false);
        }
        break;

      case 'return':
        if (to_location_id) {
          await apply(to_location_id, quantity, false);
        }
        break;

      case 'damage':
      case 'expiration':
        if (from_location_id) {
          await apply(from_location_id, -quantity, true);
        }
        break;

      case 'adjustment':
        // Un ajuste puede ser positivo o negativo. Sólo se valida cuando resta:
        // un ajuste a la baja mayor al saldo es un dato equivocado, no una
        // corrección — y recortarlo a cero borraba la evidencia.
        if (from_location_id) {
          await apply(from_location_id, quantity, quantity < 0);
        }
        break;
    }
  }
}

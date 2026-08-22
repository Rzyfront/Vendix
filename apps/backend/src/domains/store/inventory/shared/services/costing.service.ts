import { Injectable, Logger } from '@nestjs/common';
import { Prisma, product_state_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

/**
 * Universo de ubicaciones que un agregado de costo puede mirar.
 *
 * OJO: NO es un fragmento `where` de Prisma. `store_id` aquí significa
 * `(inventory_locations.store_id = <valor> OR inventory_locations.store_id IS
 * NULL)` — la tienda MÁS la bodega central de la organización, que no cuelga de
 * ninguna tienda. Ausente ⇒ toda la organización. La traducción a SQL vive en
 * `buildLocationMembershipSql`, que es el ÚNICO consumidor.
 */
export interface ScopedLocationFilter {
  organization_id: number;
  store_id?: number;
}

/**
 * CP-PURCHASE-TRANSPARENCY D.2 — el estado que saca a un producto del universo
 * de costo.
 *
 * EL DEFECTO QUE CIERRA
 * ---------------------
 * Archivar un producto era un cambio de bandera invisible: `remove()` escribía
 * `state='archived'` y NO tocaba `stock_levels`. Esas unidades seguían dentro
 * del promedio ponderado. Medido en desarrollo: el producto 378, archivado, con
 * 20.000 unidades a 3,00, hacía que una compra real a 100,00 cotizara un costo
 * nuevo de 2,03 — el operador cree que borró el producto y el sistema le sigue
 * promediando contra existencias fantasma.
 *
 * DÓNDE SE APLICA, Y DÓNDE NO
 * ---------------------------
 * El criterio es de UNIVERSO: un archivado no participa en un agregado que
 * BARRE varias filas de un alcance (`getScopedStockAggregate`,
 * `initializeCostLayers`). NO se aplica en `consumeCostLayers`, y no es un
 * olvido: allí el producto viene FIJADO por el llamador, así que el filtro no
 * podría cambiar QUÉ se consume — sólo negarse a costear. Y el primer llamador
 * que consume stock de un producto archivado es justamente el castigo de
 * inventario de D.4 (`adjustment_type='loss'`, `quantity_after=0`), cuyo COGS
 * es la cifra que alimenta el asiento a 529505 «Faltantes de Inventario».
 * Filtrar ahí dejaría todos los castigos valorados en CERO — exactamente la
 * mudez contable que D.8 existe para evitar. Ver el comentario en
 * `consumeCostLayers`.
 */
export const ARCHIVED_PRODUCT_STATE = product_state_enum.archived;

/**
 * Predicado SQL del universo activo, para la consulta cruda del agregado.
 *
 * SIN PARÁMETRO, A PROPÓSITO. `'archived'` es una constante de compilación, no
 * entrada de usuario, así que va literal en la plantilla. Parametrizarla
 * (`${ARCHIVED_PRODUCT_STATE}`) correría los índices `$n` de todos los
 * parámetros que vienen después —organización y tienda incluidas— y el bloque
 * A.0 del spec compara la CADENA SQL y los VALORES emitidos con `tx` y sin
 * `tx`: un corrimiento silencioso ahí es el aviso de que el aislamiento entre
 * organizaciones dejó de estar donde el spec cree.
 *
 * `IS DISTINCT FROM` y no `<>`: el `LEFT JOIN products` puede, en teoría,
 * devolver `p.state` NULL; con `<>` la fila caería fuera por comparación NULL.
 * Una fila de stock sin producto no es un archivado, es un huérfano, y su sitio
 * es dentro del agregado (visible) y no fuera (silenciado).
 */
const ACTIVE_PRODUCT_STATE_SQL = Prisma.sql`p.state IS DISTINCT FROM 'archived'`;

/**
 * El MISMO criterio en forma de fragmento `where` de Prisma, para las lecturas
 * del universo que no son crudas. Único punto de verdad junto a
 * {@link ACTIVE_PRODUCT_STATE_SQL}: si un día el estado excluido cambia, cambia
 * aquí y en la constante de arriba, no en cada `where` del dominio.
 */
export const ACTIVE_PRODUCT_RELATION_FILTER = {
  products: { state: { not: ARCHIVED_PRODUCT_STATE } },
} as const;

/**
 * Fila cruda del universo de stock. Los tres costos viajan juntos para que la
 * cadena canónica de fallback (`cost_per_unit` → variante → producto → 0) se
 * resuelva en TypeScript con la misma semántica `||` que el resto del servicio,
 * en vez de reimplementarla en SQL con `NULLIF`/`COALESCE`.
 */
interface ScopedStockRow {
  quantity_on_hand: number | string | null;
  cost_per_unit: unknown;
  variant_cost_price: unknown;
  product_cost_price: unknown;
}

export interface CalculateCostParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity_received: number;
  unit_cost: number;
  costing_method: 'weighted_average' | 'fifo' | 'lifo';
  purchase_order_id?: number;
  batch_number?: string;
  manufacturing_date?: Date;
  expiration_date?: Date;
}

export interface CostCalculationResult {
  /**
   * Weighted-average cost of the RECEIVING location alone (used to update
   * that location's `stock_levels.cost_per_unit`).
   */
  new_cost_per_unit: number;
  /**
   * QUI-425 — scoped weighted-average cost across ALL in-scope locations
   * (the value persisted to `products/variants.cost_price`). Pricing/margin
   * recomputation MUST use this so `base_price = cost_price·(1+margin/100)`
   * stays consistent and matches the cost preview.
   */
  new_scoped_cost_per_unit: number;
  previous_cost_per_unit: number;
}

export interface ConsumeCostParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity: number;
  costing_method: 'weighted_average' | 'fifo' | 'lifo';
}

@Injectable()
export class CostingService {
  private readonly logger = new Logger(CostingService.name);

  constructor(
    private prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly operatingScopeService: OperatingScopeService,
  ) {}

  /**
   * Traduce el universo de ubicaciones a un predicado SQL EXPLÍCITO.
   *
   * Es el único punto donde se escribe la pertenencia, y se escribe entera:
   * la organización SIEMPRE, y bajo alcance STORE también la tienda MÁS la
   * bodega central (`store_id IS NULL`), que no cuelga de ninguna tienda pero
   * sí alimenta el CPP de todas las de su organización.
   *
   * El aislamiento entre organizaciones sale de AQUÍ, no del cliente que
   * ejecute la consulta: `il.organization_id` no es opcional en ninguna rama.
   */
  private buildLocationMembershipSql(
    filter: ScopedLocationFilter,
  ): Prisma.Sql {
    if (filter.store_id == null) {
      return Prisma.sql`il.organization_id = ${filter.organization_id}`;
    }
    return Prisma.sql`il.organization_id = ${filter.organization_id} AND (il.store_id = ${filter.store_id} OR il.store_id IS NULL)`;
  }

  /**
   * QUI-425 — Universo de stock del CPP: promedio ponderado sobre TODAS las
   * ubicaciones en alcance. Con `tx` y sin `tx` agrega EXACTAMENTE el mismo
   * conjunto; esa igualdad es el contrato de esta función.
   *
   * POR QUÉ ES UNA CONSULTA CRUDA Y NO `client.stock_levels.findMany`
   * ----------------------------------------------------------------
   * `StorePrismaService` SOBRESCRIBE `$transaction` para delegar en el cliente
   * CON alcance (`store-prisma.service.ts` → `override $transaction(...)
   * { return this.scoped_client.$transaction(...) }`), y su tabla de alcances
   * relacionales incluye `stock_levels: { inventory_locations: { store_id } }`.
   * Encima, `mergeScopedWhere` NO reemplaza ante colisión de clave: empuja el
   * filtro de seguridad a un `AND`. Con el patrón anterior
   * (`const client = tx ?? globalPrisma` + `findMany`) los dos caminos leían
   * universos distintos:
   *
   *   · vista previa (SIN `tx`) → cliente sin alcance → valía SOLO el filtro
   *     explícito, que incluye A PROPÓSITO la bodega central de la
   *     organización (`inventory_locations.store_id IS NULL`);
   *   · recepción (CON `tx`)   → cliente con alcance → se le ANDeaba
   *     `store_id = <tienda del contexto>` y esa bodega quedaba FUERA.
   *
   * Medido sobre datos de desarrollo (producto 268, organización 6, tienda 10,
   * comprando 10 unidades a 2.000.000): la vista previa agregaba 119 unidades y
   * cotizaba 1.649.457,36; la recepción agregaba 25 y sellaba 1.728.571,43. Un
   * 4,8 % entre la cifra que el operador aprueba y la que el sistema persiste.
   *
   * `$queryRaw` NO atraviesa las extensiones de Prisma: la extensión de alcance
   * se registra por modelo y por operación (`findMany`, `update`, …), nunca
   * sobre las operaciones crudas. Por eso la consulta cruda es inmune al
   * alcance del cliente que la ejecute, y la pertenencia se escribe explícita
   * en el `WHERE` vía `buildLocationMembershipSql`.
   *
   * QUÉ CLIENTE LA EJECUTA, Y POR QUÉ
   * ---------------------------------
   * · CON `tx` → el propio handle transaccional. No por el alcance (ya no
   *   importa: la consulta es cruda) sino por VISIBILIDAD: `globalPrisma` es
   *   otro `PrismaClient` con otro pool y NO ve lo escrito dentro de la
   *   transacción abierta. Con dos líneas del mismo producto en una recepción,
   *   el CPP por ubicación (que sí lee por `tx`) daba 150 y este agregado 200:
   *   `products.cost_price` quedaba en 200 y de ahí salía el precio publicado.
   * · SIN `tx` → `globalPrisma.withoutScope()`, el `PrismaClient` desnudo.
   *   `BasePrismaService` sólo expone `$queryRawUnsafe`, no `$queryRaw`, así
   *   que hay que bajar al cliente base para usar plantillas parametrizadas.
   *
   * QUÉ QUEDA FUERA DEL UNIVERSO (D.2)
   * ----------------------------------
   * El stock de un producto `state='archived'`. Ver
   * {@link ARCHIVED_PRODUCT_STATE}. Las variantes se filtran por el estado de
   * su producto PADRE: `product_variants` no tiene columna `state`, y el `JOIN
   * products p ON p.id = sl.product_id` ya cuelga toda fila de stock —base o de
   * variante— del producto que la posee.
   *
   * Devuelve la cantidad en alcance y su costo unitario promedio ponderado.
   */
  async getScopedStockAggregate(
    params: { product_id: number; variant_id?: number; location_id: number },
    tx?: any,
  ): Promise<{ quantity: number; cost_per_unit: number }> {
    const organizationId = this.getOrganizationId();
    const locationFilter = await this.buildScopedLocationFilter(
      organizationId,
      params.location_id,
      tx,
    );
    const membership = this.buildLocationMembershipSql(locationFilter);
    const variantPredicate = params.variant_id
      ? Prisma.sql`sl.product_variant_id = ${params.variant_id}`
      : Prisma.sql`sl.product_variant_id IS NULL`;

    // `tx` es `any` (el handle transaccional viaja sin tipar por todo el
    // dominio), así que el argumento de tipo se aplica al resultado, no a la
    // llamada: TS prohíbe pasar type arguments a una invocación `any`.
    const client = tx ?? this.globalPrisma.withoutScope();
    const rows: ScopedStockRow[] = await client.$queryRaw(Prisma.sql`
      SELECT sl.quantity_on_hand AS quantity_on_hand,
             sl.cost_per_unit    AS cost_per_unit,
             pv.cost_price       AS variant_cost_price,
             p.cost_price        AS product_cost_price
        FROM stock_levels sl
        JOIN inventory_locations il ON il.id = sl.location_id
        LEFT JOIN products p ON p.id = sl.product_id
        LEFT JOIN product_variants pv ON pv.id = sl.product_variant_id
       WHERE sl.product_id = ${params.product_id}
         AND (${variantPredicate})
         AND sl.quantity_on_hand > 0
         AND (${ACTIVE_PRODUCT_STATE_SQL})
         AND (${membership})
    `);
    const quantity = (rows as any[]).reduce(
      (sum: number, sl: any) => sum + Number(sl.quantity_on_hand ?? 0),
      0,
    );
    const value = (rows as any[]).reduce((sum: number, sl: any) => {
      // Fix colapso CPP: `stock_levels.cost_per_unit` nace NULL en todo camino
      // de escritura que no sea recepción de compra (crear/editar producto,
      // variantes, importación, ajustes, seeds). Sin fallback, ese stock aporta
      // valor 0 al agregado y una compra más cara arrastra el CPP hacia abajo.
      // Cadena canónica (misma que `initializeCostLayers`): cost_per_unit del
      // stock → cost_price de la variante → cost_price del producto → 0. Usa
      // `||` (no `??`) A PROPÓSITO para que un 0 espurio caiga al siguiente
      // eslabón.
      const effectiveCost =
        Number(sl.cost_per_unit) ||
        Number(sl.variant_cost_price) ||
        Number(sl.product_cost_price) ||
        0;
      return sum + Number(sl.quantity_on_hand ?? 0) * effectiveCost;
    }, 0);
    return { quantity, cost_per_unit: quantity > 0 ? value / quantity : 0 };
  }

  /**
   * Resuelve el universo de ubicaciones del agregado de costo según el alcance
   * operativo de la organización:
   *
   * - STORE, ubicación receptora atada a una tienda → esa tienda MÁS la bodega
   *   central de la organización (`store_id IS NULL`). La bodega central entra
   *   A PROPÓSITO: es inventario de la organización que surte a sus tiendas, y
   *   dejarla fuera hacía que el CPP de la tienda ignorara el costo del grueso
   *   de las existencias.
   * - STORE, ubicación receptora SIN tienda (la propia bodega central) → toda
   *   la organización. No hay tienda desde la cual estrechar.
   * - ORGANIZATION → toda la organización.
   *
   * Valida que la ubicación pertenezca a la organización dada: cruzar
   * organizaciones lanza `INV_LOCATION_NOT_IN_ORG` antes de tocar stock.
   *
   * Lo consume `getScopedStockAggregate` (recepción y vista previa por igual)
   * a través de `buildLocationMembershipSql`. El resultado NO es un `where` de
   * Prisma — ver {@link ScopedLocationFilter}.
   */
  async buildScopedLocationFilter(
    organizationId: number,
    locationId: number,
    tx?: any,
  ): Promise<ScopedLocationFilter> {
    const prisma = tx || this.prisma;

    const location = await prisma.inventory_locations.findUnique({
      where: { id: locationId },
      select: { organization_id: true, store_id: true },
    });

    if (!location || location.organization_id !== organizationId) {
      // Tipado: un `Error` crudo sale como 500 y el cliente no puede
      // distinguirlo de una caída real. Es un 403 de aislamiento de tenant.
      throw new VendixHttpException(
        ErrorCodes.INV_LOCATION_NOT_IN_ORG,
        `Location ${locationId} does not belong to organization ${organizationId}`,
      );
    }

    const scope = await this.operatingScopeService.getOperatingScope(
      organizationId,
      tx,
    );

    if (scope === 'STORE') {
      if (location.store_id == null) {
        // `debug`, no `warn`: recibir en la bodega central de la organización
        // es el comportamiento DISEÑADO, no una anomalía. Se emitía una vez por
        // ítem en cada vista previa de costo, así que como `warn` era ~el 90 %
        // del volumen del log y tapaba los avisos que sí exigen mirar.
        this.logger.debug(
          `Location ${locationId} has scope STORE but store_id is null; ` +
            `falling back to ORGANIZATION-level cost aggregate.`,
        );
        return { organization_id: organizationId };
      }
      return { organization_id: organizationId, store_id: location.store_id };
    }

    return { organization_id: organizationId };
  }

  /**
   * Calculate new cost on inventory receipt and create cost layer.
   * Called when receiving a purchase order.
   *
   * MUST be called BEFORE the stock increment for this receipt — all
   * stock_levels reads are pre-receipt to avoid double-counting the incoming
   * quantity in the weighted average.
   */
  async calculateCostOnReceipt(
    params: CalculateCostParams,
    tx?: any,
  ): Promise<CostCalculationResult> {
    const prisma = tx || this.prisma;
    const organizationId = this.getOrganizationId();

    // Get current stock level for existing cost/quantity. Carga las relaciones
    // products/product_variants para el fallback de costo (mismo join, sin
    // query extra).
    const stockLevel = await prisma.stock_levels.findFirst({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
      },
      include: {
        products: { select: { cost_price: true } },
        product_variants: { select: { cost_price: true } },
      },
    });

    const existingQty = stockLevel?.quantity_on_hand ?? 0;
    // Fix colapso CPP: si la fila del stock nació con cost_per_unit NULL/0,
    // la CPP de la ubicación receptora colapsaría al recibir más. Fallback
    // canónico (`||`, no `??`): cost_per_unit → variante → producto → 0.
    const existingCost =
      Number(stockLevel?.cost_per_unit) ||
      Number(stockLevel?.product_variants?.cost_price) ||
      Number(stockLevel?.products?.cost_price) ||
      0;

    // Agregado de stock en alcance (multi-tenant seguro): misma tienda más la
    // bodega central bajo alcance STORE, o toda la organización bajo alcance
    // ORGANIZATION — nunca a través de organizaciones. Lee por consulta cruda
    // para que el conjunto agregado sea IDÉNTICO aquí (dentro de `tx`, con
    // cliente scopeado) y en la vista previa (sin `tx`, cliente sin alcance):
    // ver getScopedStockAggregate.
    const { quantity: scopedQty, cost_per_unit: scopedCost } =
      await this.getScopedStockAggregate(
        {
          product_id: params.product_id,
          variant_id: params.variant_id,
          location_id: params.location_id,
        },
        tx,
      );

    let newCostPerUnit: number;

    switch (params.costing_method) {
      case 'weighted_average':
        newCostPerUnit = this.calculateWeightedAverage(
          existingQty,
          existingCost,
          params.quantity_received,
          params.unit_cost,
        );
        break;

      case 'fifo':
      case 'lifo':
        // For FIFO/LIFO, the cost_per_unit on stock_levels represents the
        // latest receipt cost. The actual COGS is determined at consumption time.
        newCostPerUnit = params.unit_cost;
        break;

      default:
        newCostPerUnit = params.unit_cost;
    }

    // Calculate scoped cost per unit for product-level cost_price (within the
    // same store/organization, never cross-tenant).
    let scopedCostPerUnit: number;
    if (params.costing_method === 'weighted_average') {
      scopedCostPerUnit = this.calculateWeightedAverage(
        scopedQty,
        scopedCost,
        params.quantity_received,
        params.unit_cost,
      );
    } else {
      scopedCostPerUnit = params.unit_cost;
    }

    // Always create a cost layer (useful for FIFO/LIFO, and for audit in weighted avg)
    await prisma.inventory_cost_layers.create({
      data: {
        organization_id: organizationId,
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
        purchase_order_id: params.purchase_order_id || null,
        quantity_remaining: params.quantity_received,
        unit_cost: new Prisma.Decimal(params.unit_cost),
        received_at: new Date(),
        batch_number: params.batch_number || null,
        manufacturing_date: params.manufacturing_date || null,
        expiration_date: params.expiration_date || null,
      },
    });

    // Update cost_per_unit on stock_levels
    if (stockLevel) {
      await prisma.stock_levels.update({
        where: { id: stockLevel.id },
        data: {
          cost_per_unit: new Prisma.Decimal(newCostPerUnit),
          updated_at: new Date(),
        },
      });
    }

    // Update product or variant cost_price (scoped weighted average across
    // same-store / same-organization locations, per operating_scope)
    if (params.variant_id) {
      await prisma.product_variants.update({
        where: { id: params.variant_id },
        data: { cost_price: new Prisma.Decimal(scopedCostPerUnit) },
      });
    } else {
      await prisma.products.update({
        where: { id: params.product_id },
        data: { cost_price: new Prisma.Decimal(scopedCostPerUnit) },
      });
    }

    return {
      new_cost_per_unit: newCostPerUnit,
      new_scoped_cost_per_unit: scopedCostPerUnit,
      previous_cost_per_unit: existingCost,
    };
  }

  /**
   * Consume cost layers when selling/removing stock.
   * Returns the total COGS (Cost of Goods Sold) for the consumed quantity.
   *
   * D.2 — AQUÍ NO SE FILTRA POR `state`, y es una decisión, no un olvido.
   * El producto viene fijado por el llamador (`params.product_id`), así que el
   * filtro no podría cambiar QUÉ capas se consumen: sólo podría negarse a
   * costearlas y devolver 0. El primer llamador que consume stock de un
   * producto archivado es el castigo de inventario de D.4, y ese 0 sería
   * justamente el COGS del asiento de faltantes. El universo activo se impone
   * en los agregados que barren varias filas —`getScopedStockAggregate` e
   * `initializeCostLayers`—, que es donde el archivado contamina.
   */
  async consumeCostLayers(
    params: ConsumeCostParams,
    tx?: any,
  ): Promise<number> {
    const prisma = tx || this.prisma;

    if (params.costing_method === 'weighted_average') {
      // For weighted average, COGS is quantity * current cost_per_unit (the
      // average). We ALSO decrement cost layers (received_at ASC) so that the
      // layers stay in sync with stock_levels; otherwise the layers would sum
      // to more than the real stock and break a future FIFO switch or the
      // historical valuation. The COGS amount is unaffected by which layers we
      // touch: we always cost consumed units at the average cost_per_unit.
      const stockLevel = await prisma.stock_levels.findFirst({
        where: {
          product_id: params.product_id,
          product_variant_id: params.variant_id || null,
          location_id: params.location_id,
        },
        include: {
          products: { select: { cost_price: true } },
          product_variants: { select: { cost_price: true } },
        },
      });
      // Fix colapso CPP: este costo alimenta el COGS de venta bajo CPP. Si el
      // cost_per_unit del stock quedó NULL/0, el COGS sería 0. Fallback
      // canónico (`||`, no `??`): cost_per_unit → variante → producto → 0.
      const costPerUnit =
        Number(stockLevel?.cost_per_unit) ||
        Number(stockLevel?.product_variants?.cost_price) ||
        Number(stockLevel?.products?.cost_price) ||
        0;

      const cppLayers = await prisma.inventory_cost_layers.findMany({
        where: {
          product_id: params.product_id,
          product_variant_id: params.variant_id || null,
          location_id: params.location_id,
          quantity_remaining: { gt: 0 },
        },
        orderBy: { received_at: 'asc' },
      });

      let remainingToConsume = params.quantity;
      let totalCogs = 0;

      for (const layer of cppLayers) {
        if (remainingToConsume <= 0) break;

        const consumeFromLayer = Math.min(
          remainingToConsume,
          layer.quantity_remaining,
        );

        // Average costing: cost consumed units at the average cost_per_unit,
        // NOT at the individual layer.unit_cost.
        totalCogs += consumeFromLayer * costPerUnit;
        remainingToConsume -= consumeFromLayer;

        await prisma.inventory_cost_layers.update({
          where: { id: layer.id },
          data: {
            quantity_remaining: layer.quantity_remaining - consumeFromLayer,
          },
        });
      }

      if (remainingToConsume > 0) {
        this.logger.warn(
          `Insufficient cost layers for product ${params.product_id}. ` +
            `${remainingToConsume} units consumed without layer data.`,
        );
        // Preserve legacy CPP behavior: COGS must remain exactly
        // quantity * cost_per_unit even when layers are insufficient, so we
        // still charge the missing units at the average cost.
        totalCogs += remainingToConsume * costPerUnit;
      }

      return totalCogs;
    }

    // FIFO or LIFO: consume layers in order
    const orderDirection = params.costing_method === 'fifo' ? 'asc' : 'desc';

    const layers = await prisma.inventory_cost_layers.findMany({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
        quantity_remaining: { gt: 0 },
      },
      orderBy: { received_at: orderDirection },
    });

    let remainingToConsume = params.quantity;
    let totalCogs = 0;

    for (const layer of layers) {
      if (remainingToConsume <= 0) break;

      const consumeFromLayer = Math.min(
        remainingToConsume,
        layer.quantity_remaining,
      );

      totalCogs += consumeFromLayer * Number(layer.unit_cost);
      remainingToConsume -= consumeFromLayer;

      await prisma.inventory_cost_layers.update({
        where: { id: layer.id },
        data: {
          quantity_remaining: layer.quantity_remaining - consumeFromLayer,
        },
      });
    }

    if (remainingToConsume > 0) {
      // Mismo fallback canónico que la rama CPP de arriba, y por la misma razón.
      // Sin él, las unidades sin capa costaban CERO y la venta salía con margen
      // 100 %: un `logger.warn` en el servidor y una cifra sana en pantalla.
      //
      // El caso no es hipotético ni raro: el método de costeo es CONFIGURABLE
      // (ORG → STORE, default CPP). Una tienda que venía operando en CPP no
      // necesariamente tiene capas que respalden todo su saldo —CPP tolera que
      // falten porque cuesta al promedio—, así que el día que alguien mueve el
      // ajuste a FIFO el inventario existente queda sin respaldo y el COGS se
      // desploma a 0 sin que nada falle. Cobrar las unidades faltantes al costo
      // canónico deja FIFO exacto donde hay capas y aproximado —no nulo— donde
      // no las hay.
      const fallbackStockLevel = await prisma.stock_levels.findFirst({
        where: {
          product_id: params.product_id,
          product_variant_id: params.variant_id || null,
          location_id: params.location_id,
        },
        include: {
          products: { select: { cost_price: true } },
          product_variants: { select: { cost_price: true } },
        },
      });
      const fallbackCostPerUnit =
        Number(fallbackStockLevel?.cost_per_unit) ||
        Number(fallbackStockLevel?.product_variants?.cost_price) ||
        Number(fallbackStockLevel?.products?.cost_price) ||
        0;

      this.logger.warn(
        `Insufficient cost layers for product ${params.product_id}. ` +
          `${remainingToConsume} units consumed without layer data; ` +
          `costed at fallback unit cost ${fallbackCostPerUnit}.`,
      );

      totalCogs += remainingToConsume * fallbackCostPerUnit;
    }

    return totalCogs;
  }

  /**
   * Initialize cost layers for existing stock (migration utility).
   */
  async initializeCostLayers(organizationId: number, tx?: any): Promise<void> {
    const prisma = tx || this.prisma;

    const stockLevels = await prisma.stock_levels.findMany({
      where: {
        quantity_on_hand: { gt: 0 },
        // D.2 — mismo universo que `getScopedStockAggregate`: sembrar capas de
        // costo para un producto archivado reintroduciría por la puerta de
        // atrás las existencias que el agregado acaba de dejar fuera, y un
        // futuro cambio a FIFO las costearía como si estuvieran vivas.
        ...ACTIVE_PRODUCT_RELATION_FILTER,
      },
      include: {
        products: {
          select: { cost_price: true },
        },
        product_variants: {
          select: { cost_price: true },
        },
        inventory_locations: {
          select: { organization_id: true },
        },
      },
    });

    for (const sl of stockLevels) {
      const orgId = sl.inventory_locations?.organization_id;
      if (orgId !== organizationId) continue;

      // Skip if layer already exists
      const existingLayer = await prisma.inventory_cost_layers.findFirst({
        where: {
          product_id: sl.product_id,
          product_variant_id: sl.product_variant_id,
          location_id: sl.location_id,
        },
      });

      if (existingLayer) continue;

      const costPerUnit =
        Number(sl.cost_per_unit) ||
        Number(sl.product_variants?.cost_price) ||
        Number(sl.products?.cost_price) ||
        0;

      await prisma.inventory_cost_layers.create({
        data: {
          organization_id: organizationId,
          product_id: sl.product_id,
          product_variant_id: sl.product_variant_id,
          location_id: sl.location_id,
          quantity_remaining: sl.quantity_on_hand,
          unit_cost: new Prisma.Decimal(costPerUnit),
          received_at: sl.created_at || new Date(),
        },
      });
    }

    this.logger.log(
      `Initialized cost layers for organization ${organizationId}`,
    );
  }

  /**
   * Weighted average formula:
   * new_cost = ((existing_qty * existing_cost) + (received_qty * received_cost)) / (existing_qty + received_qty)
   */
  private calculateWeightedAverage(
    existingQty: number,
    existingCost: number,
    receivedQty: number,
    receivedCost: number,
  ): number {
    const totalQty = existingQty + receivedQty;
    if (totalQty <= 0) return receivedCost;

    const totalValue = existingQty * existingCost + receivedQty * receivedCost;
    return totalValue / totalQty;
  }

  private getOrganizationId(): number {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(
        ErrorCodes.INV_CONTEXT_001,
        'Organization context required for costing operations',
      );
    }
    return context.organization_id;
  }
}

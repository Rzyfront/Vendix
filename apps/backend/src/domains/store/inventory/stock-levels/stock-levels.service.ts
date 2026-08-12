import { Injectable, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
import { SourcingSuggestionQueryDto } from './dto/sourcing-suggestion-query.dto';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import {
  resolvePosStockScope,
  resolveLowStockAlertsScope,
  ResolvedInventoryScope,
} from '../shared/helpers/pos-stock-scope.helper';
import { resolveStockLevelLowStockThreshold } from '../shared/helpers/low-stock-threshold.helper';
import { syncDenormalizedProductStock } from '../shared/helpers/sync-product-stock.helper';
import { deriveUoMSplit, UoMSplit } from '../shared/helpers/uom-display.helper';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';
import type { StoreSettings } from '../../settings/interfaces/store-settings.interface';

type SourcingLocation = {
  id: number;
  name: string;
  quantity_available: number;
};

type SourcingSuggestionResult = {
  main_location: SourcingLocation | null;
  other_locations: SourcingLocation[];
  suggestion: 'available' | 'transfer' | 'purchase';
  requested_quantity: number;
};

@Injectable()
export class StockLevelsService {
  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
  ) {}

  /**
   * Deriva del ESPEJO denormalizado: compara `products.stock_quantity` y
   * `product_variants.stock_quantity` contra la suma real de `stock_levels`.
   *
   * Por qué existe: tres servicios distintos escriben `stock_levels`, y sólo
   * `StockLevelManager` refresca el espejo. Cuando otro camino lo deja rancio,
   * NADA falla — el catálogo público, las analíticas, el MCP, la wishlist y el
   * validador de stock leen esa columna y muestran el saldo anterior. Esta
   * lectura convierte esa clase entera de bug en un número consultable en vez
   * de esperar a que un cliente reclame.
   *
   * ── Alcance ──────────────────────────────────────────────────────────────
   * `stock_quantity` es GLOBAL: describe el producto, no la porción que ve
   * quien pregunta (ver `sync-product-stock.helper.ts`). Comparar un espejo
   * global contra una suma acotada al tenant reportaría deriva falsa en cada
   * producto con existencias en una bodega de organización.
   *
   * Por eso: el CONJUNTO de productos sale del cliente acotado —sólo los de
   * esta tienda— y las SUMAS salen de SQL crudo sin scoping. La consulta cruda
   * no filtra entre inquilinos porque el conjunto de ids ya viene filtrado.
   */
  async getMirrorDrift(limit = 100) {
    const products = await this.prisma.products.findMany({
      select: { id: true, name: true, sku: true, stock_quantity: true },
    });

    if (products.length === 0) {
      // `drifted_total` va explícito: sin él este retorno tenía una FORMA
      // distinta a la del camino normal, y quien consuma el campo lo recibe
      // `undefined` sólo en el caso borde de catálogo vacío.
      return {
        checked_products: 0,
        checked_variants: 0,
        drifted: [] as Array<{
          entity: 'product' | 'variant';
          id: number;
          product_id: number;
          label: string;
          mirror: number;
          real: number;
          diff: number;
        }>,
        drifted_total: 0,
        is_consistent: true,
      };
    }

    const productIds = products.map((p) => p.id);

    // Suma real, global, sin pasar por la extensión de scoping. Misma consulta
    // que usa el helper de sincronización, para que ambos lados hablen del
    // mismo número: si difieren, la deriva es real y no un artefacto de alcance.
    const rows: Array<{
      product_id: number;
      product_variant_id: number | null;
      total: bigint | number | null;
      // withoutScope(): `$queryRaw` no existe en el cliente acotado, y además
      // la suma DEBE ser global (ver el bloque de alcance arriba).
    }> = await (this.prisma.withoutScope() as any).$queryRaw`
      SELECT product_id, product_variant_id,
             COALESCE(SUM(quantity_available), 0)::bigint AS total
      FROM stock_levels
      WHERE product_id = ANY(${productIds}::int[])
      GROUP BY product_id, product_variant_id
    `;

    const productTotals = new Map<number, number>();
    const variantTotals = new Map<number, number>();
    const productsWithVariantRows = new Set<number>();

    for (const row of rows) {
      const total = Number(row.total ?? 0);
      const pid = Number(row.product_id);
      if (row.product_variant_id === null) {
        productTotals.set(pid, (productTotals.get(pid) ?? 0) + total);
      } else {
        variantTotals.set(Number(row.product_variant_id), total);
        productsWithVariantRows.add(pid);
        productTotals.set(pid, (productTotals.get(pid) ?? 0) + total);
      }
    }

    const variants = await this.prisma.product_variants.findMany({
      where: { product_id: { in: productIds } },
      select: {
        id: true,
        product_id: true,
        sku: true,
        stock_quantity: true,
      },
    });

    // Un producto CON variantes suma sólo las filas con variante: su fila base,
    // si existe, es stock fantasma. Misma regla que el helper — replicarla mal
    // aquí produciría deriva inventada en todo producto variantizado.
    const variantOwners = new Set(variants.map((v) => v.product_id));

    const drifted: Array<{
      entity: 'product' | 'variant';
      id: number;
      product_id: number;
      label: string;
      mirror: number;
      real: number;
      diff: number;
    }> = [];

    for (const product of products) {
      const hasVariants = variantOwners.has(product.id);
      const real = hasVariants
        ? rows
            .filter(
              (r) =>
                Number(r.product_id) === product.id &&
                r.product_variant_id !== null,
            )
            .reduce((sum, r) => sum + Number(r.total ?? 0), 0)
        : (productTotals.get(product.id) ?? 0);
      const mirror = product.stock_quantity ?? 0;
      if (mirror !== real) {
        drifted.push({
          entity: 'product',
          id: product.id,
          product_id: product.id,
          label: product.name ?? product.sku ?? `#${product.id}`,
          mirror,
          real,
          diff: mirror - real,
        });
      }
    }

    for (const variant of variants) {
      const real = variantTotals.get(variant.id) ?? 0;
      const mirror = variant.stock_quantity ?? 0;
      if (mirror !== real) {
        drifted.push({
          entity: 'variant',
          id: variant.id,
          product_id: variant.product_id,
          label: variant.sku ?? `#${variant.id}`,
          mirror,
          real,
          diff: mirror - real,
        });
      }
    }

    // Mayor descuadre primero: el orden de la tabla es el orden de atención.
    drifted.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    return {
      checked_products: products.length,
      checked_variants: variants.length,
      drifted: drifted.slice(0, limit),
      drifted_total: drifted.length,
      is_consistent: drifted.length === 0,
    };
  }

  /**
   * Repara la deriva que reporta `getMirrorDrift`, recalculando el espejo desde
   * `stock_levels` con el MISMO helper que usa el motor de stock.
   *
   * Es seguro por construcción: `products.stock_quantity` es un derivado —una
   * caché denormalizada— y la verdad vive en `stock_levels`. Recalcularlo no
   * inventa ni borra existencias, sólo vuelve a copiar la suma; y es
   * idempotente, así que correrlo dos veces da el mismo resultado. Por eso NO
   * requiere migración: no cambia el dato de negocio, restituye una copia.
   *
   * Sin esto el detector deja al usuario con una lista y ninguna salida: puede
   * ver que el catálogo muestra 10 donde hay 167, y no hacer nada al respecto.
   *
   * Reconciliar SÓLO lo que derivó (y no todo el catálogo) mantiene la escritura
   * proporcional al problema: en una base con miles de productos sanos, tocar
   * todas las filas para arreglar 62 dispara `updated_at` en masa e invalida
   * cachés que estaban bien.
   *
   * ── Alcance: no barre otros inquilinos ────────────────────────────────────
   * El conjunto a reparar lo define `getMirrorDrift`, cuyo listado de productos
   * sale del cliente ACOTADO. Por eso una tienda con deriva propia queda en
   * cero mientras otras tiendas siguen derivadas, y eso es lo correcto: el
   * espejo se escribe con el cliente global (la suma debe ser global) pero
   * QUIÉN se repara lo decide el alcance de la sesión. Convertir esto en una
   * barrida de todo el catálogo sería una escritura cruzada entre inquilinos
   * disparada por la sesión de uno solo.
   */
  async reconcileMirrorDrift(limit = 500) {
    const report = await this.getMirrorDrift(limit);

    // Un producto se sincroniza completo (el helper resuelve sus variantes), así
    // que basta el conjunto de productos implicados: pasar también cada variante
    // repetiría el mismo trabajo una vez por variante.
    const productIds = Array.from(
      new Set(report.drifted.map((d) => d.product_id)),
    );

    const global = this.prisma.withoutScope();
    const repaired: number[] = [];
    const failed: Array<{ product_id: number; error: string }> = [];

    for (const product_id of productIds) {
      try {
        await syncDenormalizedProductStock(global, product_id);
        repaired.push(product_id);
      } catch (error) {
        // Un producto que falle no puede abortar la reparación de los demás: el
        // objetivo es reducir la deriva, no que sea todo o nada.
        failed.push({
          product_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Se vuelve a medir en vez de asumir: el número que se reporta es el estado
    // real después de escribir, no la resta optimista de lo que se intentó.
    const after = await this.getMirrorDrift(limit);

    return {
      drifted_before: report.drifted_total,
      drifted_after: after.drifted_total,
      repaired_products: repaired.length,
      failed,
      is_consistent: after.is_consistent,
      remaining: after.drifted,
      // El detector recorta a `limit`, así que una base con más deriva que el
      // lote se repara por tandas. Decirlo explícitamente evita el peor
      // resultado: un reporte que parece completo y deja descuadres fuera.
      batch_limit: limit,
      batch_truncated: report.drifted_total > limit,
    };
  }

  async findAll(query: StockLevelQueryDto) {
    const locationFilter = await this.resolveScopedLocationFilter(
      query.location_id,
      'pos',
    );
    const rows = await this.prisma.stock_levels.findMany({
      where: {
        product_id: query.product_id,
        ...locationFilter,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
    return rows.map((row) => this.decorateUoM(row));
  }

  async findByProduct(productId: number, query: StockLevelQueryDto) {
    const locationFilter = await this.resolveScopedLocationFilter(
      query.location_id,
      'pos',
    );
    const rows = await this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        ...locationFilter,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
    return rows.map((row) => this.decorateUoM(row));
  }

  /**
   * Decorates a stock_levels row with the UoM "sealed/open" split when the
   * related product is an ingredient with a purchase→stock factor. The
   * total in minimum stock units is left untouched — see
   * uom-display.helper.ts for the rationale.
   */
  private decorateUoM<T extends { quantity_on_hand?: number | null; products?: any }>(
    row: T,
  ): T & UoMSplit {
    const split = deriveUoMSplit(row);
    return { ...row, ...split };
  }

  async findByLocation(locationId: number, query: StockLevelQueryDto) {
    // Validate location access implicitly by the query scope?
    // If locationId is not in store, findMany returns empty. Correct.
    const rows = await this.prisma.stock_levels.findMany({
      where: {
        location_id: locationId,
        product_id: query.product_id,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
    return rows.map((row) => this.decorateUoM(row));
  }

  async getStockAlerts(query: StockLevelQueryDto) {
    const [locationFilter, settings] = await Promise.all([
      this.resolveScopedLocationFilter(query.location_id, 'low_stock_alerts'),
      this.loadMergedSettings(),
    ]);

    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: query.product_id,
        ...locationFilter,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });

    return stockLevels.filter((stockLevel) => {
      const threshold = resolveStockLevelLowStockThreshold(
        settings,
        stockLevel,
      );
      return Number(stockLevel.quantity_available ?? 0) <= threshold;
    });
  }

  async findOne(id: number) {
    // Changed to findFirst to allow scoping injections
    const stockLevel = await this.prisma.stock_levels.findFirst({
      where: { id },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });

    // Devolver null dejaba la respuesta en 200 con `data: null`: el frontend no
    // distinguía "no existe" de "existe y está vacío", y en otro tenant el
    // scoping hace que sea justamente lo primero.
    if (!stockLevel) {
      throw new VendixHttpException(ErrorCodes.INV_FIND_001);
    }

    return stockLevel;
  }

  /**
   * Updates stock level using StockLevelManager to ensure synchronization
   * with products.stock_quantity and product_variants.stock_quantity
   */
  async updateStockLevel(
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    // Validate location membership in store
    const location = await this.prisma.inventory_locations.findFirst({
      where: { id: locationId },
    });
    if (!location) {
      throw new ForbiddenException('Location not found in this store context');
    }

    // Delegate to StockLevelManager to ensure proper sync
    const result = await this.stockLevelManager.updateStock({
      product_id: productId,
      variant_id: productVariantId,
      location_id: locationId,
      quantity_change: quantityChange,
      movement_type: 'adjustment',
      reason: 'Direct stock level update',
      create_movement: false,
    });

    return result.stock_level;
  }

  /**
   * Computes a sourcing recommendation for a given product/variant and
   * requested quantity. Splits availability between the store's main location
   * (per inventory scope) and any other locations holding stock so the UI can
   * suggest selling from main, transferring stock in, or purchasing more.
   */
  async getSourcingSuggestion(
    query: SourcingSuggestionQueryDto,
  ): Promise<SourcingSuggestionResult> {
    const requestedQuantity = query.quantity;

    const scope = await this.resolveScope('pos');

    // Pull all stock rows for the product (and variant if provided) in the
    // current store. StorePrismaService scopes `stock_levels` via the
    // inventory_locations relation, so no extra tenant guard is needed.
    const stockRows = await this.prisma.stock_levels.findMany({
      where: {
        product_id: query.product_id,
        product_variant_id: query.product_variant_id ?? null,
      },
      select: {
        location_id: true,
        quantity_available: true,
        inventory_locations: {
          select: { id: true, name: true },
        },
      },
    });

    const mapped: SourcingLocation[] = stockRows.map((row) => ({
      id: row.location_id,
      name: row.inventory_locations?.name ?? `Location ${row.location_id}`,
      quantity_available: row.quantity_available ?? 0,
    }));

    let mainLocation: SourcingLocation | null = null;
    let otherLocations: SourcingLocation[] = [];

    if (scope.scope === 'main_location') {
      const mainId = scope.mainLocationId;
      mainLocation = mapped.find((l) => l.id === mainId) ?? null;
      otherLocations = mapped.filter(
        (l) => l.id !== mainId && l.quantity_available > 0,
      );
    } else {
      // all_locations: surface the store's default location (if any) as
      // "main" purely for UI convenience; everything else is "other".
      const defaultId = await this.getStoreDefaultLocationId();
      if (defaultId != null) {
        mainLocation = mapped.find((l) => l.id === defaultId) ?? null;
        otherLocations = mapped.filter(
          (l) => l.id !== defaultId && l.quantity_available > 0,
        );
      } else {
        mainLocation = null;
        otherLocations = mapped.filter((l) => l.quantity_available > 0);
      }
    }

    const mainAvailable = mainLocation?.quantity_available ?? 0;
    const otherTotal = otherLocations.reduce(
      (sum, l) => sum + l.quantity_available,
      0,
    );

    let suggestion: 'available' | 'transfer' | 'purchase';
    if (mainAvailable >= requestedQuantity) {
      suggestion = 'available';
    } else {
      const remaining = requestedQuantity - mainAvailable;
      suggestion = otherTotal >= remaining ? 'transfer' : 'purchase';
    }

    return {
      main_location: mainLocation,
      other_locations: otherLocations,
      suggestion,
      requested_quantity: requestedQuantity,
    };
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /**
   * Returns a partial `where` fragment that constrains queries to the main
   * location when the caller did NOT pass an explicit `location_id`.
   *
   * - If `explicitLocationId` is set, it is honored as-is (manual override).
   * - Otherwise, the configured inventory scope is consulted:
   *     - `main_location` → filter by the resolved main location id
   *     - `all_locations` → no filter (caller sees all locations)
   *
   * Returns `{}` (no constraint) for the `all_locations` case.
   */
  private async resolveScopedLocationFilter(
    explicitLocationId: number | undefined,
    kind: 'pos' | 'low_stock_alerts',
  ): Promise<{ location_id?: number }> {
    if (explicitLocationId != null) {
      return { location_id: explicitLocationId };
    }

    const scope = await this.resolveScope(kind);
    if (scope.scope === 'main_location') {
      return { location_id: scope.mainLocationId };
    }
    return {};
  }

  /**
   * Resolves the configured inventory scope for the current store, choosing
   * between the POS and low-stock-alerts settings keys.
   */
  private async resolveScope(
    kind: 'pos' | 'low_stock_alerts',
  ): Promise<ResolvedInventoryScope> {
    const [store, settings] = await Promise.all([
      this.loadStoreScopeRef(),
      this.loadMergedSettings(),
    ]);

    return kind === 'pos'
      ? resolvePosStockScope(store, settings)
      : resolveLowStockAlertsScope(store, settings);
  }

  /**
   * Loads the minimal store row needed to resolve the inventory scope.
   *
   * StorePrismaService exposes `stores` via the unscoped baseClient (the
   * tenant scope is applied at the relation level on other models), so we
   * filter explicitly by the current store_id taken from RequestContext.
   */
  private async loadStoreScopeRef(): Promise<{
    default_location_id: number | null;
  }> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      return { default_location_id: null };
    }
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { default_location_id: true },
    });
    return { default_location_id: store?.default_location_id ?? null };
  }

  /**
   * Returns the raw default_location_id (or null) without the scope wrapper.
   */
  private async getStoreDefaultLocationId(): Promise<number | null> {
    const ref = await this.loadStoreScopeRef();
    return ref.default_location_id;
  }

  /**
   * Reads the persisted `store_settings.settings` JSON for the current store
   * and merges it with defaults. We deliberately avoid SettingsService.getSettings()
   * here because that method also signs S3 URLs and shapes the response for
   * the frontend — we only need the merged config.
   */
  private async loadMergedSettings(): Promise<StoreSettings> {
    const row = await this.prisma.store_settings.findFirst({
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings);
  }
}

import { Injectable, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
import { SourcingSuggestionQueryDto } from './dto/sourcing-suggestion-query.dto';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import {
  resolvePosStockScope,
  resolveLowStockAlertsScope,
  ResolvedInventoryScope,
} from '../shared/helpers/pos-stock-scope.helper';
import { resolveStockLevelLowStockThreshold } from '../shared/helpers/low-stock-threshold.helper';
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

  findOne(id: number) {
    // Changed to findFirst to allow scoping injections
    return this.prisma.stock_levels.findFirst({
      where: { id },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
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

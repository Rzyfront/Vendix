import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from './stock-level-manager.service';

export interface StockValidationParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity: number;
}

export interface CartItem {
  product_id: number;
  variant_id?: number;
  quantity: number;
}

export interface CartValidationResult {
  isValid: boolean;
  insufficientItems: Array<{
    product_id: number;
    variant_id?: number;
    requested: number;
    available: number;
  }>;
  errors: string[];
}

export interface AvailabilityResult {
  isAvailable: boolean;
  product_id: number;
  variant_id?: number;
  requested: number;
  available: number;
  location_id?: number;
}

/**
 * StockValidatorService
 *
 * Provides read-only stock validation using StockLevelManager.
 * Source of truth: stock_levels.quantity_available (NOT denormalized stock_quantity)
 *
 * Key rules:
 * - Uses StockLevelManager for all stock queries (no direct prisma access to stock_levels)
 * - Validates effective tracking before checking stock
 * - Returns detailed validation results for cart operations
 */
@Injectable()
export class StockValidatorService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly stockLevelManager: StockLevelManager,
  ) {}

  /**
   * Resolves effective inventory tracking for a product/variant combination.
   *
   * Rule:
   * - If variant.track_inventory_override != null, use that value
   * - Otherwise, fall back to product.track_inventory
   *
   * @returns true if inventory should be tracked, false otherwise
   */
  resolveEffectiveTracking(
    product: { track_inventory: boolean },
    variant?: { track_inventory_override: boolean | null },
  ): boolean {
    // Variant override takes precedence if explicitly set (not null)
    if (variant?.track_inventory_override != null) {
      return variant.track_inventory_override;
    }

    // Fall back to product-level tracking setting
    return product.track_inventory;
  }

  /**
   * Validates stock availability for an entire cart.
   *
   * Uses stock_levels.quantity_available as the source of truth.
   * Does NOT use the denormalized stock_quantity on products/variants.
   *
   * @param cart Array of cart items with product_id, variant_id (optional), and quantity
   * @param allowOversell If true, returns validation result without throwing
   * @param locationId Optional specific location to validate; if not provided, checks across all locations
   * @returns CartValidationResult with validation status and details
   * @throws ConflictException if allowOversell is false and stock is insufficient
   */
  async validateCart(
    cart: CartItem[],
    allowOversell = false,
    locationId?: number,
  ): Promise<CartValidationResult> {
    if (!cart || cart.length === 0) {
      return {
        isValid: true,
        insufficientItems: [],
        errors: [],
      };
    }

    const insufficientItems: CartValidationResult['insufficientItems'] = [];
    const errors: string[] = [];

    for (const item of cart) {
      // Get the effective stock at the specified location or across all locations
      const availability = await this.checkStockAtLocation(
        item.product_id,
        item.variant_id,
        locationId,
      );

      const totalAvailable = availability.reduce(
        (sum, sl) => sum + sl.quantity_available,
        0,
      );

      if (totalAvailable < item.quantity) {
        insufficientItems.push({
          product_id: item.product_id,
          variant_id: item.variant_id,
          requested: item.quantity,
          available: totalAvailable,
        });

        errors.push(
          `Insufficient stock for product ${item.product_id}${item.variant_id ? ` variant ${item.variant_id}` : ''}: requested ${item.quantity}, available ${totalAvailable}`,
        );
      }
    }

    const isValid = insufficientItems.length === 0;

    if (!isValid && !allowOversell) {
      throw new ConflictException({
        message: 'Insufficient stock for one or more items',
        insufficientItems,
      });
    }

    return {
      isValid,
      insufficientItems,
      errors,
    };
  }

  /**
   * Validates availability of a specific product/variant quantity.
   *
   * @param productId Product ID
   * @param variantId Optional variant ID
   * @param quantity Required quantity
   * @param locationId Optional specific location; if not provided, checks across all locations
   * @returns AvailabilityResult indicating if the quantity is available
   */
  async validateAvailability(
    productId: number,
    variantId: number | undefined,
    quantity: number,
    locationId?: number,
  ): Promise<AvailabilityResult> {
    if (quantity <= 0) {
      return {
        isAvailable: true,
        product_id: productId,
        variant_id: variantId,
        requested: quantity,
        available: 0,
        location_id: locationId,
      };
    }

    // Get stock levels using StockLevelManager
    const stockLevels = await this.checkStockAtLocation(
      productId,
      variantId,
      locationId,
    );

    const totalAvailable = stockLevels.reduce(
      (sum, sl) => sum + sl.quantity_available,
      0,
    );

    const isAvailable = totalAvailable >= quantity;

    // Find the primary location for the response (highest available)
    let primaryLocationId: number | undefined;
    if (stockLevels.length > 0) {
      const primary = stockLevels.reduce((prev, current) =>
        prev.quantity_available > current.quantity_available ? prev : current,
      );
      primaryLocationId = primary.location_id;
    }

    return {
      isAvailable,
      product_id: productId,
      variant_id: variantId,
      requested: quantity,
      available: totalAvailable,
      location_id: locationId ?? primaryLocationId,
    };
  }

  /**
   * Check stock levels at a specific location or across all locations.
   * Uses StockLevelManager internally.
   */
  private async checkStockAtLocation(
    productId: number,
    variantId: number | undefined,
    locationId: number | undefined,
  ): Promise<Array<{ location_id: number; quantity_available: number }>> {
    // If locationId is provided, only check that specific location
    if (locationId != null) {
      const stockLevel = await this.getStockLevelAtLocation(
        productId,
        variantId,
        locationId,
      );
      return stockLevel ? [stockLevel] : [];
    }

    // Otherwise, get stock levels across all locations using StockLevelManager
    return this.stockLevelManager.getStockLevels(productId, variantId);
  }

  /**
   * Get stock level at a specific location.
   * Uses StockLevelManager internally.
   */
  private async getStockLevelAtLocation(
    productId: number,
    variantId: number | undefined,
    locationId: number,
  ): Promise<{ location_id: number; quantity_available: number } | null> {
    const stockLevels = await this.stockLevelManager.getStockLevels(
      productId,
      variantId,
    );

    return stockLevels.find((sl) => sl.location_id === locationId) ?? null;
  }

  /**
   * Check if a product tracks inventory (considering variant override).
   * Convenience method combining resolveEffectiveTracking with product/variant data fetch.
   */
  async doesProductTrackInventory(
    productId: number,
    variantId?: number,
  ): Promise<boolean> {
    // Fetch product to get track_inventory
    const product = await this.prisma.products.findUnique({
      where: { id: productId },
      select: { track_inventory: true },
    });

    if (!product) {
      throw new BadRequestException(`Product ${productId} not found`);
    }

    // Fetch variant if variantId provided to get track_inventory_override
    let variant: { track_inventory_override: boolean | null } | undefined;
    if (variantId != null) {
      variant = await this.prisma.product_variants.findUnique({
        where: { id: variantId },
        select: { track_inventory_override: true },
      });
    }

    return this.resolveEffectiveTracking(product, variant);
  }
}

import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ValidateConsolidatedStockDto } from '../dto/validate-consolidated-stock.dto';
import { ValidateMultipleConsolidatedStockDto } from '../dto/validate-multiple-consolidated-stock.dto';
import { deriveUoMSplit } from '../shared/helpers/uom-display.helper';

@Injectable()
export class InventoryValidationService {
  constructor(private readonly prisma: StorePrismaService) {}

  async validateConsolidatedStock(validateDto: ValidateConsolidatedStockDto) {
    const { product_id, quantity, organization_id } = validateDto;

    // Obtener todos los niveles de stock para el producto
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        product_id,
        ...(organization_id && {
          inventory_locations: {
            organization_id,
          },
        }),
      },
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    // Calcular stock consolidado
    const totalAvailable = stockLevels.reduce(
      (sum, level) => sum + (level.quantity_available || 0),
      0,
    );
    const totalReserved = stockLevels.reduce(
      (sum, level) => sum + (level.quantity_reserved || 0),
      0,
    );

    const isAvailable = totalAvailable >= quantity;

    // Crear sugerencia de asignación óptima
    const suggestedAllocation = this.calculateOptimalAllocation(
      stockLevels,
      quantity,
    );

    // Formatear locations para respuesta
    const locations = stockLevels.map((level) => ({
      locationId: level.inventory_locations.id,
      locationName: level.inventory_locations.name,
      available: level.quantity_available || 0,
      reserved: level.quantity_reserved || 0,
      onHand: level.quantity_on_hand || 0,
      type: level.inventory_locations.type,
    }));

    return {
      isAvailable,
      totalAvailable,
      totalReserved,
      totalOnHand: stockLevels.reduce(
        (sum, level) => sum + (level.quantity_on_hand || 0),
        0,
      ),
      requested: quantity,
      locations,
      suggestedAllocation:
        suggestedAllocation.length > 0 ? suggestedAllocation : null,
    };
  }

  async validateMultipleConsolidatedStock(
    validateDto: ValidateMultipleConsolidatedStockDto,
  ) {
    const { products, organization_id } = validateDto;

    // Validar cada producto
    const productResults = await Promise.all(
      products.map(async (productQty) => {
        const result = await this.validateConsolidatedStock({
          product_id: productQty.product_id,
          quantity: productQty.quantity,
          organization_id,
        });

        return {
          product_id: productQty.product_id,
          requested: productQty.quantity,
          isAvailable: result.isAvailable,
          totalAvailable: result.totalAvailable,
          totalReserved: result.totalReserved,
          totalOnHand: result.totalOnHand,
          locations: result.locations,
          suggestedAllocation: result.suggestedAllocation,
        };
      }),
    );

    // Evaluar factibilidad del pedido general
    const orderFeasible = productResults.every(
      (product) => product.isAvailable,
    );

    // Calcular estadísticas resumidas
    const summary = {
      totalProductsRequested: products.length,
      totalProductsAvailable: productResults.filter((p) => p.isAvailable)
        .length,
      totalQuantityRequested: products.reduce((sum, p) => sum + p.quantity, 0),
      totalQuantityAvailable: productResults.reduce(
        (sum, p) => sum + p.totalAvailable,
        0,
      ),
    };

    return {
      orderFeasible,
      products: productResults,
      summary,
    };
  }

  async getConsolidatedStockByProduct(
    productId: number,
    organizationId?: number,
  ) {
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        ...(organizationId && {
          inventory_locations: {
            organization_id: organizationId,
          },
        }),
      },
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        // La pantalla de Stock por Bodega pinta el nombre/SKU del producto y la
        // presentación por unidad de medida ("9 sellados + 1 abierto"). Sin
        // estos campos la cabecera salía vacía y la vista UoM nunca aparecía.
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
            is_ingredient: true,
            stock_unit: true,
            purchase_unit: true,
            purchase_to_stock_factor: true,
          },
        },
      },
    });

    const totalAvailable = stockLevels.reduce(
      (sum, level) => sum + (level.quantity_available || 0),
      0,
    );
    const totalReserved = stockLevels.reduce(
      (sum, level) => sum + (level.quantity_reserved || 0),
      0,
    );
    const totalOnHand = stockLevels.reduce(
      (sum, level) => sum + (level.quantity_on_hand || 0),
      0,
    );

    const product = (stockLevels[0] as any)?.products ?? null;

    return {
      product_id: productId,
      product: product
        ? {
            name: product.name,
            sku: product.sku ?? undefined,
            stock_unit: product.stock_unit ?? null,
            purchase_unit: product.purchase_unit ?? null,
            purchase_to_stock_factor: product.purchase_to_stock_factor ?? null,
          }
        : undefined,
      totalAvailable,
      totalReserved,
      totalOnHand,
      stockByLocation: this.groupStockByLocation(stockLevels),
    };
  }

  /**
   * Una fila por BODEGA, no por fila de `stock_levels`.
   *
   * `stock_levels` guarda una fila por variante y ubicación. Devolverlas tal
   * cual hacía que un producto con tres variantes en una sola bodega se pintara
   * como tres renglones idénticos —los tres decían "Showroom Norte", sin nada
   * que los distinguiera— y el encabezado anunciara "Ubicaciones (3)" habiendo
   * una. La pantalla se llama Stock por Bodega y su columna dice Bodega: el
   * desglose por variante ya vive en el editor del producto.
   */
  private groupStockByLocation(stockLevels: any[]) {
    const byLocation = new Map<number, any>();

    for (const level of stockLevels) {
      const locationId = level.inventory_locations.id;
      // Mismo helper que usa la lista de stock; tres cálculos distintos de lo
      // mismo es exactamente cómo se desincronizan.
      const uom = deriveUoMSplit(level as any);
      const existing = byLocation.get(locationId);

      if (!existing) {
        byLocation.set(locationId, {
          locationId,
          locationName: level.inventory_locations.name,
          available: level.quantity_available || 0,
          reserved: level.quantity_reserved || 0,
          onHand: level.quantity_on_hand || 0,
          type: level.inventory_locations.type,
          lastUpdated: level.last_updated,
          sealed_units: uom.sealed_units,
          open_remaining: uom.open_remaining,
          stock_unit: level.products?.stock_unit ?? null,
          purchase_unit: level.products?.purchase_unit ?? null,
          purchase_to_stock_factor:
            level.products?.purchase_to_stock_factor ?? null,
        });
        continue;
      }

      existing.available += level.quantity_available || 0;
      existing.reserved += level.quantity_reserved || 0;
      existing.onHand += level.quantity_on_hand || 0;

      // El desglose por unidad de medida se suma igual que la cantidad: son
      // envases sellados y sobrante, no un estado de la fila.
      if (uom.sealed_units !== null) {
        existing.sealed_units = (existing.sealed_units ?? 0) + uom.sealed_units;
      }
      if (uom.open_remaining !== null) {
        existing.open_remaining =
          (existing.open_remaining ?? 0) + uom.open_remaining;
      }

      // La bodega se actualizó cuando se movió cualquiera de sus filas.
      if (
        level.last_updated &&
        (!existing.lastUpdated || level.last_updated > existing.lastUpdated)
      ) {
        existing.lastUpdated = level.last_updated;
      }
    }

    return Array.from(byLocation.values());
  }

  private calculateOptimalAllocation(
    stockLevels: any[],
    requestedQuantity: number,
  ) {
    // Ordenar por cantidad disponible (mayor a menor)
    const sortedLevels = stockLevels
      .filter((level) => level.quantity_available > 0)
      .sort((a, b) => b.quantity_available - a.quantity_available);

    const allocation: { locationId: number; quantity: number }[] = [];
    let remaining = requestedQuantity;

    for (const level of sortedLevels) {
      if (remaining <= 0) break;

      const allocate = Math.min(level.quantity_available, remaining);
      allocation.push({
        locationId: level.inventory_locations.id,
        quantity: allocate,
      });
      remaining -= allocate;
    }

    return allocation;
  }
}

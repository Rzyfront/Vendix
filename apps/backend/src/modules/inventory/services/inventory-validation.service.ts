import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidateConsolidatedStockDto } from '../dto/validate-consolidated-stock.dto';
import { ValidateMultipleConsolidatedStockDto } from '../dto/validate-multiple-consolidated-stock.dto';

@Injectable()
export class InventoryValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateConsolidatedStock(validateDto: ValidateConsolidatedStockDto) {
    const { product_id, quantity, organization_id } = validateDto;

    // Obtener todos los niveles de stock para el producto
    const stockLevels = await this.prisma.inventory_stock_levels.findMany({
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
    const suggestedAllocation = this.calculateOptimalAllocation(stockLevels, quantity);

    // Formatear locations para respuesta
    const locations = stockLevels.map(level => ({
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
      totalOnHand: stockLevels.reduce((sum, level) => sum + (level.quantity_on_hand || 0), 0),
      requested: quantity,
      locations,
      suggestedAllocation: suggestedAllocation.length > 0 ? suggestedAllocation : null,
    };
  }

  async validateMultipleConsolidatedStock(validateDto: ValidateMultipleConsolidatedStockDto) {
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
    const orderFeasible = productResults.every(product => product.isAvailable);

    // Calcular estadísticas resumidas
    const summary = {
      totalProductsRequested: products.length,
      totalProductsAvailable: productResults.filter(p => p.isAvailable).length,
      totalQuantityRequested: products.reduce((sum, p) => sum + p.quantity, 0),
      totalQuantityAvailable: productResults.reduce((sum, p) => sum + p.totalAvailable, 0),
    };

    return {
      orderFeasible,
      products: productResults,
      summary,
    };
  }

  async getConsolidatedStockByProduct(productId: number, organizationId?: number) {
    const stockLevels = await this.prisma.inventory_stock_levels.findMany({
      where: {
        product_id: productId,
        ...(organizationId && {
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

    return {
      product_id: productId,
      totalAvailable,
      totalReserved,
      totalOnHand,
      stockByLocation: stockLevels.map(level => ({
        locationId: level.inventory_locations.id,
        locationName: level.inventory_locations.name,
        available: level.quantity_available || 0,
        reserved: level.quantity_reserved || 0,
        onHand: level.quantity_on_hand || 0,
        type: level.inventory_locations.type,
        lastUpdated: level.last_updated,
      })),
    };
  }

  private calculateOptimalAllocation(stockLevels: any[], requestedQuantity: number) {
    // Ordenar por cantidad disponible (mayor a menor)
    const sortedLevels = stockLevels
      .filter(level => level.quantity_available > 0)
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
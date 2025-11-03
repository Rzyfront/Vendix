"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryIntegrationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../../prisma/prisma.service");
let InventoryIntegrationService = class InventoryIntegrationService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async reserveStock(organizationId, productId, locationId, quantity, orderType, orderId, productVariantId) {
        return this.prisma.$transaction(async (tx) => {
            const stockLevel = await tx.stock_levels.findUnique({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
            });
            if (!stockLevel || stockLevel.quantity_available < quantity) {
                throw new common_1.BadRequestException(`Insufficient stock available. Required: ${quantity}, Available: ${stockLevel?.quantity_available || 0}`);
            }
            const updatedStock = await tx.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_reserved: stockLevel.quantity_reserved + quantity,
                    quantity_available: stockLevel.quantity_available - quantity,
                    last_updated: new Date(),
                },
            });
            await tx.stock_reservations.create({
                data: {
                    organization_id: organizationId,
                    product_id: productId,
                    product_variant_id: productVariantId,
                    location_id: locationId,
                    quantity,
                    reserved_for_type: orderType,
                    reserved_for_id: orderId,
                    status: 'active',
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    created_at: new Date(),
                },
            });
            return updatedStock;
        });
    }
    async releaseStock(organizationId, productId, locationId, quantity, orderType, orderId, productVariantId) {
        return this.prisma.$transaction(async (tx) => {
            const reservation = await tx.stock_reservations.findFirst({
                where: {
                    organization_id: organizationId,
                    product_id: productId,
                    product_variant_id: productVariantId,
                    location_id: locationId,
                    reserved_for_type: orderType,
                    reserved_for_id: orderId,
                    status: 'active',
                },
            });
            if (reservation) {
                await tx.stock_reservations.update({
                    where: { id: reservation.id },
                    data: {
                        status: 'consumed',
                        updated_at: new Date(),
                    },
                });
            }
            const stockLevel = await tx.stock_levels.findUnique({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
            });
            if (stockLevel) {
                const releaseQuantity = Math.min(quantity, stockLevel.quantity_reserved);
                return tx.stock_levels.update({
                    where: {
                        product_id_product_variant_id_location_id: {
                            product_id: productId,
                            product_variant_id: productVariantId || null,
                            location_id: locationId,
                        },
                    },
                    data: {
                        quantity_reserved: Math.max(0, stockLevel.quantity_reserved - releaseQuantity),
                        last_updated: new Date(),
                    },
                });
            }
        });
    }
    async updateStockAndCreateMovement(organizationId, productId, locationId, quantityChange, movementType, sourceOrderType, sourceOrderId, reason, productVariantId, fromLocationId, toLocationId) {
        return this.prisma.$transaction(async (tx) => {
            await tx.inventory_movements.create({
                data: {
                    organization_id: organizationId,
                    product_id: productId,
                    product_variant_id: productVariantId,
                    from_location_id: fromLocationId,
                    to_location_id: toLocationId || locationId,
                    quantity: Math.abs(quantityChange),
                    movement_type: movementType,
                    source_order_type: sourceOrderType,
                    source_order_id: sourceOrderId,
                    reason: reason || 'Stock update',
                    created_at: new Date(),
                },
            });
            const targetLocationId = toLocationId || locationId;
            const existingStock = await tx.stock_levels.findUnique({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: targetLocationId,
                    },
                },
            });
            if (existingStock) {
                const newQuantityOnHand = existingStock.quantity_on_hand + quantityChange;
                const newQuantityAvailable = existingStock.quantity_available + quantityChange;
                return tx.stock_levels.update({
                    where: {
                        product_id_product_variant_id_location_id: {
                            product_id: productId,
                            product_variant_id: productVariantId || null,
                            location_id: targetLocationId,
                        },
                    },
                    data: {
                        quantity_on_hand: Math.max(0, newQuantityOnHand),
                        quantity_available: Math.max(0, newQuantityAvailable),
                        last_updated: new Date(),
                    },
                });
            }
            else {
                return tx.stock_levels.create({
                    data: {
                        organization_id: organizationId,
                        product_id: productId,
                        product_variant_id: productVariantId,
                        location_id: targetLocationId,
                        quantity_on_hand: Math.max(0, quantityChange),
                        quantity_reserved: 0,
                        quantity_available: Math.max(0, quantityChange),
                        last_updated: new Date(),
                    },
                });
            }
        });
    }
    async calculateWeightedAverageCost(organizationId, productId, locationId, productVariantId) {
        const where = {
            organization_id: organizationId,
            product_id: productId,
            product_variant_id: productVariantId,
            movement_type: 'stock_in',
        };
        if (locationId) {
            where.to_location_id = locationId;
        }
        const movements = await this.prisma.inventory_movements.findMany({
            where,
            orderBy: {
                created_at: 'desc',
            },
            take: 100,
        });
        if (movements.length === 0) {
            return 0;
        }
        let totalCost = 0;
        let totalQuantity = 0;
        for (const movement of movements) {
            const cost = 10;
            totalCost += cost * movement.quantity;
            totalQuantity += movement.quantity;
        }
        return totalQuantity > 0 ? totalCost / totalQuantity : 0;
    }
    async checkStockAvailability(organizationId, productId, requiredQuantity, productVariantId) {
        const stockLevels = await this.prisma.stock_levels.findMany({
            where: {
                organization_id: organizationId,
                product_id: productId,
                product_variant_id: productVariantId,
                quantity_available: { gt: 0 },
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
        return stockLevels.map((stock) => ({
            locationId: stock.location_id,
            available: stock.quantity_available,
            locationName: stock.inventory_locations.name,
        }));
    }
    async getLowStockAlerts(organizationId, locationId) {
        const where = {
            organization_id: organizationId,
            quantity_available: {
                lte: this.prisma.stock_levels.fields.reorder_point,
            },
        };
        if (locationId) {
            where.location_id = locationId;
        }
        const lowStockItems = await this.prisma.stock_levels.findMany({
            where,
            include: {
                products: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                inventory_locations: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        return lowStockItems.map((item) => ({
            productId: item.product_id,
            productName: item.products.name,
            locationId: item.location_id,
            locationName: item.inventory_locations.name,
            currentStock: item.quantity_available,
            reorderPoint: item.reorder_point,
        }));
    }
    async getInventoryValuation(organizationId, locationId) {
        const where = {
            organization_id: organizationId,
        };
        if (locationId) {
            where.location_id = locationId;
        }
        const stockLevels = await this.prisma.stock_levels.findMany({
            where,
            include: {
                inventory_locations: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        let totalValue = 0;
        const locationBreakdown = new Map();
        for (const stockLevel of stockLevels) {
            const avgCost = await this.calculateWeightedAverageCost(organizationId, stockLevel.product_id, stockLevel.location_id, stockLevel.product_variant_id);
            const itemValue = stockLevel.quantity_on_hand * avgCost;
            totalValue += itemValue;
            const locationId = stockLevel.location_id;
            const current = locationBreakdown.get(locationId) || {
                name: stockLevel.inventory_locations.name,
                value: 0,
            };
            current.value += itemValue;
            locationBreakdown.set(locationId, current);
        }
        return {
            totalValue,
            itemCount: stockLevels.length,
            locationBreakdown: Array.from(locationBreakdown.entries()).map(([locationId, data]) => ({
                locationId,
                locationName: data.name,
                value: data.value,
            })),
        };
    }
    async cleanupExpiredReservations(organizationId) {
        const now = new Date();
        const expiredReservations = await this.prisma.stock_reservations.findMany({
            where: {
                organization_id: organizationId,
                status: 'active',
                expires_at: { lt: now },
            },
        });
        if (expiredReservations.length === 0) {
            return 0;
        }
        await this.prisma.$transaction(async (tx) => {
            for (const reservation of expiredReservations) {
                await tx.stock_reservations.update({
                    where: { id: reservation.id },
                    data: {
                        status: 'expired',
                        updated_at: now,
                    },
                });
                const stockLevel = await tx.stock_levels.findUnique({
                    where: {
                        product_id_product_variant_id_location_id: {
                            product_id: reservation.product_id,
                            product_variant_id: reservation.product_variant_id,
                            location_id: reservation.location_id,
                        },
                    },
                });
                if (stockLevel) {
                    await tx.stock_levels.update({
                        where: {
                            product_id_product_variant_id_location_id: {
                                product_id: reservation.product_id,
                                product_variant_id: reservation.product_variant_id,
                                location_id: reservation.location_id,
                            },
                        },
                        data: {
                            quantity_reserved: Math.max(0, stockLevel.quantity_reserved - reservation.quantity),
                            quantity_available: stockLevel.quantity_available + reservation.quantity,
                            last_updated: now,
                        },
                    });
                }
            }
        });
        return expiredReservations.length;
    }
};
exports.InventoryIntegrationService = InventoryIntegrationService;
exports.InventoryIntegrationService = InventoryIntegrationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InventoryIntegrationService);
//# sourceMappingURL=inventory-integration.service.js.map
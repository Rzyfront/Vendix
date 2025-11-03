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
exports.StockLevelsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
let StockLevelsService = class StockLevelsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    findAll(query) {
        return this.prisma.stock_levels.findMany({
            where: {
                product_id: query.product_id,
                location_id: query.location_id,
            },
            include: {
                products: true,
                product_variants: true,
                inventory_locations: true,
            },
        });
    }
    findByProduct(productId, query) {
        return this.prisma.stock_levels.findMany({
            where: {
                product_id: productId,
                location_id: query.location_id,
            },
            include: {
                products: true,
                product_variants: true,
                inventory_locations: true,
            },
        });
    }
    findByLocation(locationId, query) {
        return this.prisma.stock_levels.findMany({
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
    }
    getStockAlerts(query) {
        return this.prisma.stock_levels.findMany({
            where: {
                quantity_available: {
                    lte: this.prisma.stock_levels.fields.reorder_point,
                },
                product_id: query.product_id,
                location_id: query.location_id,
            },
            include: {
                products: true,
                product_variants: true,
                inventory_locations: true,
            },
        });
    }
    findOne(id) {
        return this.prisma.stock_levels.findUnique({
            where: { id },
            include: {
                products: true,
                product_variants: true,
                inventory_locations: true,
            },
        });
    }
    async updateStockLevel(productId, locationId, quantityChange, productVariantId) {
        const existingStock = await this.prisma.stock_levels.findUnique({
            where: {
                product_id_product_variant_id_location_id: {
                    product_id: productId,
                    product_variant_id: productVariantId || null,
                    location_id: locationId,
                },
            },
        });
        if (existingStock) {
            return this.prisma.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_on_hand: existingStock.quantity_on_hand + quantityChange,
                    quantity_available: existingStock.quantity_available + quantityChange,
                    last_updated: new Date(),
                },
            });
        }
        else {
            return this.prisma.stock_levels.create({
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
};
exports.StockLevelsService = StockLevelsService;
exports.StockLevelsService = StockLevelsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], StockLevelsService);
//# sourceMappingURL=stock-levels.service.js.map
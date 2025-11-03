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
exports.MovementsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
let MovementsService = class MovementsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createMovementDto) {
        return this.prisma.$transaction(async (tx) => {
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
            await this.updateStockLevels(tx, movement);
            return movement;
        });
    }
    findAll(query) {
        const where = {
            product_id: query.product_id,
            product_variant_id: query.product_variant_id,
            from_location_id: query.from_location_id,
            to_location_id: query.to_location_id,
            movement_type: query.movement_type,
            user_id: query.user_id,
        };
        if (query.start_date || query.end_date) {
            where.created_at = {};
            if (query.start_date) {
                where.created_at.gte = new Date(query.start_date);
            }
            if (query.end_date) {
                where.created_at.lte = new Date(query.end_date);
            }
        }
        if (query.search) {
            where.OR = [
                { reason: { contains: query.search } },
                { notes: { contains: query.search } },
                { reference_number: { contains: query.search } },
                { batch_number: { contains: query.search } },
                { serial_number: { contains: query.search } },
            ];
        }
        return this.prisma.inventory_movements.findMany({
            where,
            include: {
                products: true,
                product_variants: true,
                from_location: true,
                to_location: true,
                users: true,
            },
            orderBy: {
                created_at: 'desc',
            },
        });
    }
    findByProduct(productId, query) {
        return this.findAll({
            ...query,
            product_id: productId,
        });
    }
    findByLocation(locationId, query) {
        return this.findAll({
            ...query,
            from_location_id: locationId,
        });
    }
    findByUser(userId, query) {
        return this.findAll({
            ...query,
            user_id: userId,
        });
    }
    findOne(id) {
        return this.prisma.inventory_movements.findUnique({
            where: { id },
            include: {
                products: true,
                product_variants: true,
                from_location: true,
                to_location: true,
                users: true,
            },
        });
    }
    async updateStockLevels(tx, movement) {
        const { product_id, product_variant_id, from_location_id, to_location_id, quantity, movement_type, } = movement;
        switch (movement_type) {
            case 'stock_in':
                if (to_location_id) {
                    await this.updateStockLevel(tx, product_id, to_location_id, quantity, product_variant_id);
                }
                break;
            case 'stock_out':
                if (from_location_id) {
                    await this.updateStockLevel(tx, product_id, from_location_id, -quantity, product_variant_id);
                }
                break;
            case 'transfer':
                if (from_location_id && to_location_id) {
                    await this.updateStockLevel(tx, product_id, from_location_id, -quantity, product_variant_id);
                    await this.updateStockLevel(tx, product_id, to_location_id, quantity, product_variant_id);
                }
                break;
            case 'sale':
                if (from_location_id) {
                    await this.updateStockLevel(tx, product_id, from_location_id, -quantity, product_variant_id);
                }
                break;
            case 'return':
                if (to_location_id) {
                    await this.updateStockLevel(tx, product_id, to_location_id, quantity, product_variant_id);
                }
                break;
            case 'damage':
            case 'expiration':
                if (from_location_id) {
                    await this.updateStockLevel(tx, product_id, from_location_id, -quantity, product_variant_id);
                }
                break;
            case 'adjustment':
                if (from_location_id) {
                    await this.updateStockLevel(tx, product_id, from_location_id, quantity, product_variant_id);
                }
                break;
        }
    }
    async updateStockLevel(tx, productId, locationId, quantityChange, productVariantId) {
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
            const newQuantityAvailable = existingStock.quantity_available + quantityChange;
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
        }
        else {
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
};
exports.MovementsService = MovementsService;
exports.MovementsService = MovementsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MovementsService);
//# sourceMappingURL=movements.service.js.map
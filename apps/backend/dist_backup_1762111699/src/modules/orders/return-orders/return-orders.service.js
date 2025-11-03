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
exports.ReturnOrdersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let ReturnOrdersService = class ReturnOrdersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createReturnOrderDto) {
        return this.prisma.$transaction(async (tx) => {
            const returnNumber = await this.generateReturnNumber(tx, createReturnOrderDto.type || 'refund');
            let totalRefundAmount = createReturnOrderDto.total_refund_amount;
            if (!totalRefundAmount) {
                totalRefundAmount = createReturnOrderDto.items.reduce((sum, item) => sum + (item.refund_amount || 0) * item.quantity_returned, 0);
            }
            const returnOrder = await tx.return_orders.create({
                data: {
                    ...createReturnOrderDto,
                    return_number: returnNumber,
                    return_date: createReturnOrderDto.return_date
                        ? new Date(createReturnOrderDto.return_date)
                        : new Date(),
                    total_refund_amount: totalRefundAmount,
                },
                include: {
                    return_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
            return returnOrder;
        });
    }
    findAll(query) {
        const where = {
            order_id: query.order_id,
            partner_id: query.partner_id,
            type: query.type,
            status: query.status,
            store_id: query.store_id,
        };
        if (query.return_date_from || query.return_date_to) {
            where.return_date = {};
            if (query.return_date_from) {
                where.return_date.gte = query.return_date_from;
            }
            if (query.return_date_to) {
                where.return_date.lte = query.return_date_to;
            }
        }
        if (query.search) {
            where.OR = [
                { return_number: { contains: query.search } },
                { reference_number: { contains: query.search } },
                { reason: { contains: query.search } },
                { notes: { contains: query.search } },
            ];
        }
        if (query.product_id) {
            where.return_order_items = {
                some: {
                    product_id: query.product_id,
                },
            };
        }
        return this.prisma.return_orders.findMany({
            where,
            include: {
                return_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
            orderBy: {
                return_date: 'desc',
            },
        });
    }
    findByStatus(status, query) {
        return this.findAll({
            ...query,
            status,
        });
    }
    findByType(type, query) {
        return this.findAll({
            ...query,
            type,
        });
    }
    findByPartner(partnerId, query) {
        return this.findAll({
            ...query,
            partner_id: partnerId,
        });
    }
    findOne(id) {
        return this.prisma.return_orders.findUnique({
            where: { id },
            include: {
                return_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async update(id, updateReturnOrderDto) {
        const existingReturn = await this.prisma.return_orders.findUnique({
            where: { id },
        });
        if (existingReturn.status !== client_1.return_order_status_enum.draft) {
            throw new common_1.BadRequestException('Only draft returns can be updated');
        }
        return this.prisma.return_orders.update({
            where: { id },
            data: updateReturnOrderDto,
            include: {
                return_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async process(id, items) {
        return this.prisma.$transaction(async (tx) => {
            const returnOrder = await tx.return_orders.findUnique({
                where: { id },
                include: { return_order_items: true },
            });
            if (returnOrder.status !== client_1.return_order_status_enum.draft) {
                throw new common_1.BadRequestException('Only draft returns can be processed');
            }
            for (const item of items) {
                const returnItem = returnOrder.return_order_items.find((ri) => ri.id === item.id);
                if (!returnItem)
                    continue;
                switch (item.action) {
                    case 'restock':
                        await this.restockItem(tx, returnOrder, returnItem, item.location_id);
                        break;
                    case 'write_off':
                        await this.writeOffItem(tx, returnOrder, returnItem);
                        break;
                    case 'repair':
                        await this.repairItem(tx, returnOrder, returnItem, item.location_id);
                        break;
                }
            }
            return tx.return_orders.update({
                where: { id },
                data: {
                    status: client_1.return_order_status_enum.processed,
                    processed_date: new Date(),
                },
                include: {
                    return_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
        });
    }
    async cancel(id) {
        const returnOrder = await this.prisma.return_orders.findUnique({
            where: { id },
        });
        if (returnOrder.status === client_1.return_order_status_enum.processed) {
            throw new common_1.BadRequestException('Processed returns cannot be cancelled');
        }
        return this.prisma.return_orders.update({
            where: { id },
            data: {
                status: client_1.return_order_status_enum.cancelled,
                cancelled_date: new Date(),
            },
            include: {
                return_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    remove(id) {
        return this.prisma.return_orders.delete({
            where: { id },
        });
    }
    async restockItem(tx, returnOrder, returnItem, locationId) {
        const targetLocationId = locationId || returnOrder.location_id;
        await tx.inventory_movements.create({
            data: {
                organization_id: returnOrder.organization_id,
                product_id: returnItem.product_id,
                product_variant_id: returnItem.product_variant_id,
                to_location_id: targetLocationId,
                quantity: returnItem.quantity,
                movement_type: 'return',
                source_order_type: 'return_order',
                source_order_id: returnOrder.id,
                reason: `Return restock: ${returnItem.reason}`,
                created_at: new Date(),
            },
        });
        await this.updateStockLevel(tx, returnItem.product_id, targetLocationId, returnItem.quantity, returnItem.product_variant_id);
    }
    async writeOffItem(tx, returnOrder, returnItem) {
        await tx.inventory_movements.create({
            data: {
                organization_id: returnOrder.organization_id,
                product_id: returnItem.product_id,
                product_variant_id: returnItem.product_variant_id,
                from_location_id: returnOrder.location_id,
                quantity: returnItem.quantity,
                movement_type: 'damage',
                source_order_type: 'return_order',
                source_order_id: returnOrder.id,
                reason: `Return write-off: ${returnItem.reason}`,
                created_at: new Date(),
            },
        });
        await this.updateStockLevel(tx, returnItem.product_id, returnOrder.location_id, -returnItem.quantity, returnItem.product_variant_id);
    }
    async repairItem(tx, returnOrder, returnItem, locationId) {
        const targetLocationId = locationId || returnOrder.location_id;
        await tx.inventory_movements.create({
            data: {
                organization_id: returnOrder.organization_id,
                product_id: returnItem.product_id,
                product_variant_id: returnItem.product_variant_id,
                to_location_id: targetLocationId,
                quantity: returnItem.quantity,
                movement_type: 'adjustment',
                source_order_type: 'return_order',
                source_order_id: returnOrder.id,
                reason: `Return repair: ${returnItem.reason}`,
                created_at: new Date(),
            },
        });
        await this.updateStockLevel(tx, returnItem.product_id, targetLocationId, returnItem.quantity, returnItem.product_variant_id);
    }
    async generateReturnNumber(tx, type) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const prefix = type === 'purchase_return'
            ? `PR-${year}${month}${day}`
            : `SR-${year}${month}${day}`;
        const lastReturn = await tx.return_orders.findFirst({
            where: {
                return_number: {
                    startsWith: prefix,
                },
                type: type,
            },
            orderBy: {
                return_number: 'desc',
            },
        });
        let sequence = 1;
        if (lastReturn) {
            const lastSequence = parseInt(lastReturn.return_number.split('-')[2]);
            sequence = lastSequence + 1;
        }
        return `${prefix}-${String(sequence).padStart(4, '0')}`;
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
exports.ReturnOrdersService = ReturnOrdersService;
exports.ReturnOrdersService = ReturnOrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReturnOrdersService);
//# sourceMappingURL=return-orders.service.js.map
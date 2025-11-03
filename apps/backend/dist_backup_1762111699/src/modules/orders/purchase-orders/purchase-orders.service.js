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
exports.PurchaseOrdersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let PurchaseOrdersService = class PurchaseOrdersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createPurchaseOrderDto) {
        return this.prisma.$transaction(async (tx) => {
            const subtotal = createPurchaseOrderDto.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const totalAmount = subtotal -
                (createPurchaseOrderDto.discount_amount || 0) +
                (createPurchaseOrderDto.tax_amount || 0) +
                (createPurchaseOrderDto.shipping_cost || 0);
            const purchaseOrder = await tx.purchase_orders.create({
                data: {
                    ...createPurchaseOrderDto,
                    subtotal,
                    total_amount: totalAmount,
                    order_date: new Date(),
                },
                include: {
                    suppliers: true,
                    inventory_locations: true,
                    purchase_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
            return purchaseOrder;
        });
    }
    findAll(query) {
        const where = {
            supplier_id: query.supplier_id,
            location_id: query.location_id,
            status: query.status,
        };
        if (query.start_date || query.end_date) {
            where.order_date = {};
            if (query.start_date) {
                where.order_date.gte = new Date(query.start_date);
            }
            if (query.end_date) {
                where.order_date.lte = new Date(query.end_date);
            }
        }
        if (query.min_total || query.max_total) {
            where.total_amount = {};
            if (query.min_total) {
                where.total_amount.gte = query.min_total;
            }
            if (query.max_total) {
                where.total_amount.lte = query.max_total;
            }
        }
        if (query.search) {
            where.OR = [
                { internal_reference: { contains: query.search } },
                { supplier_reference: { contains: query.search } },
                { notes: { contains: query.search } },
                { suppliers: { name: { contains: query.search } } },
            ];
        }
        return this.prisma.purchase_orders.findMany({
            where,
            include: {
                suppliers: true,
                inventory_locations: true,
                purchase_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
            orderBy: {
                order_date: 'desc',
            },
        });
    }
    findByStatus(status, query) {
        return this.findAll({
            ...query,
            status,
        });
    }
    findPending(query) {
        return this.findAll({
            ...query,
            status: client_1.purchase_order_status_enum.approved,
        });
    }
    findBySupplier(supplierId, query) {
        return this.findAll({
            ...query,
            supplier_id: supplierId,
        });
    }
    findOne(id) {
        return this.prisma.purchase_orders.findUnique({
            where: { id },
            include: {
                suppliers: true,
                inventory_locations: true,
                purchase_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async update(id, updatePurchaseOrderDto) {
        return this.prisma.$transaction(async (tx) => {
            if (updatePurchaseOrderDto.items) {
                const subtotal = updatePurchaseOrderDto.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
                const totalAmount = subtotal -
                    (updatePurchaseOrderDto.discount_amount || 0) +
                    (updatePurchaseOrderDto.tax_amount || 0) +
                    (updatePurchaseOrderDto.shipping_cost || 0);
                updatePurchaseOrderDto.subtotal = subtotal;
                updatePurchaseOrderDto.total_amount = totalAmount;
            }
            return tx.purchase_orders.update({
                where: { id },
                data: updatePurchaseOrderDto,
                include: {
                    suppliers: true,
                    inventory_locations: true,
                    purchase_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
        });
    }
    async approve(id) {
        return this.prisma.purchase_orders.update({
            where: { id },
            data: {
                status: client_1.purchase_order_status_enum.approved,
                approved_date: new Date(),
            },
            include: {
                suppliers: true,
                inventory_locations: true,
                purchase_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async cancel(id) {
        return this.prisma.purchase_orders.update({
            where: { id },
            data: {
                status: client_1.purchase_order_status_enum.cancelled,
                cancelled_date: new Date(),
            },
            include: {
                suppliers: true,
                inventory_locations: true,
                purchase_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                    },
                },
            },
        });
    }
    async receive(id, items) {
        return this.prisma.$transaction(async (tx) => {
            for (const item of items) {
                await tx.purchase_order_items.update({
                    where: { id: item.id },
                    data: {
                        quantity_received: item.quantity_received,
                        received_date: new Date(),
                    },
                });
            }
            const purchaseOrder = await tx.purchase_orders.findUnique({
                where: { id },
                include: {
                    purchase_order_items: true,
                    inventory_locations: true,
                },
            });
            for (const item of purchaseOrder.purchase_order_items) {
                const receivedItem = items.find((i) => i.id === item.id);
                if (receivedItem && receivedItem.quantity_received > 0) {
                    await tx.inventory_movements.create({
                        data: {
                            organization_id: purchaseOrder.organization_id,
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id,
                            to_location_id: purchaseOrder.location_id,
                            quantity: receivedItem.quantity_received,
                            movement_type: 'stock_in',
                            source_order_type: 'purchase_order',
                            source_order_id: id,
                            reason: 'Purchase order receipt',
                            created_at: new Date(),
                        },
                    });
                    await this.updateStockLevel(tx, item.product_id, purchaseOrder.location_id, receivedItem.quantity_received, item.product_variant_id);
                }
            }
            const allItemsReceived = purchaseOrder.purchase_order_items.every((item) => {
                const receivedItem = items.find((i) => i.id === item.id);
                return (receivedItem && receivedItem.quantity_received >= item.quantity);
            });
            const newStatus = allItemsReceived
                ? client_1.purchase_order_status_enum.received
                : client_1.purchase_order_status_enum.approved;
            return tx.purchase_orders.update({
                where: { id },
                data: {
                    status: newStatus,
                    received_date: allItemsReceived ? new Date() : null,
                },
                include: {
                    suppliers: true,
                    inventory_locations: true,
                    purchase_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                        },
                    },
                },
            });
        });
    }
    remove(id) {
        return this.prisma.purchase_orders.delete({
            where: { id },
        });
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
exports.PurchaseOrdersService = PurchaseOrdersService;
exports.PurchaseOrdersService = PurchaseOrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PurchaseOrdersService);
//# sourceMappingURL=purchase-orders.service.js.map
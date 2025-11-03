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
exports.SalesOrdersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let SalesOrdersService = class SalesOrdersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createSalesOrderDto) {
        return this.prisma.$transaction(async (tx) => {
            const subtotal = createSalesOrderDto.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const totalAmount = subtotal -
                (createSalesOrderDto.discount_amount || 0) +
                (createSalesOrderDto.tax_amount || 0) +
                (createSalesOrderDto.shipping_cost || 0);
            const salesOrder = await tx.sales_orders.create({
                data: {
                    ...createSalesOrderDto,
                    subtotal,
                    total_amount: totalAmount,
                    order_date: createSalesOrderDto.order_date
                        ? new Date(createSalesOrderDto.order_date)
                        : new Date(),
                },
                include: {
                    customers: true,
                    shipping_addresses: true,
                    billing_addresses: true,
                    sales_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                            inventory_locations: true,
                        },
                    },
                },
            });
            return salesOrder;
        });
    }
    findAll(query) {
        const where = {
            customer_id: query.customer_id,
            status: query.status,
            payment_status: query.payment_status,
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
                { customer_reference: { contains: query.search } },
                { customer_email: { contains: query.search } },
                { customer_name: { contains: query.search } },
                { notes: { contains: query.search } },
                { customers: { name: { contains: query.search } } },
                { customers: { email: { contains: query.search } } },
            ];
        }
        return this.prisma.sales_orders.findMany({
            where,
            include: {
                customers: true,
                shipping_addresses: true,
                billing_addresses: true,
                sales_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                        inventory_locations: true,
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
    findByCustomer(customerId, query) {
        return this.findAll({
            ...query,
            customer_id: customerId,
        });
    }
    findOne(id) {
        return this.prisma.sales_orders.findUnique({
            where: { id },
            include: {
                customers: true,
                shipping_addresses: true,
                billing_addresses: true,
                sales_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                        inventory_locations: true,
                    },
                },
            },
        });
    }
    async update(id, updateSalesOrderDto) {
        return this.prisma.$transaction(async (tx) => {
            if (updateSalesOrderDto.items) {
                const subtotal = updateSalesOrderDto.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
                const totalAmount = subtotal -
                    (updateSalesOrderDto.discount_amount || 0) +
                    (updateSalesOrderDto.tax_amount || 0) +
                    (updateSalesOrderDto.shipping_cost || 0);
                updateSalesOrderDto.subtotal = subtotal;
                updateSalesOrderDto.total_amount = totalAmount;
            }
            return tx.sales_orders.update({
                where: { id },
                data: updateSalesOrderDto,
                include: {
                    customers: true,
                    shipping_addresses: true,
                    billing_addresses: true,
                    sales_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                            inventory_locations: true,
                        },
                    },
                },
            });
        });
    }
    async confirm(id) {
        return this.prisma.$transaction(async (tx) => {
            const salesOrder = await tx.sales_orders.findUnique({
                where: { id },
                include: { sales_order_items: true },
            });
            for (const item of salesOrder.sales_order_items) {
                await this.reserveStock(tx, item.product_id, item.location_id, item.quantity, item.product_variant_id);
            }
            return tx.sales_orders.update({
                where: { id },
                data: {
                    status: client_1.sales_order_status_enum.confirmed,
                    confirmed_date: new Date(),
                },
                include: {
                    customers: true,
                    shipping_addresses: true,
                    billing_addresses: true,
                    sales_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                            inventory_locations: true,
                        },
                    },
                },
            });
        });
    }
    async ship(id, items) {
        return this.prisma.$transaction(async (tx) => {
            for (const item of items) {
                await tx.sales_order_items.update({
                    where: { id: item.id },
                    data: {
                        quantity_shipped: item.quantity_shipped,
                        shipped_date: new Date(),
                    },
                });
            }
            const salesOrder = await tx.sales_orders.findUnique({
                where: { id },
                include: {
                    sales_order_items: true,
                },
            });
            for (const item of salesOrder.sales_order_items) {
                const shippedItem = items.find((i) => i.id === item.id);
                if (shippedItem && shippedItem.quantity_shipped > 0) {
                    await tx.inventory_movements.create({
                        data: {
                            organization_id: salesOrder.organization_id,
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id,
                            from_location_id: item.location_id,
                            quantity: shippedItem.quantity_shipped,
                            movement_type: 'sale',
                            source_order_type: 'sales_order',
                            source_order_id: id,
                            reason: 'Sales order shipment',
                            created_at: new Date(),
                        },
                    });
                    await this.updateStockLevel(tx, item.product_id, item.location_id, -shippedItem.quantity_shipped, item.product_variant_id);
                    await this.releaseStock(tx, item.product_id, item.location_id, shippedItem.quantity_shipped, item.product_variant_id);
                }
            }
            const allItemsShipped = salesOrder.sales_order_items.every((item) => {
                const shippedItem = items.find((i) => i.id === item.id);
                return shippedItem && shippedItem.quantity_shipped >= item.quantity;
            });
            const newStatus = allItemsShipped
                ? client_1.sales_order_status_enum.shipped
                : client_1.sales_order_status_enum.confirmed;
            return tx.sales_orders.update({
                where: { id },
                data: {
                    status: newStatus,
                    shipped_date: allItemsShipped ? new Date() : null,
                },
                include: {
                    customers: true,
                    shipping_addresses: true,
                    billing_addresses: true,
                    sales_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                            inventory_locations: true,
                        },
                    },
                },
            });
        });
    }
    async invoice(id) {
        return this.prisma.sales_orders.update({
            where: { id },
            data: {
                status: client_1.sales_order_status_enum.invoiced,
                invoiced_date: new Date(),
            },
            include: {
                customers: true,
                shipping_addresses: true,
                billing_addresses: true,
                sales_order_items: {
                    include: {
                        products: true,
                        product_variants: true,
                        inventory_locations: true,
                    },
                },
            },
        });
    }
    async cancel(id) {
        return this.prisma.$transaction(async (tx) => {
            const salesOrder = await tx.sales_orders.findUnique({
                where: { id },
                include: { sales_order_items: true },
            });
            for (const item of salesOrder.sales_order_items) {
                if (item.quantity_reserved > 0) {
                    await this.releaseStock(tx, item.product_id, item.location_id, item.quantity_reserved, item.product_variant_id);
                }
            }
            return tx.sales_orders.update({
                where: { id },
                data: {
                    status: client_1.sales_order_status_enum.cancelled,
                    cancelled_date: new Date(),
                },
                include: {
                    customers: true,
                    shipping_addresses: true,
                    billing_addresses: true,
                    sales_order_items: {
                        include: {
                            products: true,
                            product_variants: true,
                            inventory_locations: true,
                        },
                    },
                },
            });
        });
    }
    remove(id) {
        return this.prisma.sales_orders.delete({
            where: { id },
        });
    }
    async reserveStock(tx, productId, locationId, quantity, productVariantId) {
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
            const newQuantityReserved = existingStock.quantity_reserved + quantity;
            const newQuantityAvailable = existingStock.quantity_available - quantity;
            return tx.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_reserved: Math.max(0, newQuantityReserved),
                    quantity_available: Math.max(0, newQuantityAvailable),
                    last_updated: new Date(),
                },
            });
        }
    }
    async releaseStock(tx, productId, locationId, quantity, productVariantId) {
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
            const newQuantityReserved = existingStock.quantity_reserved - quantity;
            const newQuantityAvailable = existingStock.quantity_available + quantity;
            return tx.stock_levels.update({
                where: {
                    product_id_product_variant_id_location_id: {
                        product_id: productId,
                        product_variant_id: productVariantId || null,
                        location_id: locationId,
                    },
                },
                data: {
                    quantity_reserved: Math.max(0, newQuantityReserved),
                    quantity_available: Math.max(0, newQuantityAvailable),
                    last_updated: new Date(),
                },
            });
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
                    last_updated: new Date(),
                },
            });
        }
    }
};
exports.SalesOrdersService = SalesOrdersService;
exports.SalesOrdersService = SalesOrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SalesOrdersService);
//# sourceMappingURL=sales-orders.service.js.map
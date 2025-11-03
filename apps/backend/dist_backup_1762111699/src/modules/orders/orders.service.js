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
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const client_1 = require("@prisma/client");
let OrdersService = class OrdersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createOrderDto, creatingUser) {
        try {
            if (!createOrderDto.order_number) {
                createOrderDto.order_number = await this.generateOrderNumber();
            }
            const user = await this.prisma.users.findUnique({
                where: { id: createOrderDto.customer_id },
            });
            if (!user) {
                throw new common_1.NotFoundException('User (customer) not found');
            }
            const store = await this.prisma.stores.findUnique({
                where: { id: createOrderDto.store_id },
            });
            if (!store) {
                throw new common_1.NotFoundException('Store not found');
            }
            return await this.prisma.orders.create({
                data: {
                    customer_id: createOrderDto.customer_id,
                    store_id: createOrderDto.store_id,
                    order_number: createOrderDto.order_number,
                    state: createOrderDto.status || client_1.order_state_enum.created,
                    subtotal_amount: createOrderDto.subtotal,
                    tax_amount: createOrderDto.tax_amount || 0,
                    shipping_cost: createOrderDto.shipping_amount || 0,
                    discount_amount: createOrderDto.discount_amount || 0,
                    grand_total: createOrderDto.total_amount,
                    currency: createOrderDto.currency_code || 'USD',
                    billing_address_id: createOrderDto.billing_address_id,
                    shipping_address_id: createOrderDto.shipping_address_id,
                    internal_notes: createOrderDto.notes,
                    updated_at: new Date(),
                    order_items: {
                        create: createOrderDto.items.map((item) => ({
                            product_id: item.product_id,
                            product_variant_id: item.product_variant_id,
                            product_name: item.product_name,
                            variant_sku: item.variant_sku,
                            variant_attributes: item.variant_attributes,
                            quantity: item.quantity,
                            unit_price: item.unit_price,
                            total_price: item.total_price,
                            tax_rate: item.tax_rate,
                            tax_amount_item: item.tax_amount_item,
                            updated_at: new Date(),
                        })),
                    },
                },
                include: {
                    stores: { select: { id: true, name: true, store_code: true } },
                    order_items: { include: { products: true, product_variants: true } },
                },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('Order number already exists');
                }
            }
            throw error;
        }
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, status, customer_id, store_id, sort, date_from, date_to, } = query;
        const skip = (page - 1) * limit;
        const where = {
            ...(search && {
                OR: [{ order_number: { contains: search, mode: 'insensitive' } }],
            }),
            ...(status && { state: status }),
            ...(customer_id && { customer_id }),
            ...(date_from &&
                date_to && {
                created_at: {
                    gte: new Date(date_from),
                    lte: new Date(date_to),
                },
            }),
        };
        const orderBy = {};
        if (sort) {
            const [field, direction] = sort.split(':');
            orderBy[field] = direction === 'desc' ? 'desc' : 'asc';
        }
        else {
            orderBy.created_at = 'desc';
        }
        const [orders, total] = await Promise.all([
            this.prisma.orders.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                include: {
                    stores: { select: { id: true, name: true, store_code: true } },
                    order_items: {
                        select: { id: true, product_name: true, quantity: true },
                    },
                },
            }),
            this.prisma.orders.count({ where }),
        ]);
        return {
            data: orders,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id) {
        const order = await this.prisma.orders.findUnique({
            where: { id },
            include: {
                stores: { select: { id: true, name: true, store_code: true } },
                order_items: { include: { products: true, product_variants: true } },
                addresses_orders_billing_address_idToaddresses: true,
                addresses_orders_shipping_address_idToaddresses: true,
                payments: true,
            },
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return order;
    }
    async update(id, updateOrderDto) {
        await this.findOne(id);
        return this.prisma.orders.update({
            where: { id },
            data: { ...updateOrderDto, updated_at: new Date() },
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.orders.delete({ where: { id } });
    }
    async generateOrderNumber() {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const lastOrder = await this.prisma.orders.findFirst({
            where: { order_number: { startsWith: `ORD${year}${month}${day}` } },
            orderBy: { order_number: 'desc' },
        });
        let sequence = 1;
        if (lastOrder) {
            const lastSequence = parseInt(lastOrder.order_number.slice(-4));
            sequence = lastSequence + 1;
        }
        return `ORD${year}${month}${day}${sequence.toString().padStart(4, '0')}`;
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], OrdersService);
//# sourceMappingURL=orders.service.js.map
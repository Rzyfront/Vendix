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
exports.StoresService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const slugify_1 = require("slugify");
let StoresService = class StoresService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createStoreDto) {
        const organization = await this.prisma.organizations.findUnique({
            where: { id: createStoreDto.organization_id },
        });
        if (!organization) {
            throw new common_1.BadRequestException('Organization not found');
        }
        const slug = (0, slugify_1.default)(createStoreDto.name, { lower: true, strict: true });
        const existingStore = await this.prisma.stores.findFirst({
            where: { organization_id: createStoreDto.organization_id, slug },
        });
        if (existingStore) {
            throw new common_1.ConflictException('Store slug already exists in this organization');
        }
        return this.prisma.stores.create({
            data: {
                ...createStoreDto,
                slug,
                updated_at: new Date(),
            },
            include: {
                organizations: { select: { id: true, name: true, slug: true } },
                addresses: true,
                store_settings: true,
                _count: { select: { products: true, orders: true, store_users: true } },
            },
        });
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, store_type, is_active, organization_id, } = query;
        const skip = (page - 1) * limit;
        const where = {
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { store_code: { contains: search, mode: 'insensitive' } },
                ],
            }),
            ...(store_type && { store_type }),
            ...(is_active !== undefined && { is_active }),
        };
        const [stores, total] = await Promise.all([
            this.prisma.stores.findMany({
                where,
                skip,
                take: limit,
                include: {
                    organizations: { select: { id: true, name: true, slug: true } },
                    addresses: { where: { is_primary: true } },
                    _count: {
                        select: { products: true, orders: true, store_users: true },
                    },
                },
                orderBy: { created_at: 'desc' },
            }),
            this.prisma.stores.count({ where }),
        ]);
        return {
            data: stores,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id) {
        const store = await this.prisma.stores.findUnique({
            where: { id },
            include: {
                organizations: true,
                addresses: true,
                store_settings: true,
                store_users: { include: { user: true } },
                _count: {
                    select: {
                        products: true,
                        orders: true,
                        categories: true,
                        store_users: true,
                    },
                },
            },
        });
        if (!store) {
            throw new common_1.NotFoundException('Store not found');
        }
        return store;
    }
    async update(id, updateStoreDto) {
        await this.findOne(id);
        return this.prisma.stores.update({
            where: { id },
            data: { ...updateStoreDto, updated_at: new Date() },
            include: { organizations: true, addresses: true, store_settings: true },
        });
    }
    async remove(id) {
        await this.findOne(id);
        const activeOrders = await this.prisma.orders.count({
            where: {
                store_id: id,
                state: { in: ['created', 'pending_payment', 'processing', 'shipped'] },
            },
        });
        if (activeOrders > 0) {
            throw new common_1.BadRequestException('Cannot delete store with active orders');
        }
        await this.prisma.login_attempts.deleteMany({
            where: { store_id: id },
        });
        return this.prisma.stores.delete({ where: { id } });
    }
    async updateStoreSettings(storeId, settingsDto) {
        await this.findOne(storeId);
        return this.prisma.store_settings.upsert({
            where: { store_id: storeId },
            update: { settings: settingsDto.settings, updated_at: new Date() },
            create: { store_id: storeId, settings: settingsDto.settings },
        });
    }
    async getDashboard(id, query) {
        const { start_date, end_date } = query;
        const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = end_date || new Date();
        const [totalOrdersCount, totalRevenue, productsLowStockCount, activeCustomersCount, recentOrders, topProducts, salesByPeriod,] = await Promise.all([
            this.prisma.orders.count({
                where: {
                    store_id: id,
                    created_at: { gte: startDate },
                    state: { not: 'cancelled' },
                },
            }),
            this.prisma.orders.aggregate({
                where: {
                    store_id: id,
                    created_at: { gte: startDate },
                    state: 'finished',
                },
                _sum: { grand_total: true },
            }),
            this.prisma.products.count({
                where: {
                    store_id: id,
                    state: 'active',
                    stock_quantity: { lt: 10, gte: 0 },
                },
            }),
            this.prisma.orders
                .findMany({
                where: {
                    store_id: id,
                    created_at: { gte: startDate },
                    state: { not: 'cancelled' },
                },
                select: { customer_id: true },
                distinct: ['customer_id'],
            })
                .then((orders) => orders.length),
            this.prisma.orders.findMany({
                where: { store_id: id },
                include: {
                    addresses_orders_billing_address_idToaddresses: {
                        select: { id: true, city: true, country_code: true },
                    },
                },
                orderBy: { created_at: 'desc' },
                take: 10,
            }),
            this.prisma.order_items.groupBy({
                by: ['product_id', 'product_name'],
                where: {
                    orders: {
                        store_id: id,
                        created_at: { gte: startDate },
                        state: { not: 'cancelled' },
                    },
                },
                _sum: {
                    quantity: true,
                    total_price: true,
                },
                orderBy: {
                    _sum: {
                        quantity: 'desc',
                    },
                },
                take: 10,
            }),
            this.prisma.orders.findMany({
                where: {
                    store_id: id,
                    created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                    state: 'finished',
                },
                select: {
                    created_at: true,
                    grand_total: true,
                },
                orderBy: { created_at: 'asc' },
            }),
        ]);
        const salesChart = salesByPeriod.reduce((acc, order) => {
            const date = order.created_at.toISOString().split('T')[0];
            if (!acc[date])
                acc[date] = 0;
            acc[date] += Number(order.grand_total || 0);
            return acc;
        }, {});
        return {
            store_id: id,
            metrics: {
                total_orders: totalOrdersCount,
                total_revenue: totalRevenue._sum.grand_total || 0,
                low_stock_products: productsLowStockCount,
                active_customers: activeCustomersCount,
                revenue_today: 0,
                revenue_this_week: Object.values(salesChart).reduce((sum, val) => sum + val, 0),
                average_order_value: totalOrdersCount > 0
                    ? (totalRevenue._sum.grand_total || 0) / totalOrdersCount
                    : 0,
            },
            recent_orders: recentOrders.map((order) => ({
                id: order.id,
                order_number: order.order_number,
                grand_total: order.grand_total,
                state: order.state,
                created_at: order.created_at,
                customer_location: order.addresses_orders_billing_address_idToaddresses?.country_code ||
                    'Unknown',
            })),
            top_products: topProducts.slice(0, 5).map((item) => ({
                product_id: item.product_id,
                product_name: item.product_name,
                total_sold: item.quantity,
                total_revenue: item._sum.total_price || 0,
            })),
            sales_chart: Object.entries(salesChart).map(([date, total]) => ({
                date,
                total,
            })),
        };
    }
    async getGlobalDashboard() {
        const [totalStores, activeStores, inactiveStores, suspendedStores, draftStores, totalRevenue, totalOrders, totalProducts,] = await Promise.all([
            this.prisma.stores.count(),
            this.prisma.stores.count({
                where: { is_active: true },
            }),
            this.prisma.stores.count({
                where: { is_active: false },
            }),
            this.prisma.stores.count({
                where: {
                    is_active: false,
                },
            }),
            this.prisma.stores.count({
                where: {
                    is_active: false,
                    created_at: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    },
                },
            }),
            this.prisma.orders.aggregate({
                where: {
                    state: 'finished',
                },
                _sum: { grand_total: true },
            }),
            this.prisma.orders.count({
                where: {
                    state: { not: 'cancelled' },
                },
            }),
            this.prisma.products.count({
                where: {
                    state: 'active',
                },
            }),
        ]);
        return {
            total_stores: totalStores,
            active_stores: activeStores,
            inactive_stores: inactiveStores,
            suspended_stores: suspendedStores,
            draft_stores: draftStores,
            total_revenue: totalRevenue._sum.grand_total || 0,
            total_orders: totalOrders,
            total_products: totalProducts,
        };
    }
};
exports.StoresService = StoresService;
exports.StoresService = StoresService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], StoresService);
//# sourceMappingURL=stores.service.js.map
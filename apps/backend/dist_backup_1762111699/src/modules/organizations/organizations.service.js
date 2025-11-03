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
exports.OrganizationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const slugify_1 = require("slugify");
let OrganizationsService = class OrganizationsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createOrganizationDto) {
        const slug = (0, slugify_1.default)(createOrganizationDto.name, {
            lower: true,
            strict: true,
        });
        const existingOrg = await this.prisma.organizations.findFirst({
            where: { OR: [{ slug }, { tax_id: createOrganizationDto.tax_id }] },
        });
        if (existingOrg) {
            throw new common_1.ConflictException('Organization with this slug or tax ID already exists');
        }
        return this.prisma.organizations.create({
            data: {
                ...createOrganizationDto,
                slug,
                updated_at: new Date(),
            },
            include: {
                stores: true,
                addresses: true,
                users: true,
            },
        });
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, state } = query;
        const skip = (page - 1) * limit;
        const where = {
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { legal_name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            }),
            ...(state && { state }),
        };
        const [organizations, total] = await Promise.all([
            this.prisma.organizations.findMany({
                where,
                skip,
                take: limit,
                include: {
                    stores: { select: { id: true, name: true, is_active: true } },
                    addresses: { where: { is_primary: true } },
                    _count: { select: { stores: true, users: true } },
                },
                orderBy: { created_at: 'desc' },
            }),
            this.prisma.organizations.count({ where }),
        ]);
        return {
            data: organizations,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id) {
        const organization = await this.prisma.organizations.findUnique({
            where: { id },
            include: {
                stores: {
                    include: { _count: { select: { products: true, orders: true } } },
                },
                addresses: true,
                users: {
                    select: { id: true, first_name: true, last_name: true, email: true },
                },
                _count: { select: { stores: true, users: true } },
            },
        });
        if (!organization) {
            throw new common_1.NotFoundException('Organization not found');
        }
        return organization;
    }
    async findBySlug(slug) {
        const organization = await this.prisma.organizations.findUnique({
            where: { slug },
            include: { stores: true, addresses: true },
        });
        if (!organization) {
            throw new common_1.NotFoundException('Organization not found');
        }
        return organization;
    }
    async update(id, updateOrganizationDto) {
        await this.findOne(id);
        return this.prisma.organizations.update({
            where: { id },
            data: { ...updateOrganizationDto, updated_at: new Date() },
            include: { stores: true, addresses: true, users: true },
        });
    }
    async remove(id) {
        await this.findOne(id);
        const activeStores = await this.prisma.stores.count({
            where: { organization_id: id, is_active: true },
        });
        if (activeStores > 0) {
            throw new common_1.BadRequestException('Cannot delete organization with active stores');
        }
        return this.prisma.organizations.delete({ where: { id } });
    }
    async getDashboard(id, query) {
        const { start_date, end_date } = query;
        const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = end_date || new Date();
        const [activeUsersCount, activeStoresCount, recentOrdersCount, totalRevenue, storeActivity, userGrowth, auditActivity,] = await Promise.all([
            this.prisma.users.count({
                where: {
                    organization_id: id,
                    state: 'active',
                    last_login: { gte: startDate },
                },
            }),
            this.prisma.stores.count({
                where: {
                    organization_id: id,
                    is_active: true,
                },
            }),
            this.prisma.orders.count({
                where: {
                    store: { organization_id: id },
                    created_at: { gte: startDate },
                },
            }),
            this.prisma.orders.aggregate({
                where: {
                    store: { organization_id: id },
                    created_at: { gte: startDate },
                    state: 'finished',
                },
                _sum: { grand_total: true },
            }),
            this.prisma.stores.findMany({
                where: { organization_id: id, is_active: true },
                select: {
                    id: true,
                    name: true,
                    _count: {
                        select: {
                            orders: { where: { created_at: { gte: startDate } } },
                            products: true,
                            users: true,
                        },
                    },
                },
            }),
            this.prisma.users.groupBy({
                by: ['created_at'],
                where: {
                    organization_id: id,
                    created_at: { gte: startDate, lte: endDate },
                },
                _count: { id: true },
                orderBy: { created_at: 'asc' },
            }),
            this.prisma.audit_logs.findMany({
                where: {
                    organization_id: id,
                    created_at: { gte: startDate },
                },
                take: 10,
                orderBy: { created_at: 'desc' },
                include: {
                    users: { select: { first_name: true, last_name: true } },
                    stores: { select: { name: true } },
                },
            }),
        ]);
        return {
            organization_id: id,
            metrics: {
                active_users: activeUsersCount,
                active_stores: activeStoresCount,
                recent_orders: recentOrdersCount,
                total_revenue: totalRevenue._sum.grand_total || 0,
                growth_trends: userGrowth || [],
            },
            store_activity: storeActivity.map((store) => ({
                id: store.id,
                name: store.name,
                orders_count: store._count.orders,
                products_count: store._count.products,
                users_count: store._count.users,
            })),
            recent_audit: auditActivity.map((log) => ({
                id: log.id,
                action: log.action,
                resource: log.resource,
                created_at: log.created_at,
                user: log.users
                    ? `${log.users.first_name} ${log.users.last_name}`
                    : null,
                store: log.stores?.name,
            })),
        };
    }
    async getDashboardStats() {
        const totalOrganizations = await this.prisma.organizations.count();
        const active = await this.prisma.organizations.count({
            where: { state: 'active' },
        });
        const inactive = await this.prisma.organizations.count({
            where: { state: 'inactive' },
        });
        const suspended = await this.prisma.organizations.count({
            where: { state: 'suspended' },
        });
        return {
            total_organizations: totalOrganizations,
            active,
            inactive,
            suspended,
        };
    }
};
exports.OrganizationsService = OrganizationsService;
exports.OrganizationsService = OrganizationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], OrganizationsService);
//# sourceMappingURL=organizations.service.js.map
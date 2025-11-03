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
exports.AdminOrganizationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const dto_1 = require("../organizations/dto");
const slugify_1 = require("slugify");
let AdminOrganizationsService = class AdminOrganizationsService {
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
        const { page = 1, limit = 10, search, status, is_active, sort_by = 'created_at', sort_order = 'desc', } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
                { tax_id: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (status) {
            where.state = status;
        }
        if (is_active !== undefined) {
            where.state = is_active
                ? dto_1.OrganizationState.ACTIVE
                : dto_1.OrganizationState.INACTIVE;
        }
        const [data, total] = await Promise.all([
            this.prisma.organizations.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sort_by]: sort_order },
                include: {
                    stores: {
                        select: { id: true, name: true, is_active: true },
                    },
                    _count: {
                        select: {
                            users: true,
                            stores: true,
                        },
                    },
                },
            }),
            this.prisma.organizations.count({ where }),
        ]);
        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOne(id) {
        const organization = await this.prisma.organizations.findUnique({
            where: { id },
            include: {
                stores: {
                    include: {
                        addresses: true,
                        _count: {
                            select: {
                                users: true,
                                orders: true,
                                products: true,
                            },
                        },
                    },
                },
                addresses: true,
                users: {
                    select: {
                        id: true,
                        first_name: true,
                        last_name: true,
                        email: true,
                        is_active: true,
                        roles: {
                            include: {
                                role: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        stores: true,
                        users: true,
                        addresses: true,
                    },
                },
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
            include: {
                stores: true,
                addresses: true,
                users: true,
            },
        });
        if (!organization) {
            throw new common_1.NotFoundException('Organization not found');
        }
        return organization;
    }
    async update(id, updateOrganizationDto) {
        const existingOrg = await this.prisma.organizations.findUnique({
            where: { id },
        });
        if (!existingOrg) {
            throw new common_1.NotFoundException('Organization not found');
        }
        let slug = existingOrg.slug;
        if (updateOrganizationDto.name &&
            updateOrganizationDto.name !== existingOrg.name) {
            slug = (0, slugify_1.default)(updateOrganizationDto.name, {
                lower: true,
                strict: true,
            });
            const slugExists = await this.prisma.organizations.findFirst({
                where: { slug, id: { not: id } },
            });
            if (slugExists) {
                throw new common_1.ConflictException('Organization with this slug already exists');
            }
        }
        if (updateOrganizationDto.tax_id &&
            updateOrganizationDto.tax_id !== existingOrg.tax_id) {
            const taxIdExists = await this.prisma.organizations.findFirst({
                where: { tax_id: updateOrganizationDto.tax_id, id: { not: id } },
            });
            if (taxIdExists) {
                throw new common_1.ConflictException('Organization with this tax ID already exists');
            }
        }
        return this.prisma.organizations.update({
            where: { id },
            data: {
                ...updateOrganizationDto,
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
    async remove(id) {
        const existingOrg = await this.prisma.organizations.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        stores: true,
                        users: true,
                    },
                },
            },
        });
        if (!existingOrg) {
            throw new common_1.NotFoundException('Organization not found');
        }
        if (existingOrg._count.stores > 0 || existingOrg._count.users > 0) {
            throw new common_1.BadRequestException('Cannot delete organization with existing stores or users');
        }
        return this.prisma.organizations.delete({
            where: { id },
        });
    }
    async getDashboardStats() {
        const [totalOrganizations, activeOrganizations, inactiveOrganizations, recentOrganizations, organizationsByStatus,] = await Promise.all([
            this.prisma.organizations.count(),
            this.prisma.organizations.count({ where: { is_active: true } }),
            this.prisma.organizations.count({ where: { is_active: false } }),
            this.prisma.organizations.findMany({
                take: 5,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    created_at: true,
                    _count: {
                        select: {
                            stores: true,
                            users: true,
                        },
                    },
                },
            }),
            this.prisma.organizations.groupBy({
                by: ['status'],
                _count: true,
            }),
        ]);
        return {
            totalOrganizations,
            activeOrganizations,
            inactiveOrganizations,
            recentOrganizations,
            organizationsByStatus: organizationsByStatus.reduce((acc, item) => {
                acc[item.status] = item._count;
                return acc;
            }, {}),
        };
    }
    async getDashboard(id, query) {
        const { start_date, end_date } = query;
        const organization = await this.findOne(id);
        const dateFilter = {};
        if (start_date || end_date) {
            dateFilter.created_at = {};
            if (start_date)
                dateFilter.created_at.gte = new Date(start_date);
            if (end_date)
                dateFilter.created_at.lte = new Date(end_date);
        }
        const [totalStores, activeStores, totalUsers, activeUsers, totalOrders, totalRevenue, recentOrders, topStores,] = await Promise.all([
            this.prisma.stores.count({
                where: { organization_id: id },
            }),
            this.prisma.stores.count({
                where: { organization_id: id, is_active: true },
            }),
            this.prisma.users.count({
                where: { organization_id: id },
            }),
            this.prisma.users.count({
                where: { organization_id: id, is_active: true },
            }),
            this.prisma.orders.count({
                where: { store: { organization_id: id }, ...dateFilter },
            }),
            this.prisma.orders.aggregate({
                where: { store: { organization_id: id }, ...dateFilter },
                _sum: { total_amount: true },
            }),
            this.prisma.orders.findMany({
                where: { store: { organization_id: id } },
                take: 5,
                orderBy: { created_at: 'desc' },
                include: {
                    store: {
                        select: { id: true, name: true },
                    },
                },
            }),
            this.prisma.stores.findMany({
                where: { organization_id: id },
                take: 5,
                orderBy: {
                    orders: {
                        _count: 'desc',
                    },
                },
                include: {
                    _count: {
                        select: {
                            orders: true,
                            users: true,
                            products: true,
                        },
                    },
                },
            }),
        ]);
        return {
            organization,
            stats: {
                totalStores,
                activeStores,
                totalUsers,
                activeUsers,
                totalOrders,
                totalRevenue: totalRevenue._sum.total_amount || 0,
            },
            recentOrders,
            topStores,
        };
    }
};
exports.AdminOrganizationsService = AdminOrganizationsService;
exports.AdminOrganizationsService = AdminOrganizationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminOrganizationsService);
//# sourceMappingURL=admin-organizations.service.js.map
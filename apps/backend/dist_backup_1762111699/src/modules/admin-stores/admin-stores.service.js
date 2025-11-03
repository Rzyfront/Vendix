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
exports.AdminStoresService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const slugify_1 = require("slugify");
let AdminStoresService = class AdminStoresService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createStoreDto) {
        const slug = (0, slugify_1.default)(createStoreDto.name, {
            lower: true,
            strict: true,
        });
        const existingStore = await this.prisma.stores.findFirst({
            where: {
                OR: [{ slug }, { name: createStoreDto.name }],
                organization_id: createStoreDto.organization_id,
            },
        });
        if (existingStore) {
            throw new common_1.ConflictException('Store with this name or slug already exists in this organization');
        }
        return this.prisma.stores.create({
            data: {
                ...createStoreDto,
                slug,
                updated_at: new Date(),
            },
            include: {
                organization: true,
                addresses: true,
                users: true,
            },
        });
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, organization_id, store_type } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (organization_id) {
            where.organization_id = organization_id;
        }
        if (store_type) {
            where.store_type = store_type;
        }
        const [data, total] = await Promise.all([
            this.prisma.stores.findMany({
                where,
                skip,
                take: limit,
                include: {
                    organization: {
                        select: { id: true, name: true, slug: true },
                    },
                    _count: {
                        select: {
                            users: true,
                            products: true,
                            orders: true,
                        },
                    },
                },
            }),
            this.prisma.stores.count({ where }),
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
        const store = await this.prisma.stores.findUnique({
            where: { id },
            include: {
                organization: true,
                addresses: true,
                users: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                first_name: true,
                                last_name: true,
                                email: true,
                                is_active: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        users: true,
                        products: true,
                        orders: true,
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
        const existingStore = await this.prisma.stores.findUnique({
            where: { id },
        });
        if (!existingStore) {
            throw new common_1.NotFoundException('Store not found');
        }
        let slug = existingStore.slug;
        if (updateStoreDto.name && updateStoreDto.name !== existingStore.name) {
            slug = (0, slugify_1.default)(updateStoreDto.name, {
                lower: true,
                strict: true,
            });
            const slugExists = await this.prisma.stores.findFirst({
                where: {
                    slug,
                    id: { not: id },
                    organization_id: existingStore.organization_id,
                },
            });
            if (slugExists) {
                throw new common_1.ConflictException('Store with this slug already exists in this organization');
            }
        }
        return this.prisma.stores.update({
            where: { id },
            data: {
                ...updateStoreDto,
                slug,
                updated_at: new Date(),
            },
            include: {
                organization: true,
                addresses: true,
                users: true,
            },
        });
    }
    async remove(id) {
        const existingStore = await this.prisma.stores.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        users: true,
                        products: true,
                        orders: true,
                    },
                },
            },
        });
        if (!existingStore) {
            throw new common_1.NotFoundException('Store not found');
        }
        if (existingStore._count.users > 0 ||
            existingStore._count.products > 0 ||
            existingStore._count.orders > 0) {
            throw new common_1.ConflictException('Cannot delete store with existing users, products, or orders');
        }
        return this.prisma.stores.delete({
            where: { id },
        });
    }
    async getDashboardStats() {
        const [totalStores, activeStores, storesByType, storesByState, recentStores,] = await Promise.all([
            this.prisma.stores.count(),
            this.prisma.stores.count({ where: { is_active: true } }),
            this.prisma.stores.groupBy({
                by: ['store_type'],
                _count: true,
            }),
            this.prisma.stores.groupBy({
                by: ['is_active'],
                _count: true,
            }),
            this.prisma.stores.findMany({
                take: 5,
                orderBy: { created_at: 'desc' },
                include: {
                    organization: {
                        select: { name: true },
                    },
                    _count: {
                        select: {
                            users: true,
                            products: true,
                            orders: true,
                        },
                    },
                },
            }),
        ]);
        return {
            totalStores,
            activeStores,
            storesByType: storesByType.reduce((acc, item) => {
                acc[item.store_type] = item._count;
                return acc;
            }, {}),
            storesByState: storesByState.reduce((acc, item) => {
                acc[item.is_active.toString()] = item._count;
                return acc;
            }, {}),
            recentStores,
        };
    }
};
exports.AdminStoresService = AdminStoresService;
exports.AdminStoresService = AdminStoresService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminStoresService);
//# sourceMappingURL=admin-stores.service.js.map
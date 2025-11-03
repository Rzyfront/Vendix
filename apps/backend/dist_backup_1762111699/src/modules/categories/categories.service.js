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
exports.CategoriesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const slugify_1 = require("slugify");
let CategoriesService = class CategoriesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createCategoryDto, user) {
        await this.validateStoreAccess(createCategoryDto.store_id, user);
        const slug = (0, slugify_1.default)(createCategoryDto.name, { lower: true, strict: true });
        await this.validateUniqueSlug(slug, createCategoryDto.store_id);
        return this.prisma.categories.create({
            data: {
                ...createCategoryDto,
                slug,
                state: 'active',
            },
            include: { stores: true },
        });
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, store_id, sort_by = 'name', sort_order = 'asc', include_inactive = false, } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (!include_inactive)
            where.state = 'active';
        if (search)
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        if (store_id)
            where.store_id = store_id;
        const [categories, total] = await Promise.all([
            this.prisma.categories.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sort_by]: sort_order },
                include: { stores: true },
            }),
            this.prisma.categories.count({ where }),
        ]);
        return {
            data: categories,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id, options = {}) {
        const where = { id };
        if (!options.includeInactive)
            where.state = 'active';
        const category = await this.prisma.categories.findFirst({
            where,
            include: { stores: true },
        });
        if (!category)
            throw new common_1.NotFoundException('Category not found');
        return category;
    }
    async update(id, updateCategoryDto, user) {
        const category = await this.findOne(id);
        if (category.store_id)
            await this.validateStoreAccess(category.store_id, user);
        const updateData = { ...updateCategoryDto };
        if (updateCategoryDto.name && category.store_id) {
            const slug = (0, slugify_1.default)(updateCategoryDto.name, {
                lower: true,
                strict: true,
            });
            await this.validateUniqueSlug(slug, category.store_id, id);
            updateData.slug = slug;
        }
        return this.prisma.categories.update({
            where: { id },
            data: updateData,
            include: { stores: true },
        });
    }
    async remove(id, user) {
        const category = await this.findOne(id, { includeInactive: true });
        if (category.store_id)
            await this.validateStoreAccess(category.store_id, user);
        const productCount = await this.prisma.product_categories.count({
            where: { category_id: id },
        });
        if (productCount > 0)
            throw new common_1.BadRequestException('Cannot delete category with assigned products');
        await this.prisma.categories.delete({ where: { id } });
    }
    async validateStoreAccess(storeId, user) {
        const store = await this.prisma.stores.findUnique({
            where: { id: storeId },
        });
        if (!store)
            throw new common_1.NotFoundException('Store not found');
        if (store.organization_id !== user.organizationId &&
            user.role !== 'super_admin') {
            throw new common_1.ForbiddenException('Access denied to this store');
        }
    }
    async validateUniqueSlug(slug, storeId, excludeId) {
        const where = { slug, store_id: storeId };
        if (excludeId)
            where.id = { not: excludeId };
        const existing = await this.prisma.categories.findFirst({ where });
        if (existing)
            throw new common_1.ConflictException('Category slug already exists in this store');
    }
};
exports.CategoriesService = CategoriesService;
exports.CategoriesService = CategoriesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CategoriesService);
//# sourceMappingURL=categories.service.js.map
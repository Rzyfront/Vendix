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
exports.BrandsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let BrandsService = class BrandsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createBrandDto, user) {
        try {
            return await this.prisma.brands.create({
                data: {
                    name: createBrandDto.name,
                    description: createBrandDto.description,
                    logo_url: createBrandDto.logo_url,
                },
            });
        }
        catch (error) {
            if (error.code === 'P2002') {
                throw new common_1.ConflictException('Brand name already exists');
            }
            throw error;
        }
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, sort_by = 'name', sort_order = 'asc', } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }
        const [brands, total] = await Promise.all([
            this.prisma.brands.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sort_by]: sort_order },
                include: {
                    _count: {
                        select: { products: true },
                    },
                },
            }),
            this.prisma.brands.count({ where }),
        ]);
        return {
            data: brands,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findByStore(storeId, query) {
        const { page = 1, limit = 10, search, sort_by = 'name', sort_order = 'asc', } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }
        where.products = {
            some: {
                store_id: storeId,
            },
        };
        const [brands, total] = await Promise.all([
            this.prisma.brands.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sort_by]: sort_order },
                include: {
                    _count: {
                        select: { products: true },
                    },
                },
            }),
            this.prisma.brands.count({ where }),
        ]);
        return {
            data: brands,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOne(id, options) {
        const brand = await this.prisma.brands.findFirst({
            where: { id },
            include: {
                _count: {
                    select: { products: true },
                },
            },
        });
        if (!brand) {
            throw new common_1.NotFoundException('Brand not found');
        }
        return brand;
    }
    async findBySlug(slug, storeId, options) {
        const brand = await this.prisma.brands.findFirst({
            where: {
                name: { contains: slug, mode: 'insensitive' },
                products: {
                    some: {
                        store_id: storeId,
                    },
                },
            },
            include: {
                _count: {
                    select: { products: true },
                },
            },
        });
        if (!brand) {
            throw new common_1.NotFoundException('Brand not found');
        }
        return brand;
    }
    async activate(id, user) {
        const brand = await this.findOne(id);
        return brand;
    }
    async deactivate(id, user) {
        const brand = await this.findOne(id);
        return brand;
    }
    async update(id, updateBrandDto, user) {
        const brand = await this.findOne(id);
        const updateData = {};
        if (updateBrandDto.name) {
            updateData.name = updateBrandDto.name;
        }
        if (updateBrandDto.description !== undefined) {
            updateData.description = updateBrandDto.description;
        }
        if (updateBrandDto.logo_url !== undefined) {
            updateData.logo_url = updateBrandDto.logo_url;
        }
        try {
            return await this.prisma.brands.update({
                where: { id },
                data: updateData,
                include: {
                    _count: {
                        select: { products: true },
                    },
                },
            });
        }
        catch (error) {
            if (error.code === 'P2002') {
                throw new common_1.ConflictException('Brand name already exists');
            }
            throw error;
        }
    }
    async remove(id, user) {
        const brand = await this.findOne(id);
        const productCount = await this.prisma.products.count({
            where: { brand_id: id },
        });
        if (productCount > 0) {
            throw new common_1.BadRequestException('Cannot delete brand with assigned products');
        }
        await this.prisma.brands.delete({ where: { id } });
    }
    async validateUniqueName(name, excludeId) {
        const where = { name };
        if (excludeId) {
            where.id = { not: excludeId };
        }
        const existing = await this.prisma.brands.findFirst({ where });
        if (existing) {
            throw new common_1.ConflictException('Brand name already exists');
        }
    }
};
exports.BrandsService = BrandsService;
exports.BrandsService = BrandsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BrandsService);
//# sourceMappingURL=brands.service.js.map
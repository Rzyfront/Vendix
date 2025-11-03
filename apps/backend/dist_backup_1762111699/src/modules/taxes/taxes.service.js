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
exports.TaxesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let TaxesService = class TaxesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createTaxCategoryDto, user) {
        if (createTaxCategoryDto.store_id) {
            await this.validateStoreAccess(createTaxCategoryDto.store_id, user);
        }
        return this.prisma.tax_categories.create({
            data: {
                name: createTaxCategoryDto.name,
                description: createTaxCategoryDto.description,
                store_id: createTaxCategoryDto.store_id,
            },
        });
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, store_id } = query;
        const skip = (page - 1) * limit;
        const where = {};
        if (search)
            where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
        if (store_id)
            where.store_id = store_id;
        const [taxCategories, total] = await Promise.all([
            this.prisma.tax_categories.findMany({ where, skip, take: limit }),
            this.prisma.tax_categories.count({ where }),
        ]);
        return {
            data: taxCategories,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    async findOne(id, user) {
        const taxCategory = await this.prisma.tax_categories.findUnique({
            where: { id },
        });
        if (!taxCategory)
            throw new common_1.NotFoundException('Tax category not found');
        if (taxCategory.store_id)
            await this.validateStoreAccess(taxCategory.store_id, user);
        return taxCategory;
    }
    async update(id, updateTaxCategoryDto, user) {
        await this.findOne(id, user);
        return this.prisma.tax_categories.update({
            where: { id },
            data: updateTaxCategoryDto,
        });
    }
    async remove(id, user) {
        await this.findOne(id, user);
        return this.prisma.tax_categories.delete({ where: { id } });
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
};
exports.TaxesService = TaxesService;
exports.TaxesService = TaxesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TaxesService);
//# sourceMappingURL=taxes.service.js.map
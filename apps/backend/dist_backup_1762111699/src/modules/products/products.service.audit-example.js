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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const audit_1 = require("../audit");
const dto_1 = require("./dto");
const client_1 = require("@prisma/client");
const slug_util_1 = require("../../common/utils/slug.util");
let ProductsService = class ProductsService {
    constructor(prisma, auditService) {
        this.prisma = prisma;
        this.auditService = auditService;
    }
    async create(createProductDto, userId) {
        try {
            const store = await this.prisma.stores.findFirst({
                where: {
                    id: createProductDto.store_id,
                    is_active: true,
                },
            });
            if (!store) {
                throw new common_1.BadRequestException('Tienda no encontrada o inactiva');
            }
            const slug = createProductDto.slug || (0, slug_util_1.generateSlug)(createProductDto.name);
            const existingProduct = await this.prisma.products.findFirst({
                where: {
                    store_id: createProductDto.store_id,
                    slug: slug,
                    state: { not: dto_1.ProductState.ARCHIVED },
                },
            });
            if (existingProduct) {
                throw new common_1.ConflictException('El slug del producto ya existe en esta tienda');
            }
            if (createProductDto.sku) {
                const existingSku = await this.prisma.products.findFirst({
                    where: {
                        sku: createProductDto.sku,
                        state: { not: dto_1.ProductState.ARCHIVED },
                    },
                });
                if (existingSku) {
                    throw new common_1.ConflictException('El SKU ya está en uso');
                }
            }
            const { category_ids, tax_category_ids, image_urls, ...productData } = createProductDto;
            const result = await this.prisma.$transaction(async (prisma) => {
                const product = await prisma.products.create({
                    data: {
                        ...productData,
                        slug: slug,
                        updated_at: new Date(),
                    },
                });
                if (category_ids && category_ids.length > 0) {
                    await prisma.product_categories.createMany({
                        data: category_ids.map((categoryId) => ({
                            product_id: product.id,
                            category_id: categoryId,
                        })),
                    });
                }
                if (tax_category_ids && tax_category_ids.length > 0) {
                    await prisma.product_tax_assignments.createMany({
                        data: tax_category_ids.map((taxCategoryId) => ({
                            product_id: product.id,
                            tax_category_id: taxCategoryId,
                        })),
                    });
                }
                if (image_urls && image_urls.length > 0) {
                    await prisma.product_images.createMany({
                        data: image_urls.map((url, index) => ({
                            product_id: product.id,
                            image_url: url,
                            is_main: index === 0,
                        })),
                    });
                }
                return product;
            });
            await this.auditService.logCreate(userId, audit_1.AuditResource.PRODUCTS, result.id, {
                name: result.name,
                sku: result.sku,
                store_id: result.store_id,
                base_price: result.base_price,
                category_ids,
                tax_category_ids,
                image_count: image_urls?.length || 0,
            });
            return await this.findOne(result.id);
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('El producto ya existe');
                }
                if (error.code === 'P2003') {
                    throw new common_1.BadRequestException('Tienda, categoría o marca no válida');
                }
            }
            throw error;
        }
    }
    async update(id, updateProductDto, userId) {
        try {
            const existingProduct = await this.prisma.products.findUnique({
                where: { id },
                include: {
                    product_categories: {
                        include: { categories: true },
                    },
                    product_tax_assignments: {
                        include: { tax_categories: true },
                    },
                    product_images: true,
                },
            });
            if (!existingProduct) {
                throw new common_1.NotFoundException('Producto no encontrado');
            }
            const slug = updateProductDto.slug ||
                (updateProductDto.name
                    ? (0, slug_util_1.generateSlug)(updateProductDto.name)
                    : existingProduct.slug);
            if (slug !== existingProduct.slug) {
                const existingSlug = await this.prisma.products.findFirst({
                    where: {
                        store_id: existingProduct.store_id,
                        slug: slug,
                        state: { not: dto_1.ProductState.ARCHIVED },
                        id: { not: id },
                    },
                });
                if (existingSlug) {
                    throw new common_1.ConflictException('El slug del producto ya existe en esta tienda');
                }
            }
            if (updateProductDto.sku &&
                updateProductDto.sku !== existingProduct.sku) {
                const existingSku = await this.prisma.products.findFirst({
                    where: {
                        sku: updateProductDto.sku,
                        state: { not: dto_1.ProductState.ARCHIVED },
                        id: { not: id },
                    },
                });
                if (existingSku) {
                    throw new common_1.ConflictException('El SKU ya está en uso');
                }
            }
            const { category_ids, tax_category_ids, image_urls, ...productData } = updateProductDto;
            const result = await this.prisma.$transaction(async (prisma) => {
                const product = await prisma.products.update({
                    where: { id },
                    data: {
                        ...productData,
                        slug: slug,
                        updated_at: new Date(),
                    },
                });
                if (category_ids !== undefined) {
                    await prisma.product_categories.deleteMany({
                        where: { product_id: id },
                    });
                    if (category_ids.length > 0) {
                        await prisma.product_categories.createMany({
                            data: category_ids.map((categoryId) => ({
                                product_id: id,
                                category_id: categoryId,
                            })),
                        });
                    }
                }
                if (tax_category_ids !== undefined) {
                    await prisma.product_tax_assignments.deleteMany({
                        where: { product_id: id },
                    });
                    if (tax_category_ids.length > 0) {
                        await prisma.product_tax_assignments.createMany({
                            data: tax_category_ids.map((taxCategoryId) => ({
                                product_id: id,
                                tax_category_id: taxCategoryId,
                            })),
                        });
                    }
                }
                if (image_urls !== undefined) {
                    await prisma.product_images.deleteMany({
                        where: { product_id: id },
                    });
                    if (image_urls.length > 0) {
                        await prisma.product_images.createMany({
                            data: image_urls.map((url, index) => ({
                                product_id: id,
                                image_url: url,
                                is_main: index === 0,
                            })),
                        });
                    }
                }
                return product;
            });
            const updatedProduct = await this.findOne(result.id);
            await this.auditService.logUpdate(userId, audit_1.AuditResource.PRODUCTS, id, {
                name: existingProduct.name,
                sku: existingProduct.sku,
                base_price: existingProduct.base_price,
                category_ids: existingProduct.product_categories.map((pc) => pc.category_id),
                tax_category_ids: existingProduct.product_tax_assignments.map((pta) => pta.tax_category_id),
                image_count: existingProduct.product_images.length,
            }, {
                name: updatedProduct.name,
                sku: updatedProduct.sku,
                base_price: updatedProduct.base_price,
                category_ids,
                tax_category_ids,
                image_count: image_urls?.length || 0,
            }, {
                updated_fields: Object.keys(updateProductDto),
                store_id: existingProduct.store_id,
            });
            return updatedProduct;
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('El producto ya existe');
                }
                if (error.code === 'P2003') {
                    throw new common_1.BadRequestException('Tienda, categoría o marca no válida');
                }
            }
            throw error;
        }
    }
    async remove(id, userId) {
        try {
            const product = await this.prisma.products.findUnique({
                where: { id },
                include: {
                    product_categories: {
                        include: { categories: true },
                    },
                    product_tax_assignments: {
                        include: { tax_categories: true },
                    },
                    product_images: true,
                },
            });
            if (!product) {
                throw new common_1.NotFoundException('Producto no encontrado');
            }
            const result = await this.prisma.products.update({
                where: { id },
                data: {
                    state: dto_1.ProductState.ARCHIVED,
                    updated_at: new Date(),
                },
            });
            await this.auditService.logDelete(userId, audit_1.AuditResource.PRODUCTS, id, {
                name: product.name,
                sku: product.sku,
                store_id: product.store_id,
                base_price: product.base_price,
                category_ids: product.product_categories.map((pc) => pc.category_id),
                tax_category_ids: product.product_tax_assignments.map((pta) => pta.tax_category_id),
                image_count: product.product_images.length,
            }, { reason: 'archived_by_user' });
            return result;
        }
        catch (error) {
            throw error;
        }
    }
    async findOne(id) {
        const product = await this.prisma.products.findUnique({
            where: { id },
            include: {
                stores: true,
                brands: true,
                product_images: true,
            },
        });
        if (!product) {
            throw new common_1.NotFoundException('Producto no encontrado');
        }
        return product;
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_1.AuditService])
], ProductsService);
//# sourceMappingURL=products.service.audit-example.js.map
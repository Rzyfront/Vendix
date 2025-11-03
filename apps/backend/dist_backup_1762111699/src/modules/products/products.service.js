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
const dto_1 = require("./dto");
const client_1 = require("@prisma/client");
const slug_util_1 = require("../../common/utils/slug.util");
let ProductsService = class ProductsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createProductDto) {
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
    async findAll(query) {
        const { page = 1, limit = 10, search, state, store_id, category_id, brand_id, include_inactive, } = query;
        const skip = (page - 1) * limit;
        const where = {
            state: include_inactive ? undefined : dto_1.ProductState.ACTIVE,
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } },
                ],
            }),
            ...(state && { state }),
            ...(store_id && { store_id }),
            ...(brand_id && { brand_id }),
            ...(category_id && {
                product_categories: {
                    some: { category_id },
                },
            }),
        };
        const [products, total] = await Promise.all([
            this.prisma.products.findMany({
                where,
                skip,
                take: limit,
                include: {
                    stores: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                        },
                    },
                    brands: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    product_categories: {
                        include: {
                            categories: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                    product_images: {
                        where: { is_main: true },
                        take: 1,
                    },
                    _count: {
                        select: {
                            product_variants: true,
                            product_images: true,
                            reviews: true,
                        },
                    },
                },
                orderBy: { created_at: 'desc' },
            }),
            this.prisma.products.count({ where }),
        ]);
        return {
            data: products,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOne(id) {
        const product = await this.prisma.products.findFirst({
            where: {
                id,
                state: { not: dto_1.ProductState.ARCHIVED },
            },
            include: {
                stores: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        organization_id: true,
                    },
                },
                brands: true,
                product_categories: {
                    include: {
                        categories: true,
                    },
                },
                product_tax_assignments: {
                    include: {
                        tax_categories: true,
                    },
                },
                product_images: {
                    orderBy: { is_main: 'desc' },
                },
                product_variants: {
                    include: {
                        product_images: true,
                    },
                },
                reviews: {
                    where: { state: 'approved' },
                    include: {
                        users: {
                            select: {
                                id: true,
                                first_name: true,
                                last_name: true,
                            },
                        },
                    },
                    orderBy: { created_at: 'desc' },
                    take: 10,
                },
                _count: {
                    select: {
                        product_variants: true,
                        product_images: true,
                        reviews: true,
                    },
                },
            },
        });
        if (!product) {
            throw new common_1.NotFoundException('Producto no encontrado');
        }
        return product;
    }
    async findBySlug(storeId, slug) {
        const product = await this.prisma.products.findFirst({
            where: {
                store_id: storeId,
                slug,
                state: dto_1.ProductState.ACTIVE,
            },
            include: {
                stores: true,
                brands: true,
                product_images: true,
                product_variants: true,
            },
        });
        if (!product) {
            throw new common_1.NotFoundException('Producto no encontrado');
        }
        return product;
    }
    async update(id, updateProductDto) {
        try {
            const existingProduct = await this.prisma.products.findFirst({
                where: {
                    id,
                    state: { not: dto_1.ProductState.ARCHIVED },
                },
            });
            if (!existingProduct) {
                throw new common_1.NotFoundException('Producto no encontrado');
            }
            if (updateProductDto.slug) {
                const existingSlug = await this.prisma.products.findFirst({
                    where: {
                        store_id: existingProduct.store_id,
                        slug: updateProductDto.slug,
                        state: { not: dto_1.ProductState.ARCHIVED },
                        NOT: { id },
                    },
                });
                if (existingSlug) {
                    throw new common_1.ConflictException('El slug ya está en uso en esta tienda');
                }
            }
            if (updateProductDto.sku) {
                const existingSku = await this.prisma.products.findFirst({
                    where: {
                        sku: updateProductDto.sku,
                        state: { not: dto_1.ProductState.ARCHIVED },
                        NOT: { id },
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
            return await this.findOne(result.id);
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('Conflicto de datos únicos');
                }
                if (error.code === 'P2003') {
                    throw new common_1.BadRequestException('Categoría o marca no válida');
                }
            }
            throw error;
        }
    }
    async deactivate(id) {
        const existingProduct = await this.prisma.products.findFirst({
            where: {
                id,
                state: { not: dto_1.ProductState.ARCHIVED },
            },
        });
        if (!existingProduct) {
            throw new common_1.NotFoundException('Producto no encontrado');
        }
        return await this.prisma.products.update({
            where: { id },
            data: {
                state: dto_1.ProductState.INACTIVE,
                updated_at: new Date(),
            },
        });
    }
    async remove(id) {
        try {
            await this.findOne(id);
            const relatedOrders = await this.prisma.order_items.count({
                where: { product_id: id },
            });
            if (relatedOrders > 0) {
                throw new common_1.BadRequestException('No se puede eliminar el producto porque tiene órdenes relacionadas. Use borrado lógico.');
            }
            return await this.prisma.products.delete({
                where: { id },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2003') {
                    throw new common_1.BadRequestException('No se puede eliminar el producto porque tiene datos relacionados');
                }
            }
            throw error;
        }
    }
    async getProductsByStore(storeId) {
        return await this.prisma.products.findMany({
            where: {
                store_id: storeId,
                state: dto_1.ProductState.ACTIVE,
            },
            include: {
                brands: true,
                product_images: {
                    where: { is_main: true },
                    take: 1,
                },
                _count: {
                    select: {
                        product_variants: true,
                        reviews: true,
                    },
                },
            },
            orderBy: { created_at: 'desc' },
        });
    }
    async createVariant(createVariantDto) {
        try {
            const product = await this.prisma.products.findFirst({
                where: {
                    id: createVariantDto.product_id,
                    state: dto_1.ProductState.ACTIVE,
                },
            });
            if (!product) {
                throw new common_1.BadRequestException('Producto no encontrado o inactivo');
            }
            const existingSku = await this.prisma.product_variants.findUnique({
                where: { sku: createVariantDto.sku },
            });
            if (existingSku) {
                throw new common_1.ConflictException('El SKU de la variante ya está en uso');
            }
            return await this.prisma.product_variants.create({
                data: {
                    ...createVariantDto,
                    updated_at: new Date(),
                },
                include: {
                    products: true,
                    product_images: true,
                },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('El SKU de la variante ya existe');
                }
            }
            throw error;
        }
    }
    async updateVariant(variantId, updateVariantDto) {
        try {
            const existingVariant = await this.prisma.product_variants.findUnique({
                where: { id: variantId },
            });
            if (!existingVariant) {
                throw new common_1.NotFoundException('Variante no encontrada');
            }
            if (updateVariantDto.sku) {
                const existingSku = await this.prisma.product_variants.findFirst({
                    where: {
                        sku: updateVariantDto.sku,
                        NOT: { id: variantId },
                    },
                });
                if (existingSku) {
                    throw new common_1.ConflictException('El SKU ya está en uso');
                }
            }
            return await this.prisma.product_variants.update({
                where: { id: variantId },
                data: {
                    ...updateVariantDto,
                    updated_at: new Date(),
                },
                include: {
                    products: true,
                    product_images: true,
                },
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') {
                    throw new common_1.ConflictException('Conflicto de datos únicos');
                }
            }
            throw error;
        }
    }
    async removeVariant(variantId) {
        const existingVariant = await this.prisma.product_variants.findUnique({
            where: { id: variantId },
        });
        if (!existingVariant) {
            throw new common_1.NotFoundException('Variante no encontrada');
        }
        return await this.prisma.product_variants.delete({
            where: { id: variantId },
        });
    }
    async addImage(productId, imageDto) {
        const product = await this.prisma.products.findFirst({
            where: {
                id: productId,
                state: dto_1.ProductState.ACTIVE,
            },
        });
        if (!product) {
            throw new common_1.BadRequestException('Producto no encontrado o inactivo');
        }
        if (imageDto.is_main) {
            await this.prisma.product_images.updateMany({
                where: { product_id: productId },
                data: { is_main: false },
            });
        }
        return await this.prisma.product_images.create({
            data: {
                product_id: productId,
                ...imageDto,
            },
        });
    }
    async removeImage(imageId) {
        const existingImage = await this.prisma.product_images.findUnique({
            where: { id: imageId },
        });
        if (!existingImage) {
            throw new common_1.NotFoundException('Imagen no encontrada');
        }
        return await this.prisma.product_images.delete({
            where: { id: imageId },
        });
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map
import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { CatalogQueryDto, ProductSortBy } from './dto/catalog-query.dto';

@Injectable()
export class CatalogService {
    constructor(private readonly prisma: GlobalPrismaService) { }

    async getProducts(store_id: number, query: CatalogQueryDto) {
        const {
            search,
            category_id,
            brand_id,
            min_price,
            max_price,
            sort_by = ProductSortBy.NEWEST,
            page = 1,
            limit = 20,
        } = query;

        const skip = (page - 1) * limit;

        const where: any = {
            store_id,
            state: 'active',
            available_for_ecommerce: true,
        };

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (category_id) {
            where.product_categories = {
                some: { category_id },
            };
        }

        if (brand_id) {
            where.brand_id = brand_id;
        }

        if (min_price !== undefined) {
            where.base_price = { ...where.base_price, gte: min_price };
        }
        if (max_price !== undefined) {
            where.base_price = { ...where.base_price, lte: max_price };
        }

        let orderBy: any;
        switch (sort_by) {
            case ProductSortBy.NAME:
                orderBy = { name: 'asc' };
                break;
            case ProductSortBy.PRICE_ASC:
                orderBy = { base_price: 'asc' };
                break;
            case ProductSortBy.PRICE_DESC:
                orderBy = { base_price: 'desc' };
                break;
            case ProductSortBy.NEWEST:
            default:
                orderBy = { created_at: 'desc' };
        }

        const [data, total] = await Promise.all([
            this.prisma.products.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy,
                include: {
                    product_images: {
                        where: { is_main: true },
                        take: 1,
                    },
                    brands: {
                        select: { id: true, name: true },
                    },
                    product_categories: {
                        include: {
                            categories: {
                                select: { id: true, name: true, slug: true },
                            },
                        },
                    },
                },
            }),
            this.prisma.products.count({ where }),
        ]);

        return {
            data: data.map((product) => this.mapProductToResponse(product)),
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                total_pages: Math.ceil(total / Number(limit)),
            },
        };
    }

    async getProductBySlug(store_id: number, slug: string) {
        const product = await this.prisma.products.findFirst({
            where: {
                store_id,
                slug,
                state: 'active',
                available_for_ecommerce: true,
            },
            include: {
                product_images: {
                    orderBy: { sort_order: 'asc' },
                },
                brands: true,
                product_categories: {
                    include: {
                        categories: true,
                    },
                },
                product_variants: {
                    where: { stock_quantity: { gt: 0 } },
                },
                reviews: {
                    where: { state: 'approved' },
                    include: {
                        users: {
                            select: { first_name: true, last_name: true },
                        },
                    },
                    orderBy: { created_at: 'desc' },
                    take: 10,
                },
            },
        });

        if (!product) {
            throw new NotFoundException('Product not found');
        }

        return this.mapProductDetailToResponse(product);
    }

    async getCategories(store_id: number) {
        const categories = await this.prisma.categories.findMany({
            where: {
                store_id,
                state: 'active',
            },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                image_url: true,
            },
        });

        return categories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description,
            image_url: cat.image_url,
        }));
    }

    async getBrands(store_id: number) {
        const brands = await this.prisma.brands.findMany({
            where: {
                state: 'active',
                products: {
                    some: {
                        store_id,
                        state: 'active',
                        available_for_ecommerce: true,
                    },
                },
            },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                logo_url: true,
            },
        });

        return brands;
    }

    private mapProductToResponse(product: any) {
        return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            base_price: product.base_price,
            sku: product.sku,
            stock_quantity: product.stock_quantity,
            image_url: product.product_images?.[0]?.image_url || null,
            brand: product.brands,
            categories: product.product_categories?.map((pc: any) => pc.categories) || [],
        };
    }

    private mapProductDetailToResponse(product: any) {
        const reviews = product.reviews || [];
        const avg_rating = reviews.length > 0
            ? reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviews.length
            : 0;

        return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            base_price: product.base_price,
            sku: product.sku,
            stock_quantity: product.stock_quantity,
            images: product.product_images,
            brand: product.brands,
            categories: product.product_categories?.map((pc: any) => pc.categories) || [],
            variants: product.product_variants || [],
            reviews: reviews.map((r: any) => ({
                id: r.id,
                rating: r.rating,
                comment: r.comment,
                created_at: r.created_at,
                user_name: `${r.users?.first_name || ''} ${r.users?.last_name || ''}`.trim(),
            })),
            avg_rating: Math.round(avg_rating * 10) / 10,
            review_count: reviews.length,
        };
    }
}

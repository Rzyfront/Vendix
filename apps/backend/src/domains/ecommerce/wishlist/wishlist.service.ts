import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AddToWishlistDto } from './dto/wishlist.dto';

@Injectable()
export class WishlistService {
    constructor(private readonly prisma: GlobalPrismaService) { }

    async getWishlist(store_id: number, user_id: number) {
        let wishlist = await this.prisma.wishlists.findUnique({
            where: {
                store_id_user_id: { store_id, user_id },
            },
            include: {
                wishlist_items: {
                    include: {
                        product: {
                            include: {
                                product_images: {
                                    where: { is_main: true },
                                    take: 1,
                                },
                            },
                        },
                        product_variant: true,
                    },
                },
            },
        });

        if (!wishlist) {
            wishlist = await this.prisma.wishlists.create({
                data: { store_id, user_id },
                include: {
                    wishlist_items: {
                        include: {
                            product: {
                                include: {
                                    product_images: {
                                        where: { is_main: true },
                                        take: 1,
                                    },
                                },
                            },
                            product_variant: true,
                        },
                    },
                },
            });
        }

        return this.mapWishlistToResponse(wishlist);
    }

    async addItem(store_id: number, user_id: number, dto: AddToWishlistDto) {
        // Validate product exists and is available for ecommerce
        const product = await this.prisma.products.findFirst({
            where: {
                id: dto.product_id,
                store_id,
                state: 'active',
                available_for_ecommerce: true,
            },
        });

        if (!product) {
            throw new NotFoundException('Product not available');
        }

        // Get or create wishlist
        let wishlist = await this.prisma.wishlists.findUnique({
            where: { store_id_user_id: { store_id, user_id } },
        });

        if (!wishlist) {
            wishlist = await this.prisma.wishlists.create({
                data: { store_id, user_id },
            });
        }

        // Check if already in wishlist
        const existing = dto.product_variant_id
            ? await this.prisma.wishlist_items.findUnique({
                where: {
                    wishlist_id_product_id_product_variant_id: {
                        wishlist_id: wishlist.id,
                        product_id: dto.product_id,
                        product_variant_id: dto.product_variant_id,
                    },
                },
            })
            : await this.prisma.wishlist_items.findFirst({
                where: {
                    wishlist_id: wishlist.id,
                    product_id: dto.product_id,
                    product_variant_id: null,
                },
            });

        if (existing) {
            throw new ConflictException('Product already in wishlist');
        }

        await this.prisma.wishlist_items.create({
            data: {
                wishlist_id: wishlist.id,
                product_id: dto.product_id,
                product_variant_id: dto.product_variant_id,
            },
        });

        return this.getWishlist(store_id, user_id);
    }

    async removeItem(store_id: number, user_id: number, product_id: number) {
        const wishlist = await this.prisma.wishlists.findUnique({
            where: { store_id_user_id: { store_id, user_id } },
        });

        if (!wishlist) {
            throw new NotFoundException('Wishlist not found');
        }

        const item = await this.prisma.wishlist_items.findFirst({
            where: {
                wishlist_id: wishlist.id,
                product_id,
            },
        });

        if (!item) {
            throw new NotFoundException('Item not in wishlist');
        }

        await this.prisma.wishlist_items.delete({
            where: { id: item.id },
        });

        return this.getWishlist(store_id, user_id);
    }

    async checkInWishlist(store_id: number, user_id: number, product_id: number) {
        const wishlist = await this.prisma.wishlists.findUnique({
            where: { store_id_user_id: { store_id, user_id } },
        });

        if (!wishlist) {
            return { in_wishlist: false };
        }

        const item = await this.prisma.wishlist_items.findFirst({
            where: {
                wishlist_id: wishlist.id,
                product_id,
            },
        });

        return { in_wishlist: !!item };
    }

    private mapWishlistToResponse(wishlist: any) {
        const items = wishlist.wishlist_items.map((item: any) => ({
            id: item.id,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            added_at: item.added_at,
            product: {
                id: item.product.id,
                name: item.product.name,
                slug: item.product.slug,
                base_price: item.product.base_price,
                sku: item.product.sku,
                stock_quantity: item.product.stock_quantity,
                image_url: item.product.product_images?.[0]?.image_url || null,
            },
            variant: item.product_variant
                ? {
                    name: item.product_variant.name,
                    sku: item.product_variant.sku,
                    price_override: item.product_variant.price_override,
                    attributes: item.product_variant.attributes,
                }
                : null,
        }));

        return {
            id: wishlist.id,
            item_count: items.length,
            items,
        };
    }
}

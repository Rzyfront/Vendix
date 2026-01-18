import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { AddToCartDto, UpdateCartItemDto, SyncCartDto } from './dto/cart.dto';

@Injectable()
export class CartService {
    constructor(private readonly prisma: EcommercePrismaService) { }

    async getCart() {
        // store_id y user_id se aplican automáticamente por EcommercePrismaService
        let cart = await this.prisma.carts.findFirst({
            include: {
                cart_items: {
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

        if (!cart) {
            cart = await this.prisma.carts.create({
                data: {
                    currency: 'USD',
                    // store_id y user_id se inyectan automáticamente
                },
                include: {
                    cart_items: {
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

        return this.mapCartToResponse(cart);
    }

    async addItem(dto: AddToCartDto) {
        // Verificar que el producto existe y está disponible
        // store_id se aplica automáticamente
        const product = await this.prisma.products.findFirst({
            where: {
                id: dto.product_id,
                state: 'active',
                available_for_ecommerce: true,
            },
        });

        if (!product) {
            throw new NotFoundException('Product not available');
        }

        let available_stock = product.stock_quantity || 0;
        let unit_price = product.base_price;

        if (dto.product_variant_id) {
            const variant = await this.prisma.product_variants.findUnique({
                where: { id: dto.product_variant_id },
            });
            if (!variant || variant.product_id !== dto.product_id) {
                throw new BadRequestException('Invalid product variant');
            }
            available_stock = variant.stock_quantity || 0;
            if (variant.price_override) {
                unit_price = variant.price_override;
            }
        }

        if (dto.quantity > available_stock) {
            throw new BadRequestException(`Only ${available_stock} units available`);
        }

        // Buscar o crear el cart del usuario (store_id y user_id se aplican automáticamente)
        let cart = await this.prisma.carts.findFirst({});

        if (!cart) {
            cart = await this.prisma.carts.create({
                data: { currency: 'USD' },
            });
        }

        const existing_item = dto.product_variant_id
            ? await this.prisma.cart_items.findUnique({
                where: {
                    cart_id_product_id_product_variant_id: {
                        cart_id: cart.id,
                        product_id: dto.product_id,
                        product_variant_id: dto.product_variant_id,
                    },
                },
            })
            : await this.prisma.cart_items.findFirst({
                where: {
                    cart_id: cart.id,
                    product_id: dto.product_id,
                    product_variant_id: null,
                },
            });

        if (existing_item) {
            const new_quantity = existing_item.quantity + dto.quantity;
            if (new_quantity > available_stock) {
                throw new BadRequestException(`Only ${available_stock} units available`);
            }

            await this.prisma.cart_items.update({
                where: { id: existing_item.id },
                data: { quantity: new_quantity },
            });
        } else {
            await this.prisma.cart_items.create({
                data: {
                    cart_id: cart.id,
                    product_id: dto.product_id,
                    product_variant_id: dto.product_variant_id,
                    quantity: dto.quantity,
                    unit_price,
                },
            });
        }

        await this.updateCartSubtotal(cart.id);
        return this.getCart();
    }

    async updateItem(item_id: number, dto: UpdateCartItemDto) {
        const cart = await this.prisma.carts.findFirst({});

        if (!cart) {
            throw new NotFoundException('Cart not found');
        }

        const item = await this.prisma.cart_items.findFirst({
            where: { id: item_id, cart_id: cart.id },
            include: { product: true, product_variant: true },
        });

        if (!item) {
            throw new NotFoundException('Cart item not found');
        }

        const available_stock = item.product_variant?.stock_quantity ?? item.product.stock_quantity ?? 0;
        if (dto.quantity > available_stock) {
            throw new BadRequestException(`Only ${available_stock} units available`);
        }

        await this.prisma.cart_items.update({
            where: { id: item_id },
            data: { quantity: dto.quantity },
        });

        await this.updateCartSubtotal(cart.id);
        return this.getCart();
    }

    async removeItem(item_id: number) {
        const cart = await this.prisma.carts.findFirst({});

        if (!cart) {
            throw new NotFoundException('Cart not found');
        }

        const item = await this.prisma.cart_items.findFirst({
            where: { id: item_id, cart_id: cart.id },
        });

        if (!item) {
            throw new NotFoundException('Cart item not found');
        }

        await this.prisma.cart_items.delete({
            where: { id: item_id },
        });

        await this.updateCartSubtotal(cart.id);
        return this.getCart();
    }

    async clearCart() {
        const cart = await this.prisma.carts.findFirst({});

        if (cart) {
            await this.prisma.cart_items.deleteMany({
                where: { cart_id: cart.id },
            });

            await this.prisma.carts.update({
                where: { id: cart.id },
                data: { subtotal: 0 },
            });
        }

        return { success: true, message: 'Cart cleared' };
    }

    async syncFromLocalStorage(dto: SyncCartDto) {
        await this.clearCart();

        for (const item of dto.items) {
            try {
                await this.addItem({
                    product_id: item.product_id,
                    product_variant_id: item.product_variant_id,
                    quantity: item.quantity,
                });
            } catch {
                // Skip invalid items during sync
            }
        }

        return this.getCart();
    }

    private async updateCartSubtotal(cart_id: number) {
        const items = await this.prisma.cart_items.findMany({
            where: { cart_id },
        });

        const subtotal = items.reduce((sum, item) => {
            return sum + Number(item.unit_price) * item.quantity;
        }, 0);

        await this.prisma.carts.update({
            where: { id: cart_id },
            data: { subtotal, updated_at: new Date() },
        });
    }

    private mapCartToResponse(cart: any) {
        const items = cart.cart_items.map((item: any) => ({
            id: item.id,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: Number(item.unit_price) * item.quantity,
            product: {
                name: item.product.name,
                slug: item.product.slug,
                sku: item.product.sku,
                image_url: item.product.product_images?.[0]?.image_url || null,
            },
            variant: item.product_variant
                ? {
                    name: item.product_variant.name,
                    sku: item.product_variant.sku,
                    attributes: item.product_variant.attributes,
                }
                : null,
        }));

        return {
            id: cart.id,
            currency: cart.currency,
            subtotal: cart.subtotal,
            item_count: items.reduce((sum: number, i: any) => sum + i.quantity, 0),
            items,
        };
    }
}

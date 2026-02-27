import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { AddToCartDto, UpdateCartItemDto, SyncCartDto } from './dto/cart.dto';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../store/settings/settings.service';

@Injectable()
export class CartService {
    constructor(
        private readonly prisma: EcommercePrismaService,
        private readonly s3Service: S3Service,
        private readonly settingsService: SettingsService,
    ) { }

    private readonly cartInclude = {
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
                product_variant: {
                    include: { product_images: true },
                },
            },
        },
    };

    async getCart() {
        // store_id y user_id se aplican automáticamente por EcommercePrismaService
        let cart = await this.prisma.carts.findFirst({
            include: this.cartInclude,
        });

        if (!cart) {
            const currency = await this.settingsService.getStoreCurrency();
            cart = await this.prisma.carts.create({
                data: {
                    currency,
                    // store_id y user_id se inyectan automáticamente
                },
                include: this.cartInclude,
            });
        }

        return await this.mapCartToResponse(cart);
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

        // Validate: if product has variants, a variant must be selected
        const variantCount = await this.prisma.product_variants.count({
            where: { product_id: dto.product_id },
        });

        if (variantCount > 0 && !dto.product_variant_id) {
            throw new BadRequestException(
                'Este producto requiere selección de variante',
            );
        }

        let available_stock = product.stock_quantity || 0;
        let variant: any = null;

        if (dto.product_variant_id) {
            variant = await this.prisma.product_variants.findUnique({
                where: { id: dto.product_variant_id },
            });
            if (!variant || variant.product_id !== dto.product_id) {
                throw new BadRequestException('Invalid product variant');
            }
            available_stock = variant.stock_quantity || 0;
        }

        if (product.track_inventory && dto.quantity > available_stock) {
            throw new BadRequestException(`Only ${available_stock} units available`);
        }

        // Fetch product with taxes for price calculation
        const productWithTaxes = await this.prisma.products.findUnique({
            where: { id: dto.product_id },
            include: {
                product_tax_assignments: {
                    include: {
                        tax_categories: {
                            include: {
                                tax_rates: true,
                            },
                        },
                    },
                },
            },
        });

        const unit_price = this.calculateFinalPrice(productWithTaxes, variant);

        // Buscar o crear el cart del usuario (store_id y user_id se aplican automáticamente)
        let cart = await this.prisma.carts.findFirst({});

        if (!cart) {
            const currency = await this.settingsService.getStoreCurrency();
            cart = await this.prisma.carts.create({
                data: { currency },
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
            if (product.track_inventory && new_quantity > available_stock) {
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

        if (item.product.track_inventory) {
            const available_stock = item.product_variant?.stock_quantity ?? item.product.stock_quantity ?? 0;
            if (dto.quantity > available_stock) {
                throw new BadRequestException(`Only ${available_stock} units available`);
            }
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

    private async mapCartToResponse(cart: any) {
        const items = await Promise.all(
            cart.cart_items.map(async (item: any) => {
                // Use variant image if available, fallback to product main image
                const variant_image_url = item.product_variant?.product_images?.image_url || null;
                const product_image_url = item.product.product_images?.[0]?.image_url || null;
                const raw_image_url = variant_image_url || product_image_url;
                const signed_image_url = await this.s3Service.signUrl(raw_image_url);

                return {
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
                        image_url: signed_image_url || null,
                        weight: Number(item.product.weight || 0),
                    },
                    variant: item.product_variant
                        ? {
                            name: item.product_variant.name,
                            sku: item.product_variant.sku,
                            attributes: item.product_variant.attributes,
                        }
                        : null,
                    final_price: item.unit_price,
                };
            }),
        );

        return {
            id: cart.id,
            currency: cart.currency,
            subtotal: Number(cart.subtotal),
            item_count: items.reduce((sum: number, i: any) => sum + i.quantity, 0),
            items,
        };
    }

    /**
     * Calculates the effective base price for a product, considering variant overrides.
     * Pricing hierarchy: variant.price_override > product.sale_price (if on sale) > product.base_price
     */
    private getEffectiveBasePrice(product: any, variant?: any): number {
        if (variant?.price_override) {
            return Number(variant.price_override);
        }
        return product.is_on_sale && product.sale_price
            ? Number(product.sale_price)
            : Number(product.base_price);
    }

    /**
     * Calculates the sum of tax rates for a product.
     * Tax rates are stored as decimals in DB (e.g., 0.19 for 19%).
     */
    private getTotalTaxRate(product: any): number {
        let totalTaxRate = 0;
        if (product.product_tax_assignments) {
            for (const assignment of product.product_tax_assignments) {
                if (assignment.tax_categories?.tax_rates) {
                    for (const tax of assignment.tax_categories.tax_rates) {
                        totalTaxRate += Number(tax.rate);
                    }
                }
            }
        }
        return totalTaxRate;
    }

    /**
     * Calculates the final price of a product including taxes and active offers.
     * Supports variant price overrides.
     */
    private calculateFinalPrice(product: any, variant?: any): number {
        const basePrice = this.getEffectiveBasePrice(product, variant);
        const totalTaxRate = this.getTotalTaxRate(product);
        const finalPrice = basePrice * (1 + totalTaxRate);
        return Math.round(finalPrice * 100) / 100;
    }
}

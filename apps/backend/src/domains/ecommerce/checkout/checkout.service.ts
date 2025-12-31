import { Injectable, BadRequestException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { CartService } from '../cart/cart.service';
import { CheckoutDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
    constructor(
        private readonly prisma: GlobalPrismaService,
        private readonly cart_service: CartService,
    ) { }

    async getPaymentMethods(store_id: number) {
        const methods = await this.prisma.store_payment_methods.findMany({
            where: {
                store_id,
                state: 'enabled',
            },
            include: {
                system_payment_method: true,
            },
            orderBy: { display_order: 'asc' },
        });

        return methods.map((m) => ({
            id: m.id,
            name: m.display_name || m.system_payment_method.display_name,
            type: m.system_payment_method.type,
            provider: m.system_payment_method.provider,
            logo_url: m.system_payment_method.logo_url,
            min_amount: m.min_amount,
            max_amount: m.max_amount,
        }));
    }

    async checkout(store_id: number, user_id: number, dto: CheckoutDto) {
        const cart = await this.prisma.carts.findUnique({
            where: { store_id_user_id: { store_id, user_id } },
            include: {
                cart_items: {
                    include: {
                        product: true,
                        product_variant: true,
                    },
                },
            },
        });

        if (!cart || cart.cart_items.length === 0) {
            throw new BadRequestException('Cart is empty');
        }

        const payment_method = await this.prisma.store_payment_methods.findFirst({
            where: {
                id: dto.payment_method_id,
                store_id,
                state: 'enabled',
            },
            include: { system_payment_method: true },
        });

        if (!payment_method) {
            throw new BadRequestException('Invalid payment method');
        }

        for (const item of cart.cart_items) {
            const available = item.product_variant?.stock_quantity ?? item.product.stock_quantity ?? 0;
            if (item.quantity > available) {
                throw new BadRequestException(
                    `Insufficient stock for ${item.product.name}. Only ${available} available.`,
                );
            }
        }

        let shipping_address_id = dto.shipping_address_id;
        let shipping_address_snapshot: any = null;

        if (dto.shipping_address && !shipping_address_id) {
            const new_address = await this.prisma.addresses.create({
                data: {
                    user_id,
                    address_line1: dto.shipping_address.address_line1,
                    address_line2: dto.shipping_address.address_line2,
                    city: dto.shipping_address.city,
                    state_province: dto.shipping_address.state_province,
                    country_code: dto.shipping_address.country_code,
                    postal_code: dto.shipping_address.postal_code,
                    phone_number: dto.shipping_address.phone_number,
                    type: 'shipping',
                },
            });
            shipping_address_id = new_address.id;
            shipping_address_snapshot = dto.shipping_address;
        } else if (shipping_address_id) {
            const address = await this.prisma.addresses.findUnique({
                where: { id: shipping_address_id },
            });
            if (address) {
                shipping_address_snapshot = {
                    address_line1: address.address_line1,
                    address_line2: address.address_line2,
                    city: address.city,
                    state_province: address.state_province,
                    country_code: address.country_code,
                    postal_code: address.postal_code,
                    phone_number: address.phone_number,
                };
            }
        }

        const order_number = await this.generateOrderNumber(store_id);

        const subtotal = cart.cart_items.reduce((sum, item) => {
            return sum + Number(item.unit_price) * item.quantity;
        }, 0);

        const order = await this.prisma.orders.create({
            data: {
                store_id,
                customer_id: user_id,
                order_number,
                currency: cart.currency,
                subtotal_amount: subtotal,
                grand_total: subtotal,
                shipping_address_id,
                shipping_address_snapshot,
                state: 'pending_payment',
                internal_notes: dto.notes,
                placed_at: new Date(),
                order_items: {
                    create: cart.cart_items.map((item) => ({
                        product_id: item.product_id,
                        product_variant_id: item.product_variant_id,
                        product_name: item.product.name,
                        variant_sku: item.product_variant?.sku,
                        variant_attributes: item.product_variant?.attributes
                            ? JSON.stringify(item.product_variant.attributes)
                            : null,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        total_price: Number(item.unit_price) * item.quantity,
                    })),
                },
            },
            include: {
                order_items: true,
            },
        });

        await this.prisma.payments.create({
            data: {
                order_id: order.id,
                customer_id: user_id,
                amount: subtotal,
                currency: cart.currency,
                state: 'pending',
                store_payment_method_id: dto.payment_method_id,
            },
        });

        for (const item of cart.cart_items) {
            if (item.product_variant_id) {
                await this.prisma.product_variants.update({
                    where: { id: item.product_variant_id },
                    data: {
                        stock_quantity: { decrement: item.quantity },
                    },
                });
            } else {
                await this.prisma.products.update({
                    where: { id: item.product_id },
                    data: {
                        stock_quantity: { decrement: item.quantity },
                    },
                });
            }
        }

        await this.cart_service.clearCart(store_id, user_id);

        return {
            order_id: order.id,
            order_number: order.order_number,
            total: order.grand_total,
            state: order.state,
            message: 'Order placed successfully',
        };
    }

    private async generateOrderNumber(store_id: number): Promise<string> {
        const store = await this.prisma.stores.findUnique({
            where: { id: store_id },
            select: { store_code: true },
        });

        const store_code = store?.store_code || 'EC';
        const date = new Date();
        const date_str = date.toISOString().slice(2, 10).replace(/-/g, '');

        const start_of_day = new Date(date);
        start_of_day.setHours(0, 0, 0, 0);
        const end_of_day = new Date(date);
        end_of_day.setHours(23, 59, 59, 999);

        const count = await this.prisma.orders.count({
            where: {
                store_id,
                created_at: {
                    gte: start_of_day,
                    lte: end_of_day,
                },
            },
        });

        const sequence = String(count + 1).padStart(4, '0');
        return `${store_code}-${date_str}-${sequence}`;
    }
}

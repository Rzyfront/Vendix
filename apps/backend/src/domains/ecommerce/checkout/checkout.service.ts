import { Injectable, BadRequestException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CartService } from '../cart/cart.service';
import { CheckoutDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
    constructor(
        private readonly prisma: EcommercePrismaService,
        private readonly cart_service: CartService,
    ) { }

    async getPaymentMethods() {
        // store_id se aplica automáticamente por EcommercePrismaService
        const methods = await this.prisma.store_payment_methods.findMany({
            where: {
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

    async checkout(dto: CheckoutDto) {
        // store_id y user_id se aplican automáticamente por EcommercePrismaService
        const cart = await this.prisma.carts.findFirst({
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

        // store_id se aplica automáticamente
        const payment_method = await this.prisma.store_payment_methods.findFirst({
            where: {
                id: dto.payment_method_id,
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
            // user_id se inyecta automáticamente
            const new_address = await this.prisma.addresses.create({
                data: {
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

        const order_number = await this.generateOrderNumber();

        const subtotal = cart.cart_items.reduce((sum, item) => {
            return sum + Number(item.unit_price) * item.quantity;
        }, 0);

        // store_id y customer_id (user_id) se inyectan automáticamente
        const order = await this.prisma.orders.create({
            data: {
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

        // store_id y customer_id se inyectan automáticamente
        await this.prisma.payments.create({
            data: {
                order_id: order.id,
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

        // store_id y user_id se resuelven automáticamente
        await this.cart_service.clearCart();

        return {
            order_id: order.id,
            order_number: order.order_number,
            total: order.grand_total,
            state: order.state,
            message: 'Order placed successfully',
        };
    }

    private async generateOrderNumber(): Promise<string> {
        // Obtener store_id del contexto
        const domain_context = RequestContextService.getDomainContext();
        const store_id = domain_context?.store_id;

        if (!store_id) {
            throw new BadRequestException('Store context required');
        }

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

        // store_id se aplica automáticamente
        const count = await this.prisma.orders.count({
            where: {
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

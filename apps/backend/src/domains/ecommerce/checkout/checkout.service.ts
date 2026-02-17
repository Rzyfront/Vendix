import { Injectable, BadRequestException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CartService } from '../cart/cart.service';
import { TaxesService } from '../../store/taxes/taxes.service';
import { CheckoutDto } from './dto/checkout.dto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { payment_processing_mode_enum } from '@prisma/client';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly store_prisma: StorePrismaService,
    private readonly cart_service: CartService,
    private readonly taxes_service: TaxesService,
  ) { }

  async getPaymentMethods(shippingMethodType?: string) {
    // Determine allowed processing modes based on shipping method type
    // - pickup: DIRECT (cash at store) + ONLINE (online payments)
    // - delivery/carrier/own_fleet: ONLINE + ON_DELIVERY (pay on delivery)
    let allowedModes: payment_processing_mode_enum[];

    if (shippingMethodType === 'pickup') {
      allowedModes = [
        payment_processing_mode_enum.DIRECT,
        payment_processing_mode_enum.ONLINE,
      ];
    } else if (shippingMethodType) {
      // For delivery methods (own_fleet, carrier, custom, third_party_provider)
      allowedModes = [
        payment_processing_mode_enum.ONLINE,
        payment_processing_mode_enum.ON_DELIVERY,
      ];
    } else {
      // No shipping type specified - return all methods (backwards compatibility)
      allowedModes = [
        payment_processing_mode_enum.DIRECT,
        payment_processing_mode_enum.ONLINE,
        payment_processing_mode_enum.ON_DELIVERY,
      ];
    }

    // store_id se aplica automáticamente por EcommercePrismaService
    const methods = await this.prisma.store_payment_methods.findMany({
      where: {
        state: 'enabled',
        system_payment_method: {
          processing_mode: { in: allowedModes },
        },
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
      processing_mode: m.system_payment_method.processing_mode,
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
      const available =
        item.product_variant?.stock_quantity ??
        item.product.stock_quantity ??
        0;
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

    // Validar y calcular shipping
    const store_id = RequestContextService.getStoreId();
    let shipping_cost = 0;
    let shipping_method_id: number | null = null;
    let shipping_rate_id: number | null = null;
    let delivery_type: 'pickup' | 'home_delivery' | 'direct_delivery' | 'other' = 'direct_delivery';

    if (dto.shipping_rate_id) {
      const rate = await this.store_prisma.shipping_rates.findFirst({
        where: {
          id: dto.shipping_rate_id,
          is_active: true
        },
        include: {
          shipping_method: true,
          shipping_zone: true
        }
      });

      if (!rate) {
        throw new BadRequestException('Método de envío inválido o no disponible');
      }

      // Verificar que la zona pertenece a la tienda
      if (rate.shipping_zone.store_id !== store_id) {
        throw new BadRequestException('Método de envío no disponible para esta tienda');
      }

      shipping_cost = Number(rate.base_cost);
      shipping_method_id = rate.shipping_method_id;
      shipping_rate_id = rate.id;

      // Derive delivery_type from shipping method type
      const methodType = rate.shipping_method.type;
      if (methodType === 'pickup') {
        delivery_type = 'pickup';
      } else if (methodType === 'carrier' || methodType === 'third_party_provider') {
        delivery_type = 'home_delivery';
      } else {
        delivery_type = 'direct_delivery';
      }
    } else if (dto.shipping_method_id) {
      // Fallback: si solo viene shipping_method_id sin rate
      const method = await this.store_prisma.shipping_methods.findFirst({
        where: {
          id: dto.shipping_method_id,
          store_id: store_id,
          is_active: true
        }
      });

      if (!method) {
        throw new BadRequestException('Método de envío inválido');
      }

      shipping_method_id = method.id;
      // En este caso, shipping_cost queda en 0 o se debería recalcular
    }

    const order_number = await this.generateOrderNumber();

    const itemsWithTaxes = await Promise.all(
      cart.cart_items.map(async (item) => {
        const taxInfo = await this.taxes_service.calculateProductTaxes(
          item.product_id,
          Number(item.unit_price) / (1 + 0), // Base price logic needs refinement if stored unit_price already includes tax
        );

        // NOTE: In this codebase, calculateFinalPrice (CartService) seems to include tax in unit_price.
        // We need to extract the base price (excluding tax) to calculate tax_amount correctly.
        // For simplicity and correctness with calculateProductTaxes:
        const productWithTaxes = await this.prisma.products.findUnique({
          where: { id: item.product_id },
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

        // Sum rates to reverse engineer base price if needed, or better:
        // Use product base_price (or sale_price) directly as the net price.
        const netPrice = productWithTaxes.is_on_sale && productWithTaxes.sale_price
          ? Number(productWithTaxes.sale_price)
          : Number(productWithTaxes.base_price);

        const realTaxInfo = await this.taxes_service.calculateProductTaxes(item.product_id, netPrice);

        return {
          ...item,
          net_price: netPrice,
          tax_rate: realTaxInfo.total_rate,
          tax_amount_item: realTaxInfo.total_tax_amount,
          total_tax: realTaxInfo.total_tax_amount * item.quantity,
          total_net: netPrice * item.quantity,
          item_taxes: realTaxInfo.taxes,
        };
      })
    );

    const subtotal = itemsWithTaxes.reduce((sum, item) => sum + item.total_net, 0);
    const total_tax = itemsWithTaxes.reduce((sum, item) => sum + item.total_tax, 0);
    const grand_total = subtotal + total_tax + shipping_cost;

    // store_id y customer_id (user_id) se inyectan automáticamente
    const order = await this.prisma.orders.create({
      data: {
        order_number,
        channel: 'ecommerce', // Ecommerce orders are assigned 'ecommerce' channel
        currency: cart.currency,
        subtotal_amount: subtotal,
        tax_amount: total_tax,
        shipping_cost: shipping_cost,
        shipping_method_id: shipping_method_id,
        shipping_rate_id: shipping_rate_id,
        delivery_type: delivery_type,
        grand_total: grand_total,
        shipping_address_id,
        shipping_address_snapshot,
        state: 'pending_payment',
        internal_notes: dto.notes,
        placed_at: new Date(),
        order_items: {
          create: itemsWithTaxes.map((item) => ({
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            product_name: item.product.name,
            variant_sku: item.product_variant?.sku,
            variant_attributes: item.product_variant?.attributes
              ? JSON.stringify(item.product_variant.attributes)
              : null,
            quantity: item.quantity,
            unit_price: item.net_price,
            total_price: item.total_net,
            tax_rate: item.tax_rate,
            tax_amount_item: item.tax_amount_item,
            order_item_taxes: {
              create: item.item_taxes.map(t => ({
                tax_rate_id: t.tax_rate_id,
                tax_name: t.name,
                tax_rate: t.rate,
                tax_amount: t.amount * item.quantity,
              }))
            }
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
        amount: grand_total,
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
    const store_id = RequestContextService.getStoreId();

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

    // IMPORTANTE: Usar store_prisma para contar TODAS las órdenes de la tienda, 
    // no solo las del usuario actual (que es lo que haría this.prisma.orders.count)
    const count = await this.store_prisma.orders.count({
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

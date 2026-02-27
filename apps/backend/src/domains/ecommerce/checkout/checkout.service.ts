import { Injectable, BadRequestException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CartService } from '../cart/cart.service';
import { TaxesService } from '../../store/taxes/taxes.service';
import { CheckoutDto } from './dto/checkout.dto';
import { WhatsappCheckoutDto } from './dto/whatsapp-checkout.dto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { payment_processing_mode_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../../store/settings/settings.service';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly store_prisma: StorePrismaService,
    private readonly cart_service: CartService,
    private readonly taxes_service: TaxesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
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
      // Validate: if product has variants, a variant must be selected
      const productVariantCount = await this.prisma.product_variants.count({
        where: { product_id: item.product_id },
      });

      if (productVariantCount > 0 && !item.product_variant_id) {
        throw new BadRequestException(
          `El producto "${item.product.name}" requiere selección de variante`,
        );
      }

      if (item.product.track_inventory) {
        const available = item.product_variant
          ? item.product_variant.stock_quantity ?? 0
          : item.product.stock_quantity ?? 0;
        if (item.quantity > available) {
          throw new BadRequestException(
            `Insufficient stock for ${item.product.name}. Only ${available} available.`,
          );
        }
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
      } else {
        delivery_type = 'home_delivery';
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

        // Variant-aware net price: use variant.price_override if present,
        // then product sale_price if on sale, otherwise product base_price
        let netPrice: number;
        if (item.product_variant?.price_override) {
          netPrice = Number(item.product_variant.price_override);
        } else {
          netPrice = productWithTaxes.is_on_sale && productWithTaxes.sale_price
            ? Number(productWithTaxes.sale_price)
            : Number(productWithTaxes.base_price);
        }

        const taxInfo = await this.taxes_service.calculateProductTaxes(item.product_id, netPrice);

        // Resolve cost_price: variant takes priority over product
        const cost_price = item.product_variant?.cost_price != null
          ? Number(item.product_variant.cost_price)
          : productWithTaxes.cost_price != null
            ? Number(productWithTaxes.cost_price)
            : null;

        return {
          ...item,
          net_price: netPrice,
          cost_price,
          tax_rate: taxInfo.total_rate,
          tax_amount_item: taxInfo.total_tax_amount,
          total_tax: taxInfo.total_tax_amount * item.quantity,
          total_net: netPrice * item.quantity,
          item_taxes: taxInfo.taxes,
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
            cost_price: item.cost_price,
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

    // Emit order.created event for notifications
    this.eventEmitter.emit('order.created', {
      store_id: order.store_id,
      order_id: order.id,
      order_number: order.order_number,
      grand_total: Number(order.grand_total),
      currency: order.currency,
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
      if (!item.product.track_inventory) continue;

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

  async whatsappCheckout(dto: WhatsappCheckoutDto) {
    const user_id = RequestContextService.getUserId();
    const is_guest = !user_id;

    // Fetch customer profile and primary address for authenticated users
    let customer_data: {
      first_name: string;
      last_name: string;
      phone: string | null;
      address: {
        address_line1: string;
        address_line2: string | null;
        city: string;
        state_province: string | null;
        country_code: string;
        postal_code: string | null;
        phone_number: string | null;
      } | null;
    } | null = null;
    let shipping_address_id: number | null = null;
    let shipping_address_snapshot: any = null;

    if (!is_guest) {
      const user = await this.prisma.users.findUnique({
        where: { id: user_id },
        select: { first_name: true, last_name: true, phone: true },
      });

      // addresses is scoped by store_id + user_id automatically
      const primary_address = await this.prisma.addresses.findFirst({
        where: { is_primary: true, type: 'shipping' },
      });

      if (primary_address) {
        shipping_address_id = primary_address.id;
        shipping_address_snapshot = {
          address_line1: primary_address.address_line1,
          address_line2: primary_address.address_line2,
          city: primary_address.city,
          state_province: primary_address.state_province,
          country_code: primary_address.country_code,
          postal_code: primary_address.postal_code,
          phone_number: primary_address.phone_number,
        };
      }

      if (user) {
        customer_data = {
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          phone: user.phone || null,
          address: shipping_address_snapshot,
        };
      }
    }

    // Build cart_items from either backend cart (authenticated) or DTO items (guest)
    let cart_items: Array<{
      product_id: number;
      product_variant_id: number | null;
      quantity: number;
      product: any;
      product_variant: any;
    }>;
    let cart_currency = await this.settingsService.getStoreCurrency();

    // Helper: build cart_items from DTO items (localStorage)
    const buildItemsFromDto = async () => {
      if (!dto.items || dto.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }
      return Promise.all(
        dto.items.map(async (item) => {
          const product = await this.prisma.products.findUnique({
            where: { id: item.product_id },
          });
          if (!product) {
            throw new BadRequestException(`Product with id ${item.product_id} not found`);
          }

          let product_variant = null;
          if (item.product_variant_id) {
            product_variant = await this.prisma.product_variants.findUnique({
              where: { id: item.product_variant_id },
            });
            if (!product_variant) {
              throw new BadRequestException(`Variant with id ${item.product_variant_id} not found`);
            }
          }

          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id || null,
            quantity: item.quantity,
            product,
            product_variant,
          };
        })
      );
    };

    if (is_guest) {
      // Guest checkout: items come from the DTO (frontend localStorage)
      cart_items = await buildItemsFromDto();
    } else {
      // Authenticated checkout: try backend cart first, fallback to DTO items
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

      if (cart && cart.cart_items.length > 0) {
        cart_items = cart.cart_items;
        cart_currency = cart.currency;
      } else if (dto.items && dto.items.length > 0) {
        // Fallback: user has items in localStorage but backend cart is empty
        cart_items = await buildItemsFromDto();
      } else {
        throw new BadRequestException('Cart is empty');
      }
    }

    for (const item of cart_items) {
      const productVariantCount = await this.prisma.product_variants.count({
        where: { product_id: item.product_id },
      });

      if (productVariantCount > 0 && !item.product_variant_id) {
        throw new BadRequestException(
          `El producto "${item.product.name}" requiere selección de variante`,
        );
      }

      if (item.product.track_inventory) {
        const available = item.product_variant
          ? item.product_variant.stock_quantity ?? 0
          : item.product.stock_quantity ?? 0;
        if (item.quantity > available) {
          throw new BadRequestException(
            `Insufficient stock for ${item.product.name}. Only ${available} available.`,
          );
        }
      }
    }

    const order_number = await this.generateOrderNumber();

    const itemsWithTaxes = await Promise.all(
      cart_items.map(async (item) => {
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

        let netPrice: number;
        if (item.product_variant?.price_override) {
          netPrice = Number(item.product_variant.price_override);
        } else {
          netPrice = productWithTaxes.is_on_sale && productWithTaxes.sale_price
            ? Number(productWithTaxes.sale_price)
            : Number(productWithTaxes.base_price);
        }

        const taxInfo = await this.taxes_service.calculateProductTaxes(item.product_id, netPrice);

        // Resolve cost_price: variant takes priority over product
        const cost_price = item.product_variant?.cost_price != null
          ? Number(item.product_variant.cost_price)
          : productWithTaxes.cost_price != null
            ? Number(productWithTaxes.cost_price)
            : null;

        return {
          ...item,
          net_price: netPrice,
          cost_price,
          tax_rate: taxInfo.total_rate,
          tax_amount_item: taxInfo.total_tax_amount,
          total_tax: taxInfo.total_tax_amount * item.quantity,
          total_net: netPrice * item.quantity,
          item_taxes: taxInfo.taxes,
        };
      })
    );

    const subtotal = itemsWithTaxes.reduce((sum, item) => sum + item.total_net, 0);
    const total_tax = itemsWithTaxes.reduce((sum, item) => sum + item.total_tax, 0);
    const grand_total = subtotal + total_tax;

    const order = await this.prisma.orders.create({
      data: {
        order_number,
        channel: 'whatsapp',
        currency: cart_currency,
        subtotal_amount: subtotal,
        tax_amount: total_tax,
        shipping_cost: 0,
        delivery_type: 'other',
        grand_total: grand_total,
        shipping_address_id,
        shipping_address_snapshot,
        state: 'created',
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
            cost_price: item.cost_price,
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

    // Emit order.created event for notifications
    this.eventEmitter.emit('order.created', {
      store_id: order.store_id,
      order_id: order.id,
      order_number: order.order_number,
      grand_total: Number(order.grand_total),
      currency: order.currency,
    });

    for (const item of cart_items) {
      if (!item.product.track_inventory) continue;

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

    // Only clear backend cart for authenticated users
    if (!is_guest) {
      await this.cart_service.clearCart();
    }

    return {
      order_id: order.id,
      order_number: order.order_number,
      total: order.grand_total,
      subtotal: subtotal,
      tax: total_tax,
      item_count: cart_items.reduce((sum, i) => sum + i.quantity, 0),
      items: order.order_items.map(oi => ({
        name: oi.product_name,
        variant_sku: oi.variant_sku,
        quantity: oi.quantity,
        unit_price: Number(oi.unit_price),
        total_price: Number(oi.total_price),
      })),
      state: order.state,
      customer: customer_data,
      message: 'Order placed successfully via WhatsApp',
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

import { Injectable } from '@nestjs/common';
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
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockLevelManager } from '../../store/inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../../store/inventory/shared/services/stock-validator.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { WompiClientFactory } from '../../store/payments/processors/wompi/wompi.factory';
import { WompiEnvironment } from '../../store/payments/processors/wompi/wompi.types';
import { WompiProcessor } from '../../store/payments/processors/wompi/wompi.processor';
import { PaymentEncryptionService } from '../../store/payments/services/payment-encryption.service';
import { WebhookHandlerService } from '../../store/payments/services/webhook-handler.service';
import * as crypto from 'crypto';
import { ReservationsService } from '../../store/reservations/reservations.service';
import { order_channel_enum } from '@prisma/client';
import { deriveDeliveryType } from '../../store/shipping/shipping-derivation.util';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly store_prisma: StorePrismaService,
    private readonly cart_service: CartService,
    private readonly taxes_service: TaxesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly stockValidatorService: StockValidatorService,
    private readonly priceResolverService: PriceResolverService,
    private readonly wompiClientFactory: WompiClientFactory,
    private readonly wompiProcessor: WompiProcessor,
    private readonly paymentEncryption: PaymentEncryptionService,
    private readonly reservationsService: ReservationsService,
    private readonly webhookHandler: WebhookHandlerService,
  ) {}

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

    // Fallback: if backend cart is empty but frontend sent items, build from DTO
    // This handles the case where localStorage cart was never synced to backend
    let cart_items = cart?.cart_items || [];

    if (cart_items.length === 0 && dto.items && dto.items.length > 0) {
      cart_items = await Promise.all(
        dto.items.map(async (item) => {
          const product = await this.prisma.products.findUnique({
            where: { id: item.product_id },
          });
          if (!product) {
            throw new VendixHttpException(ErrorCodes.ECOM_PRODUCT_001);
          }

          let product_variant = null;
          if (item.product_variant_id) {
            product_variant = await this.prisma.product_variants.findUnique({
              where: { id: item.product_variant_id },
            });
          }

          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id || null,
            quantity: item.quantity,
            product,
            product_variant,
          } as any;
        }),
      );
    }

    if (cart_items.length === 0) {
      throw new VendixHttpException(ErrorCodes.ECOM_CART_001);
    }

    const cart_currency =
      cart?.currency || (await this.settingsService.getStoreCurrency());

    // store_id se aplica automáticamente
    const payment_method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: dto.payment_method_id,
        state: 'enabled',
      },
      include: { system_payment_method: true },
    });

    if (!payment_method) {
      throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_002);
    }

    for (const item of cart_items) {
      const productVariantCount = await this.prisma.product_variants.count({
        where: { product_id: item.product_id },
      });

      if (productVariantCount > 0 && !item.product_variant_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
      }

      const shouldTrack = this.stockValidatorService.resolveEffectiveTracking(
        item.product,
        item.product_variant ?? undefined,
      );

      if (shouldTrack) {
        const availability =
          await this.stockValidatorService.validateAvailability(
            item.product_id,
            item.product_variant_id ?? undefined,
            item.quantity,
          );

        if (!availability.isAvailable) {
          const productName = item.product.name;
          const variantInfo = item.product_variant?.name
            ? ` (${item.product_variant.name})`
            : '';
          throw new VendixHttpException(
            ErrorCodes.ECOM_CART_003,
            `Insufficient stock for ${productName}${variantInfo}: requested ${item.quantity}, available ${availability.available}`,
          );
        }
      }
    }

    const hasPhysicalItems = cart_items.some((item: any) => {
      const product = item.product;
      if (!product) return true;
      if (product.product_type === 'service') return false;
      if (product.requires_shipping === false) return false;
      return true;
    });

    if (hasPhysicalItems && !dto.shipping_method_id && !dto.shipping_rate_id) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_001);
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
    let delivery_type:
      | 'pickup'
      | 'home_delivery'
      | 'direct_delivery'
      | 'other' = 'direct_delivery';

    if (dto.shipping_rate_id) {
      const rate = await this.store_prisma.shipping_rates.findFirst({
        where: {
          id: dto.shipping_rate_id,
          is_active: true,
        },
        include: {
          shipping_method: true,
          shipping_zone: true,
        },
      });

      if (!rate) {
        throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_003);
      }

      // Verificar que la zona pertenece a la tienda
      if (rate.shipping_zone.store_id !== store_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_003);
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
          is_active: true,
        },
      });

      if (!method) {
        throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_003);
      }

      shipping_method_id = method.id;
      // En este caso, shipping_cost queda en 0 o se debería recalcular
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

        const priceResult = this.priceResolverService.resolvePrice({
          product: {
            base_price: Number(productWithTaxes.base_price),
            is_on_sale: productWithTaxes.is_on_sale,
            sale_price:
              productWithTaxes.sale_price != null
                ? Number(productWithTaxes.sale_price)
                : null,
            track_inventory: productWithTaxes.track_inventory,
          },
          variant: item.product_variant
            ? {
                price_override:
                  item.product_variant.price_override != null
                    ? Number(item.product_variant.price_override)
                    : null,
                is_on_sale: item.product_variant.is_on_sale,
                sale_price:
                  item.product_variant.sale_price != null
                    ? Number(item.product_variant.sale_price)
                    : null,
                track_inventory_override:
                  item.product_variant.track_inventory_override,
              }
            : undefined,
        });

        const netPrice = priceResult.unitPrice;

        const taxInfo = await this.taxes_service.calculateProductTaxes(
          item.product_id,
          netPrice,
        );

        const cost_price =
          item.product_variant?.cost_price != null
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
      }),
    );

    const subtotal = itemsWithTaxes.reduce(
      (sum, item) => sum + item.total_net,
      0,
    );
    const total_tax = itemsWithTaxes.reduce(
      (sum, item) => sum + item.total_tax,
      0,
    );
    const grand_total = subtotal + total_tax + shipping_cost;

    // store_id y customer_id (user_id) se inyectan automáticamente
    const order = await this.prisma.orders.create({
      data: {
        order_number,
        channel: 'ecommerce', // Ecommerce orders are assigned 'ecommerce' channel
        currency: cart_currency,
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
              create: item.item_taxes.map((t) => ({
                tax_rate_id: t.tax_rate_id,
                tax_name: t.name,
                tax_rate: t.rate,
                tax_amount: t.amount * item.quantity,
              })),
            },
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
        currency: cart_currency,
        state: 'pending',
        store_payment_method_id: dto.payment_method_id,
      },
    });

    for (const item of cart_items) {
      if (!item.product.track_inventory) continue;
      try {
        const location_id =
          await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id || undefined,
          );
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          order.id,
          undefined,
          false, // Already validated stock above
        );
      } catch (error) {
        this.logger.warn(
          `Stock reservation failed for product ${item.product_id}: ${error.message}`,
        );
      }
    }

    // Create bookings for bookable services
    if (dto.bookings && dto.bookings.length > 0) {
      const user_id = RequestContextService.getUserId();
      for (const booking of dto.bookings) {
        try {
          await this.reservationsService.create({
            customer_id: user_id!,
            product_id: booking.product_id,
            date: booking.date,
            start_time: booking.start_time,
            end_time: booking.end_time,
            channel: order_channel_enum.ecommerce,
            order_id: order.id,
            skip_availability_check: false,
          });
          this.logger.log(
            `Booking created for product ${booking.product_id} linked to order ${order.id}`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to create booking for product ${booking.product_id}: ${error.message}`,
          );
          // Don't fail the entire checkout if a booking fails
          // The order is already created; booking can be retried manually
        }
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
        throw new VendixHttpException(ErrorCodes.ECOM_CART_001);
      }
      return Promise.all(
        dto.items.map(async (item) => {
          const product = await this.prisma.products.findUnique({
            where: { id: item.product_id },
          });
          if (!product) {
            throw new VendixHttpException(ErrorCodes.ECOM_PRODUCT_001);
          }

          let product_variant = null;
          if (item.product_variant_id) {
            product_variant = await this.prisma.product_variants.findUnique({
              where: { id: item.product_variant_id },
            });
            if (!product_variant) {
              throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
            }
          }

          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id || null,
            quantity: item.quantity,
            product,
            product_variant,
          };
        }),
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
        throw new VendixHttpException(ErrorCodes.ECOM_CART_001);
      }
    }

    for (const item of cart_items) {
      const productVariantCount = await this.prisma.product_variants.count({
        where: { product_id: item.product_id },
      });

      if (productVariantCount > 0 && !item.product_variant_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
      }

      const shouldTrack = this.stockValidatorService.resolveEffectiveTracking(
        item.product,
        item.product_variant ?? undefined,
      );

      if (shouldTrack) {
        const availability =
          await this.stockValidatorService.validateAvailability(
            item.product_id,
            item.product_variant_id ?? undefined,
            item.quantity,
          );

        if (!availability.isAvailable) {
          const productName = item.product.name;
          const variantInfo = item.product_variant?.name
            ? ` (${item.product_variant.name})`
            : '';
          throw new VendixHttpException(
            ErrorCodes.ECOM_CART_003,
            `Insufficient stock for ${productName}${variantInfo}: requested ${item.quantity}, available ${availability.available}`,
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

        const priceResult = this.priceResolverService.resolvePrice({
          product: {
            base_price: Number(productWithTaxes.base_price),
            is_on_sale: productWithTaxes.is_on_sale,
            sale_price:
              productWithTaxes.sale_price != null
                ? Number(productWithTaxes.sale_price)
                : null,
            track_inventory: productWithTaxes.track_inventory,
          },
          variant: item.product_variant
            ? {
                price_override:
                  item.product_variant.price_override != null
                    ? Number(item.product_variant.price_override)
                    : null,
                is_on_sale: item.product_variant.is_on_sale,
                sale_price:
                  item.product_variant.sale_price != null
                    ? Number(item.product_variant.sale_price)
                    : null,
                track_inventory_override:
                  item.product_variant.track_inventory_override,
              }
            : undefined,
        });

        const netPrice = priceResult.unitPrice;

        const taxInfo = await this.taxes_service.calculateProductTaxes(
          item.product_id,
          netPrice,
        );

        const cost_price =
          item.product_variant?.cost_price != null
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
      }),
    );

    const subtotal = itemsWithTaxes.reduce(
      (sum, item) => sum + item.total_net,
      0,
    );
    const total_tax = itemsWithTaxes.reduce(
      (sum, item) => sum + item.total_tax,
      0,
    );
    // Resolve optional shipping method/rate from DTO (scoped by store)
    const wa_store_id = RequestContextService.getStoreId();
    let wa_shipping_method_id: number | null = null;
    let wa_shipping_rate_id: number | null = null;
    let wa_shipping_cost = 0;
    let wa_delivery_type:
      | 'pickup'
      | 'home_delivery'
      | 'direct_delivery'
      | 'other' = 'other';

    if (dto.shipping_rate_id) {
      const rate = await this.store_prisma.shipping_rates.findFirst({
        where: { id: dto.shipping_rate_id, is_active: true },
        include: { shipping_method: true, shipping_zone: true },
      });
      if (!rate || rate.shipping_zone.store_id !== wa_store_id) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
      }
      if (
        dto.shipping_method_id &&
        rate.shipping_method_id !== dto.shipping_method_id
      ) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
      }
      wa_shipping_method_id = rate.shipping_method_id;
      wa_shipping_rate_id = rate.id;
      wa_shipping_cost = Number(rate.base_cost);
      wa_delivery_type = deriveDeliveryType(rate.shipping_method.type);
    } else if (dto.shipping_method_id) {
      const method = await this.store_prisma.shipping_methods.findFirst({
        where: {
          id: dto.shipping_method_id,
          store_id: wa_store_id,
          is_active: true,
        },
      });
      if (!method) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_INVALID_METHOD_001);
      }
      wa_shipping_method_id = method.id;
      wa_delivery_type = deriveDeliveryType(method.type);
    }

    const grand_total = subtotal + total_tax + wa_shipping_cost;

    const order = await this.prisma.orders.create({
      data: {
        order_number,
        channel: 'whatsapp',
        currency: cart_currency,
        subtotal_amount: subtotal,
        tax_amount: total_tax,
        shipping_cost: wa_shipping_cost,
        shipping_method_id: wa_shipping_method_id,
        shipping_rate_id: wa_shipping_rate_id,
        delivery_type: wa_delivery_type,
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
              create: item.item_taxes.map((t) => ({
                tax_rate_id: t.tax_rate_id,
                tax_name: t.name,
                tax_rate: t.rate,
                tax_amount: t.amount * item.quantity,
              })),
            },
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
      try {
        const location_id =
          await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id || undefined,
          );
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          order.id,
          undefined,
          false, // Already validated stock above
        );
      } catch (error) {
        this.logger.warn(
          `Stock reservation failed for product ${item.product_id}: ${error.message}`,
        );
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
      items: order.order_items.map((oi) => ({
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
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: { store_code: true },
    });

    const store_code = store?.store_code || 'EC';
    const date = new Date();
    const date_str = date.toISOString().slice(2, 10).replace(/-/g, '');

    const start_of_day = new Date(date);
    start_of_day.setUTCHours(0, 0, 0, 0);
    const end_of_day = new Date(date);
    end_of_day.setUTCHours(23, 59, 59, 999);

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

  /**
   * Prepare Wompi payment data for the frontend Widget.
   * This endpoint is accessible from eCommerce context (customer JWT + x-store-id header).
   */
  async prepareWompiPayment(dto: {
    order_id: number;
    amount: number;
    currency?: string;
    customer_email?: string;
    redirect_url?: string;
  }) {
    // Find Wompi payment method for this store
    const wompiMethod = await this.store_prisma.store_payment_methods.findFirst(
      {
        where: {
          state: 'enabled',
          system_payment_method: { type: 'wompi' },
        },
        include: { system_payment_method: true },
      },
    );

    if (!wompiMethod?.custom_config) {
      throw new BadRequestException(
        'Wompi no está configurado para esta tienda',
      );
    }

    const config = this.paymentEncryption.decryptConfig(
      wompiMethod.custom_config as Record<string, any>,
      'wompi',
    );

    const wompiConfig = {
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment:
        (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };

    const storeId = RequestContextService.getStoreId();
    const client = this.wompiClientFactory.getClient(
      `store-${storeId}`,
      wompiConfig,
    );

    // Resolve the most-recent payment row for this order so we can REUSE its
    // gateway_reference if one was already issued (e.g. user refreshed the
    // checkout page mid-flow). Reusing the reference means the Wompi widget
    // shows the SAME pending transaction instead of creating a parallel one,
    // which would orphan the original reference and confuse webhook lookup.
    const existingPayment = await this.store_prisma.payments.findFirst({
      where: { order_id: dto.order_id },
      orderBy: { created_at: 'desc' },
    });

    let reference: string;
    if (existingPayment?.gateway_reference) {
      // Reuse — don't overwrite. The widget + webhook + force-confirm will
      // all key off this same reference.
      reference = existingPayment.gateway_reference;
    } else {
      reference = `vendix_${storeId}_${dto.order_id}_${Date.now()}`;
      // Persist on the existing pending payment row (don't overwrite
      // transaction_id — that's the placeholder/real-Wompi-id field).
      if (existingPayment) {
        await this.store_prisma.payments.update({
          where: { id: existingPayment.id },
          data: {
            gateway_reference: reference,
            updated_at: new Date(),
          },
        });
      }
    }

    const amountInCents = Math.round(dto.amount * 100);
    const currency = dto.currency || 'COP';

    const integritySignature = client.generateIntegritySignature(
      reference,
      amountInCents,
      currency,
    );

    // Validate redirect_url against the store's registered domains to
    // prevent open-redirect / phishing — the user lands wherever the
    // attacker's frontend tells Wompi to send them otherwise. We accept
    // ONLY the store's own domain_settings hostnames (custom domain or
    // Vendix subdomain) as valid parents.
    const safeRedirectUrl = await this.validateRedirectUrl(
      dto.redirect_url,
      storeId ?? null,
    );

    const tokens = await client.getAcceptanceTokens();

    return {
      public_key: config.public_key,
      currency,
      amount_in_cents: amountInCents,
      reference,
      signature_integrity: integritySignature,
      redirect_url: safeRedirectUrl,
      acceptance_token: tokens.acceptance_token,
      accept_personal_auth: tokens.personal_auth_token,
      customer_email: dto.customer_email || '',
    };
  }

  /**
   * Validate the customer-supplied redirect URL.
   *
   *  - Empty / undefined: allowed (Wompi falls back to its own success page).
   *  - In production: MUST be HTTPS.
   *  - Host MUST belong to the store's `domain_settings` (or be a
   *    subdomain of one of them). This blocks open-redirect /
   *    phishing — an attacker can't trick the widget into sending the
   *    user to `https://attacker.com/?paid=true`.
   *
   * Throws BadRequestException (Spanish message — user-visible via the
   * widget callback chain) on any violation.
   */
  private async validateRedirectUrl(
    rawUrl: string | undefined,
    storeId: number | null,
  ): Promise<string> {
    if (!rawUrl) return '';

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('La URL de redirección no es válida');
    }

    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        'La URL de redirección debe usar HTTPS en producción',
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(
        'La URL de redirección debe usar http o https',
      );
    }

    if (!storeId) {
      // No store context — reject conservatively in prod, allow in dev.
      if (isProd) {
        throw new BadRequestException(
          'No se puede validar la URL de redirección sin contexto de tienda',
        );
      }
      return rawUrl;
    }

    // Allowed hosts: every domain registered to this store.
    // Note: `domain_settings` is global; we use the unscoped client
    // through `store_prisma` is fine because we always filter by
    // store_id below.
    const domains = await this.store_prisma.domain_settings.findMany({
      where: { store_id: storeId },
      select: { hostname: true },
    });
    const allowed = domains
      .map((d) => (d.hostname ?? '').toLowerCase())
      .filter((h) => h.length > 0);

    // Always allow the platform's own root domain in dev (so the dev
    // ecommerce served from localhost / vendix.app works).
    const host = parsed.hostname.toLowerCase();
    const isAllowed = allowed.some((h) => host === h || host.endsWith(`.${h}`));

    if (!isAllowed) {
      // In dev, log + allow; in prod, hard reject.
      if (!isProd) {
        this.logger.warn(
          `redirect_url host '${host}' is not registered for store ${storeId}; allowed=[${allowed.join(',')}] (dev mode — permitted)`,
        );
        return rawUrl;
      }
      throw new BadRequestException(
        'La URL de redirección no pertenece a un dominio autorizado de la tienda',
      );
    }

    return rawUrl;
  }

  /**
   * Force-confirm a Wompi payment for an order by polling the Wompi API
   * directly. Used when the customer returns from the Wompi widget — the
   * frontend calls this so the order/payment state reflects reality even if
   * the webhook hasn't arrived yet (it's a fallback for the canonical
   * webhook flow, not a replacement).
   *
   * Lookup priority for the Wompi transaction:
   *   1. payments.transaction_id (real Wompi id, set if any prior webhook landed)
   *   2. payments.gateway_reference (Vendix reference) -> GET /transactions/?reference=
   *
   * Returns the canonical payment state plus a flag indicating whether the
   * payment was already in a terminal state.
   */
  async confirmWompiPayment(orderId: number): Promise<{
    state: string;
    orderState: string;
    transactionId: string | null;
    alreadyConfirmed: boolean;
    message?: string;
  }> {
    // Use store-scoped client: customer-auth requests carry the resolved
    // store context, and we want defense in depth — the order MUST belong
    // to the store the customer is browsing.
    const payment = await this.store_prisma.payments.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
    });

    if (!payment) {
      throw new NotFoundException('No payment record found for this order');
    }

    // Idempotency: if payment is already in a terminal state, skip the
    // Wompi roundtrip and return current state.
    const terminal = [
      'succeeded',
      'captured',
      'failed',
      'cancelled',
      'refunded',
    ];
    if (terminal.includes(payment.state)) {
      const order = await this.store_prisma.orders.findUnique({
        where: { id: orderId },
        select: { state: true },
      });
      return {
        state: payment.state,
        orderState: order?.state ?? 'unknown',
        transactionId: payment.transaction_id,
        alreadyConfirmed: true,
      };
    }

    // Resolve Wompi credentials for this store. We use the store's enabled
    // Wompi method (same lookup as `prepareWompiPayment`).
    const wompiMethod = await this.store_prisma.store_payment_methods.findFirst(
      {
        where: {
          state: 'enabled',
          system_payment_method: { type: 'wompi' },
        },
        include: { system_payment_method: true },
      },
    );

    if (!wompiMethod?.custom_config) {
      throw new BadRequestException(
        'Wompi no está configurado para esta tienda',
      );
    }

    const config = this.paymentEncryption.decryptConfig(
      wompiMethod.custom_config as Record<string, any>,
      'wompi',
    );

    const wompiConfig = {
      public_key: config.public_key,
      private_key: config.private_key,
      events_secret: config.events_secret || '',
      integrity_secret: config.integrity_secret || '',
      environment:
        (config.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };

    const cacheKey = `store-${payment.orders?.stores?.id ?? 'unknown'}`;
    const client = this.wompiClientFactory.getClient(cacheKey, wompiConfig);

    // Try to fetch the Wompi transaction:
    //   1. By real transaction id if we already have it
    //   2. By Vendix reference (the canonical case for early-state payments)
    let txn: any = null;
    const placeholderRe = /^[a-z_]+_\d{10,}_[a-z0-9]+$/i;

    if (
      payment.transaction_id &&
      !placeholderRe.test(payment.transaction_id) &&
      // Wompi ids are typically `<digits>-<digits>-<digits>`; the placeholder
      // shape `wompi_<ts>_<rand>` is excluded by the regex above.
      payment.transaction_id.length > 0
    ) {
      try {
        const response = await client.getTransaction(payment.transaction_id);
        if (response?.data?.id) {
          txn = response.data;
        }
      } catch (err) {
        this.logger.warn(
          `Wompi getTransaction failed: ${(err as Error).message}`,
        );
      }
    }

    if (!txn) {
      const reference = payment.gateway_reference || payment.transaction_id;
      if (!reference) {
        throw new BadRequestException(
          'No Wompi reference or transaction id available to confirm this payment',
        );
      }
      try {
        const response = await client.getTransactionsByReference(reference);
        const txns = response?.data ?? [];
        if (txns.length > 0) {
          txn = txns.reduce((latest: any, candidate: any) => {
            if (!latest) return candidate;
            return new Date(candidate.created_at) > new Date(latest.created_at)
              ? candidate
              : latest;
          }, txns[0]);
        }
      } catch (err) {
        this.logger.warn(
          `Wompi getTransactionsByReference failed: ${(err as Error).message}`,
        );
      }
    }

    if (!txn) {
      // Wompi doesn't know this reference yet (e.g. user closed widget before
      // submitting). Don't error — the payment row stays pending and the
      // webhook (if any) will still arrive.
      this.logger.log(
        `confirmWompiPayment: no Wompi transaction found for order=${orderId} ref=${payment.gateway_reference}`,
      );
      return {
        state: payment.state,
        orderState: 'pending_payment',
        transactionId: payment.transaction_id,
        alreadyConfirmed: false,
        message: 'No transaction recorded at gateway yet',
      };
    }

    // Apply the txn through the shared webhook-handler logic so we don't
    // duplicate state mapping, idempotency checks, or order-cancel side effects.
    const mappedState = await this.webhookHandler.applyWompiTransaction(txn);

    // Reload payment + order to return the canonical post-apply state.
    const finalPayment = await this.store_prisma.payments.findUnique({
      where: { id: payment.id },
      select: { state: true, transaction_id: true, order_id: true },
    });
    const order = finalPayment
      ? await this.store_prisma.orders.findUnique({
          where: { id: finalPayment.order_id },
          select: { state: true },
        })
      : null;

    return {
      state: finalPayment?.state ?? mappedState ?? payment.state,
      orderState: order?.state ?? 'unknown',
      transactionId: finalPayment?.transaction_id ?? payment.transaction_id,
      alreadyConfirmed: false,
    };
  }
}

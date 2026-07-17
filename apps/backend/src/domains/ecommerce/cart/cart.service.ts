import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { AddToCartDto, UpdateCartItemDto, SyncCartDto } from './dto/cart.dto';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../store/settings/settings.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockValidatorService } from '../../store/inventory/shared/services/stock-validator.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly s3Service: S3Service,
    private readonly settingsService: SettingsService,
    private readonly stockValidatorService: StockValidatorService,
    private readonly priceResolverService: PriceResolverService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly storePrisma: StorePrismaService,
    private readonly menuAvailabilityChecker: MenuAvailabilityCheckerService,
  ) {}

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

    if (cart) {
      cart = await this.clearCartIfExpired(cart);
    }

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

    const mapped = await this.mapCartToResponse(cart);

    // Surface the automatic promotional discount alongside the existing cart
    // shape (additive: never removes fields). Degrade silently on any failure
    // so the cart view never breaks because of promotions.
    let promotion_discount = 0;
    let promotional_subtotal = mapped.subtotal;
    let applied_promotions: Array<{
      promotion_id: number;
      name: string;
      type: 'percentage' | 'fixed_amount';
      scope: 'order' | 'product' | 'category';
      discount_amount: number;
    }> = [];
    try {
      const summary = await this.getCartSummary();
      promotion_discount = summary.promotion_discount;
      promotional_subtotal = summary.promotional_subtotal;
      applied_promotions = summary.applied_promotions;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve cart promotions summary: ${error?.message ?? error}`,
      );
    }

    return {
      ...mapped,
      promotion_discount,
      promotional_subtotal,
      applied_promotions,
    };
  }

  async addItem(dto: AddToCartDto) {
    await this.validateMaxQuantity(dto.quantity);

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
      throw new VendixHttpException(ErrorCodes.ECOM_PRODUCT_002);
    }

    // Strict menu schedule enforcement: if the product belongs to an active
    // carta with availability windows and none is open right now, it cannot be
    // added to the cart. Products not in any menu, or in menus without windows,
    // are unaffected (retail catalog stays buyable 24/7).
    const store_id = RequestContextService.getStoreId();
    if (
      store_id &&
      (await this.menuAvailabilityChecker.isProductBlockedNow(
        store_id,
        dto.product_id,
      ))
    ) {
      throw new VendixHttpException(ErrorCodes.MENU_ITEM_NOT_AVAILABLE_NOW);
    }

    // Validate: if product has variants, a variant must be selected
    const variantCount = await this.prisma.product_variants.count({
      where: { product_id: dto.product_id },
    });

    if (variantCount > 0 && !dto.product_variant_id) {
      throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
    }

    let variant: any = null;

    if (dto.product_variant_id) {
      variant = await this.prisma.product_variants.findUnique({
        where: { id: dto.product_variant_id },
      });
      if (!variant || variant.product_id !== dto.product_id) {
        throw new VendixHttpException(ErrorCodes.ECOM_CART_002);
      }
    }

    await this.validateStock(product, variant, dto.quantity);

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
    } else {
      cart = await this.clearCartIfExpired(cart);
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
      await this.validateMaxQuantity(new_quantity);
      await this.validateStock(product, variant, new_quantity);

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
    if (dto.quantity === 0) {
      return this.removeItem(item_id);
    }

    await this.validateMaxQuantity(dto.quantity);

    const cart = await this.prisma.carts.findFirst({});

    if (!cart) {
      throw new VendixHttpException(ErrorCodes.ECOM_CART_004);
    }

    const item = await this.prisma.cart_items.findFirst({
      where: { id: item_id, cart_id: cart.id },
      include: { product: true, product_variant: true },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.validateStock(item.product, item.product_variant, dto.quantity);

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
      throw new VendixHttpException(ErrorCodes.ECOM_CART_004);
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
      } catch (error) {
        this.logger.warn(
          `Skipping invalid cart item during sync: product_id=${item.product_id}, error=${error.message}`,
        );
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

  private async clearCartIfExpired(cart: any) {
    const settings = await this.getEcommerceCartSettings();
    const expirationHours = Number(settings.cart_expiration_hours || 0);

    if (expirationHours <= 0 || !cart.updated_at) return cart;

    const expiresAt =
      new Date(cart.updated_at).getTime() + expirationHours * 60 * 60 * 1000;

    if (Date.now() <= expiresAt) return cart;

    await this.prisma.cart_items.deleteMany({
      where: { cart_id: cart.id },
    });

    return this.prisma.carts.update({
      where: { id: cart.id },
      data: { subtotal: 0, updated_at: new Date() },
      include: this.cartInclude,
    });
  }

  private async validateMaxQuantity(quantity: number): Promise<void> {
    const settings = await this.getEcommerceCartSettings();
    const maxQuantity = Number(settings.max_quantity_per_item || 0);

    if (maxQuantity > 0 && quantity > maxQuantity) {
      throw new BadRequestException(
        `La cantidad máxima por producto es ${maxQuantity}`,
      );
    }
  }

  private async getEcommerceCartSettings(): Promise<{
    cart_expiration_hours?: number;
    max_quantity_per_item?: number;
  }> {
    try {
      const settings = await this.settingsService.getSettings();
      return settings.ecommerce?.cart ?? {};
    } catch {
      return {};
    }
  }

  private async mapCartToResponse(cart: any) {
    const items = await Promise.all(
      cart.cart_items.map(async (item: any) => {
        // Use variant image if available, fallback to product main image
        const variant_image_url =
          item.product_variant?.product_images?.image_url || null;
        const product_image_url =
          item.product.product_images?.[0]?.image_url || null;
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
    const totalTaxRate = this.getTotalTaxRate(product);
    const priceResult = this.priceResolverService.resolvePrice(
      this.toPriceResolverParams(product, variant),
      totalTaxRate,
    );
    return Math.round(priceResult.unitPriceWithTax * 100) / 100;
  }

  private async validateStock(product: any, variant: any, quantity: number) {
    const shouldTrack = this.stockValidatorService.resolveEffectiveTracking(
      product,
      variant ?? undefined,
    );

    if (!shouldTrack) return;

    const availability = await this.stockValidatorService.validateAvailability(
      product.id,
      variant?.id,
      quantity,
    );

    if (!availability.isAvailable) {
      throw new VendixHttpException(ErrorCodes.ECOM_CART_003);
    }
  }

  /**
   * Build an authoritative cart summary with the items the customer has
   * loaded (authenticated DB cart OR DTO items from localStorage) and the
   * promotion engine output. Pure quote — no order is created. Used by the
   * cart view to surface a realistic total before checkout.
   *
   * Coupons are intentionally NOT evaluated here — the cart UI only hints
   * at automatic promotional discounts. The coupon enters the picture in
   * the checkout payload.
   */
  async getCartSummary(items?: Array<{
    product_id: number;
    product_variant_id?: number | null;
    quantity: number;
  }>): Promise<{
    subtotal: number;
    promotion_discount: number;
    promotional_subtotal: number;
    item_count: number;
    applied_promotions: Array<{
      promotion_id: number;
      name: string;
      type: 'percentage' | 'fixed_amount';
      scope: 'order' | 'product' | 'category';
      discount_amount: number;
    }>;
    tier_progress: Array<{
      promotion_id: number;
      name: string;
      remaining_quantity: number;
      benefit_type: 'percentage' | 'fixed_amount';
      benefit_value: number;
    }>;
  }> {
    // Auth users: prefer the backend cart so quantities are server-side
    // canonical. Guests: use the DTO items array as the source of truth.
    let resolvedItems: Array<{
      product_id: number;
      product_variant_id: number | null;
      quantity: number;
      unit_price: number;
    }> = [];

    if (items && items.length > 0) {
      resolvedItems = await Promise.all(
        items.map(async (item) => {
          const product = await this.prisma.products.findUnique({
            where: { id: item.product_id },
          });
          if (!product) {
            return null;
          }
          const variant = item.product_variant_id
            ? await this.prisma.product_variants.findUnique({
                where: { id: item.product_variant_id },
              })
            : null;
          const priceResult = this.priceResolverService.resolvePrice(
            this.toPriceResolverParams(product, variant),
          );
          return {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            quantity: item.quantity,
            unit_price: Math.round(priceResult.unitPrice * 100) / 100,
          };
        }),
      ).then((rows) => rows.filter((r): r is NonNullable<typeof r> => r !== null));
    } else {
      const cart = await this.prisma.carts.findFirst({
        include: { cart_items: true },
      });
      if (!cart) {
        return {
          subtotal: 0,
          promotion_discount: 0,
          promotional_subtotal: 0,
          item_count: 0,
          applied_promotions: [],
          tier_progress: [],
        };
      }
      resolvedItems = cart.cart_items.map((ci) => ({
        product_id: ci.product_id,
        product_variant_id: ci.product_variant_id,
        quantity: ci.quantity,
        unit_price: Number(ci.unit_price),
      }));
    }

    if (resolvedItems.length === 0) {
      return {
        subtotal: 0,
        promotion_discount: 0,
        promotional_subtotal: 0,
        item_count: 0,
        applied_promotions: [],
        tier_progress: [],
      };
    }

    const productIds = Array.from(
      new Set(resolvedItems.map((i) => i.product_id)),
    );
    const categoryRows = await this.storePrisma.product_categories.findMany({
      where: { product_id: { in: productIds } },
      select: { product_id: true, category_id: true },
    });
    const categoryMap = new Map<number, number[]>();
    for (const row of categoryRows) {
      const existing = categoryMap.get(row.product_id) ?? [];
      existing.push(row.category_id);
      categoryMap.set(row.product_id, existing);
    }

    const quote = await this.promotionEngine.quoteDiscounts({
      items: resolvedItems.map((item, index) => ({
        line_id: index,
        product_id: item.product_id,
        variant_id: item.product_variant_id,
        category_ids: categoryMap.get(item.product_id) ?? [],
        unit_price: item.unit_price,
        quantity: item.quantity,
      })),
      customer_id: RequestContextService.getUserId() ?? null,
    });

    return {
      subtotal: quote.subtotal,
      promotion_discount: quote.total_discount,
      promotional_subtotal: quote.promotional_subtotal,
      item_count: resolvedItems.reduce((sum, i) => sum + i.quantity, 0),
      applied_promotions: quote.applied_promotions.map((p) => ({
        promotion_id: p.promotion_id,
        name: p.name,
        type: p.type,
        scope: p.scope,
        discount_amount: p.discount_amount,
        // Surfaced for the cart UI audit trail. With the winner-takes-all
        // engine, an order has at most one entry here.
        priority: p.priority,
      })),
      tier_progress: quote.tier_progress,
    };
  }

  private toPriceResolverParams(product: any, variant?: any) {
    return {
      product: {
        base_price: Number(product.base_price),
        is_on_sale: product.is_on_sale,
        sale_price:
          product.sale_price != null ? Number(product.sale_price) : null,
        track_inventory: product.track_inventory,
      },
      variant: variant
        ? {
            price_override:
              variant.price_override != null
                ? Number(variant.price_override)
                : null,
            is_on_sale: variant.is_on_sale,
            sale_price:
              variant.sale_price != null ? Number(variant.sale_price) : null,
            track_inventory_override: variant.track_inventory_override,
          }
        : undefined,
    };
  }
}

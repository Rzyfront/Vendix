import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { AddToCartDto, UpdateCartItemDto, SyncCartDto } from './dto/cart.dto';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../store/settings/settings.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockValidatorService } from '../../store/inventory/shared/services/stock-validator.service';
import { StorefrontPriceService } from '../shared/services/storefront-price.service';
import {
  resolveDefaultSaleUnit,
  resolveDefaultSaleUnits,
  type DefaultSaleUnit,
} from '../../store/products/services/default-sale-unit.util';
import {
  listPublicSaleUnitsForProducts,
  resolveLooseUnitFallbacks,
  resolvePublicSaleUnitSelections,
} from '../../store/products/services/public-sale-unit.util';
import { resolveStockUnitsConsumed } from '../../store/products/services/packaging.util';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';

/**
 * CP-ECOM-PROMO-UX-001 convergence-R5: retry helpers for the cart promo
 * summary load. The cart view MUST keep serving 200s on transient DB blips
 * (advisory-lock contention, brief deadlocks), but a sustained failure has
 * to be visible to the customer — that's the `promotions_load_state: 'degraded'`
 * banner the frontend renders. Codes here are the ones Prisma emits for the
 * two transient shapes we see in production: P2002 (unique-key contention)
 * and P2028 (transaction timeout / advisory-lock conflict).
 */
const PROMO_SUMMARY_RETRY_BACKOFFS_MS = [100, 500, 1500] as const;
const PROMO_SUMMARY_RETRYABLE_CODES = new Set<string>(['P2002', 'P2028']);

function isRetryablePromoSummaryError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    PROMO_SUMMARY_RETRYABLE_CODES.has(err.code)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly s3Service: S3Service,
    private readonly settingsService: SettingsService,
    private readonly stockValidatorService: StockValidatorService,
    private readonly storefrontPrice: StorefrontPriceService,
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
      // QUI-628: a newly-created cart is 'active' and its last_activity_at is
      // `now`. Without this, a freshly-created cart would read as
      // state=NULL/last_activity_at=NULL until the first item is added — and
      // the abandoned-cart metric would silently treat every fresh cart as
      // already overdue.
      cart = await this.prisma.carts.create({
        data: {
          currency,
          state: 'active',
          last_activity_at: new Date(),
          // store_id y user_id se inyectan automáticamente
        },
        include: this.cartInclude,
      });
    }

    const mapped = await this.mapCartToResponse(cart);

    // Surface the automatic promotional discount alongside the existing cart
    // shape (additive: never removes fields). Degrade silently on any failure
    // so the cart view never breaks because of promotions.
    //
    // CP-ECOM-PROMO-UX-001 convergence-R5: a brief DB blip (P2002 unique-key
    // contention, P2028 advisory-lock timeout) used to silently surface a
    // zero-discount cart and the customer never knew promotions failed to
    // load. We now retry up to 3 times with 100/500/1500 ms backoff on those
    // two codes — both are transient in production — and emit
    // `promotions_load_state: 'degraded'` when every attempt fails so the
    // frontend can render a banner and the customer knows to refresh.
    // Non-retryable errors (validation, schema, anything else) degrade
    // immediately, with the same banner: a missing promo is the same UX
    // outcome regardless of the underlying cause.
    let promotion_discount = 0;
    let promotional_subtotal = mapped.subtotal;
    let applied_promotions: Array<{
      promotion_id: number;
      name: string;
      type: 'percentage' | 'fixed_amount';
      scope: 'order' | 'product' | 'category';
      discount_amount: number;
    }> = [];
    let per_product_tier_ladder:
      | Array<{
          promotion_id: number;
          target_product_id: number;
          tiers: Array<{
            min_quantity: number;
            max_quantity: number | null;
            type: 'percentage' | 'fixed_amount';
            value: number;
            sort_order: number;
          }>;
          current_tier_index: number | null;
        }>
      | undefined;
    let promotions_load_state: 'ok' | 'degraded' = 'ok';
    try {
      const summary = await this.loadCartPromotionsSummaryWithRetry();
      promotion_discount = summary.promotion_discount;
      promotional_subtotal = summary.promotional_subtotal;
      applied_promotions = summary.applied_promotions;
      per_product_tier_ladder = summary.per_product_tier_ladder;
    } catch (error) {
      // Every retry exhausted (or a non-retryable error surfaced on attempt
      // 1). The cart still returns 200 with zeros for the promo fields — the
      // customer can keep shopping — and the frontend shows the degraded
      // banner so the failure is visible.
      promotions_load_state = 'degraded';
      this.logger.warn(
        `Cart promotions summary degraded after retries: ${error?.message ?? error}`,
      );
    }

    return {
      ...mapped,
      promotion_discount,
      promotional_subtotal,
      applied_promotions,
      promotions_load_state,
      // Conditional spread: omit the field when no tiered promos survived
      // the filter in `getCartSummary`. Cart UI gets the SAME shape across
      // auth and guest paths because both delegates to `getCartSummary`.
      ...(per_product_tier_ladder
        ? { per_product_tier_ladder }
        : {}),
    };
  }

  /**
   * CP-ECOM-PROMO-UX-001 convergence-R5: load the cart promotions summary
   * with bounded retries on transient Prisma errors (P2002 unique-key
   * contention, P2028 advisory-lock timeout). On the third failure the
   * error propagates and `getCart` flips `promotions_load_state` to
   * `'degraded'` so the frontend can render the banner.
   *
   * Why a private helper instead of inlining the loop in `getCart`: keeps
   * the `getCart` shape readable (the merged response is the source of
   * truth) and isolates the retry policy from the cart enrichment.
   * Non-retryable errors fail fast on attempt 1 — the catch in `getCart`
   * still degrades, so the UX is identical regardless of cause.
   */
  private async loadCartPromotionsSummaryWithRetry(): Promise<Awaited<
    ReturnType<CartService['getCartSummary']>
  >> {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt <= PROMO_SUMMARY_RETRY_BACKOFFS_MS.length;
      attempt++
    ) {
      try {
        return await this.getCartSummary();
      } catch (error) {
        lastError = error;
        // Non-retryable: bail out on the first failure and let the caller
        // mark the cart as degraded. Retrying won't help on a validation /
        // schema error and would only delay the user-visible banner.
        if (!isRetryablePromoSummaryError(error)) break;
        // We just used attempt `attempt` and it failed with a retryable
        // code; sleep only if another attempt remains.
        if (attempt < PROMO_SUMMARY_RETRY_BACKOFFS_MS.length) {
          await delay(PROMO_SUMMARY_RETRY_BACKOFFS_MS[attempt]);
        }
      }
    }
    throw lastError;
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
        // is_sellable: true bloquea agregar al carrito un plato "agotado"
        // (is_sellable=false se sigue mostrando en la carta como is_sold_out=true).
        is_sellable: true,
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

    // QUI-648 — presentación de venta de la línea. Si el comprador ELIGIÓ una
    // (`price_tier_id`), se autoriza contra la tienda, el `kind='sale_unit'` y
    // el flag del comercio; si no la envía, NADA cambia respecto de hoy y se
    // usa la presentación por defecto. Esa asimetría es lo que hace la feature
    // no-regresiva por construcción.
    //
    // Se resuelve ANTES de validar stock a propósito: el inventario se mide en
    // UNIDADES y la línea cuenta PAQUETES, así que 1 bulto de 50 tiene que
    // validarse contra 50. Antes se validaba contra 1 y el checkout rechazaba
    // después la misma compra.
    //
    // Esta lectura NO se traga los errores: el precio que se persiste abajo
    // depende de ella, y caer en silencio a la cascada legacy es exactamente el
    // bug que se está cerrando (vitrina $100.000 / carrito $2.000).
    const saleUnit = await this.resolveLineSaleUnit(
      dto.product_id,
      dto.price_tier_id,
    );
    const packSize = this.storefrontPrice.resolvePackSizeForSaleUnit(saleUnit);

    await this.validateStock(product, variant, dto.quantity * packSize);

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

    const unit_price = this.calculateFinalPrice(
      productWithTaxes,
      variant,
      saleUnit,
    );

    // Buscar o crear el cart del usuario (store_id y user_id se aplican automáticamente)
    let cart = await this.prisma.carts.findFirst({});

    if (!cart) {
      const currency = await this.settingsService.getStoreCurrency();
      // QUI-628: same rationale as the create in getOrCreateCart.
      cart = await this.prisma.carts.create({
        data: {
          currency,
          state: 'active',
          last_activity_at: new Date(),
        },
      });
    } else {
      cart = await this.clearCartIfExpired(cart);
    }

    // Identidad de línea = (carrito, producto, variante, presentación).
    //
    // Un solo `findFirst` sobre las cuatro columnas, no la bifurcación anterior
    // entre `findUnique` (con variante) y `findFirst` (sin variante): esa rama
    // existía solo porque el accessor compuesto de Prisma no acepta `null`, y
    // dejaba dos caminos que había que mantener sincronizados a mano.
    //
    // La cuarta columna es la que permite que dos presentaciones del mismo
    // producto — "1 bulto" y "3 kilos" — convivan como dos líneas en vez de
    // fusionarse. El índice único que la respalda usa `NULLS NOT DISTINCT`
    // porque en estas líneas `product_variant_id` es SIEMPRE `NULL` (QUI-648:
    // un producto tiene presentaciones o variantes, nunca ambas), y bajo el
    // `NULLS DISTINCT` que Postgres trae por defecto el índice no protegería
    // absolutamente nada.
    const appliedPriceTierId = saleUnit?.tier.id ?? null;
    const existing_item = await this.prisma.cart_items.findFirst({
      where: {
        cart_id: cart.id,
        product_id: dto.product_id,
        product_variant_id: dto.product_variant_id ?? null,
        applied_price_tier_id: appliedPriceTierId,
      },
    });

    // `quantity` cuenta PAQUETES; `stock_units_consumed` guarda las unidades
    // reales que esa cantidad descuenta del inventario. Queda en `null` cuando
    // no hay empaque (packSize <= 1), para que el commit de stock distinga
    // "sin empaque" de "cero unidades" con su `stock_units_consumed ?? quantity`.
    if (existing_item) {
      const new_quantity = existing_item.quantity + dto.quantity;
      await this.validateMaxQuantity(new_quantity);
      await this.validateStock(product, variant, new_quantity * packSize);

      await this.prisma.cart_items.update({
        where: { id: existing_item.id },
        data: {
          quantity: new_quantity,
          stock_units_consumed:
            packSize > 1 ? new_quantity * packSize : null,
        },
      });
    } else {
      await this.prisma.cart_items.create({
        data: {
          cart_id: cart.id,
          product_id: dto.product_id,
          product_variant_id: dto.product_variant_id,
          quantity: dto.quantity,
          unit_price,
          applied_price_tier_id: appliedPriceTierId,
          stock_units_consumed: packSize > 1 ? dto.quantity * packSize : null,
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

    // Misma conversión que en `addItem`: la cantidad del DTO cuenta PAQUETES y
    // el validador mide UNIDADES de stock.
    //
    // La presentación sale de la TARIFA YA PERSISTIDA en la línea, no de volver
    // a resolver el default. Con selector, el default y lo que el comprador
    // eligió dejan de coincidir: reresolviendo, subir de 2 a 5 rollos validaría
    // y reservaría contra el pack del metro suelto. Y con `applied_price_tier_id`
    // en `NULL` la línea NO tiene presentación (packSize 1), que es justo lo que
    // dice su `stock_units_consumed`.
    const saleUnit = await this.resolveSaleUnitForExistingLine(
      item.product_id,
      (item as any).applied_price_tier_id ?? null,
    );
    const packSize = this.storefrontPrice.resolvePackSizeForSaleUnit(saleUnit);

    await this.validateStock(
      item.product,
      item.product_variant,
      dto.quantity * packSize,
    );

    await this.prisma.cart_items.update({
      where: { id: item_id },
      data: {
        quantity: dto.quantity,
        // Recalculado junto con la cantidad y nunca por separado: si se
        // actualizara solo `quantity`, la línea quedaría diciendo que 5 bultos
        // consumen las 100 unidades de los 2 anteriores, y el commit de stock
        // reservaría de menos sin que nada fallara.
        stock_units_consumed: packSize > 1 ? dto.quantity * packSize : null,
      },
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
          // La elección del invitado viaja en el localStorage y tiene que
          // sobrevivir al login; sin esto la sincronización la degradaría al
          // default en silencio y el cliente vería otro precio al entrar.
          price_tier_id: item.price_tier_id,
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

    // QUI-628: every cart mutation that touches items (add / update qty /
    // sync from localStorage / clear) flows through this helper, so refreshing
    // `last_activity_at` here is the single point that keeps the
    // abandoned-cart definition honest. Without this, "abandoned since N
    // minutes ago" would use created_at, which never moves and over-counts
    // active carts.
    //
    // QUI-628 review feedback (CRÍTICA): the cart row is reused per
    // (store_id, user_id) — `@@unique([store_id, user_id])`. After the
    // first checkout the row carried `converted_order_id IS NOT NULL` and
    // `state = 'converted'` forever, so subsequent carts the user built
    // and abandoned were never counted as abandoned, and subsequent
    // checkouts were never counted as recovered (the abandoned-carts
    // summary explicitly filters `converted_order_id IS NULL`). We reset
    // the cycle here: any cart mutation that produces items reopens the
    // cart for analytics purposes.
    await this.prisma.carts.update({
      where: { id: cart_id },
      data: {
        subtotal,
        updated_at: new Date(),
        last_activity_at: new Date(),
        state: 'active',
        converted_order_id: null,
        converted_at: null,
      },
    });
  }

  /**
   * QUI-628: stamp the user's cart as converted when an order is created from
   * it (ecommerce + whatsapp checkout flows). First-write-wins: only writes
   * when `converted_order_id IS NULL` (subsequent checkouts reuse the cart
   * row, and the FIRST order in the session is the one the metric attributes
   * the conversion to). The cart row is preserved so the analytics endpoint
   * can join carts to orders via converted_order_id. The cycle is reset by
   * `updateCartSubtotal` on the next cart mutation.
   *
   * Guest checkouts have no user-scoped cart on the server, so this is a
   * no-op for them — by design, guest checkouts are not "recovered carts" in
   * the abandoned-carts metric because we never tracked the cart in the first
   * place.
   */
  async markCartConverted(
    customerId: number,
    orderId: number,
    convertedAt: Date = new Date(),
  ): Promise<void> {
    if (!customerId) return;
    await this.prisma.carts.updateMany({
      where: {
        user_id: customerId,
        // Don't overwrite an existing conversion — first checkout wins.
        converted_order_id: null,
      },
      data: {
        state: 'converted',
        converted_order_id: orderId,
        converted_at: convertedAt,
      },
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
    // `stock_units` es aditivo y solo alimenta el cálculo de peso de envío del
    // frontend; el PRECIO no depende de esta lectura (viaja persistido en
    // `cart_items.unit_price`, resuelto al agregar). Por eso acá sí se degrada
    // en silencio: una falla leyendo la presentación devuelve packSize 1, que
    // es el número histórico, en vez de tumbar la vista del carrito.
    //
    // Se leen TODAS las presentaciones del producto, no solo la default: con
    // selector, dos líneas del mismo producto pueden estar en presentaciones
    // distintas y un mapa `product_id -> default` las pintaría a ambas con el
    // empaque equivocado.
    const saleUnitsByProduct = await this.listSaleUnitsForProducts(
      (cart.cart_items ?? []).map((ci: any) => ci.product_id),
    );

    const items = await Promise.all(
      cart.cart_items.map(async (item: any) => {
        // Use variant image if available, fallback to product main image
        const variant_image_url =
          item.product_variant?.product_images?.image_url || null;
        const product_image_url =
          item.product.product_images?.[0]?.image_url || null;
        const raw_image_url = variant_image_url || product_image_url;
        const signed_image_url = await this.s3Service.signUrl(raw_image_url);

        // REGLA DE DINERO: `unit_price` es el precio del PAQUETE entero y
        // `quantity` cuenta PAQUETES, así que el total NO se multiplica por
        // `pack_size`. El pack size solo desdobla el INVENTARIO.
        //
        // La presentación de la línea es la PERSISTIDA (`applied_price_tier_id`),
        // no la default del producto: es la que fijó el `unit_price` que el
        // cliente vio y la que el commit de stock va a honrar.
        const lineSaleUnit = this.pickSaleUnitForLine(
          saleUnitsByProduct,
          item.product_id,
          item.applied_price_tier_id ?? null,
        );
        const packSize =
          this.storefrontPrice.resolvePackSizeForSaleUnit(lineSaleUnit);

        return {
          id: item.id,
          product_id: item.product_id,
          product_variant_id: item.product_variant_id,
          quantity: item.quantity,
          // Unidades de stock que mueve la línea. El frontend lo necesita para
          // el peso de envío: 2 bultos de 50 kg pesan como 100 unidades, no
          // como 2.
          stock_units:
            resolveStockUnitsConsumed(item.quantity, packSize) ?? item.quantity,
          pack_size: packSize,
          // Presentación comercial de la línea, con las claves EXACTAS que ya
          // pinta `cart-item-card` ("Bulto x50 (50 und) — $100.000").
          // `presentation_price` es el precio del PAQUETE: el mismo
          // `unit_price` persistido, nunca `unit_price * units_per_package`.
          price_tier: lineSaleUnit
            ? {
                id: lineSaleUnit.tier.id,
                label: lineSaleUnit.tier.name,
                units_per_package: packSize,
                presentation_price: Number(item.unit_price),
              }
            : null,
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
   * Precio de la línea CON IMPUESTO — la misma cifra que publica la vitrina.
   *
   * Delega en `StorefrontPriceService` en vez de resolver la cascada por su
   * cuenta. Ese era el bug: el catálogo ya resolvía con presentación (mostraba
   * el precio del bulto) mientras esta función llamaba a `resolvePrice` a secas
   * (persistía el precio de la unidad) y el checkout volvía a resolver con
   * tarifa (cobraba el bulto). Tres lecturas del mismo producto, tres cifras.
   *
   * `saleUnit` llega ya resuelto por el caller: este servicio no lo lee acá
   * para no volver la línea N+1 ni esconder una consulta dentro de un cálculo.
   */
  private calculateFinalPrice(
    product: any,
    variant?: any,
    saleUnit?: DefaultSaleUnit | null,
  ): number {
    return this.storefrontPrice.resolveLine({
      product,
      variant: variant ?? null,
      saleUnit: saleUnit ?? null,
      taxRate: this.storefrontPrice.getTotalTaxRate(product),
    }).gross_unit_price;
  }

  /**
   * Presentación por defecto de UN producto.
   *
   * No se traga los errores a propósito: los callers que la usan persisten o
   * cotizan dinero, y caer en silencio a la cascada legacy devuelve el precio
   * de la unidad donde el checkout cobrará el del paquete. Preferimos fallar
   * ruidosamente antes que vender a un precio que no se va a honrar.
   */
  private async resolveSaleUnit(
    productId: number,
  ): Promise<DefaultSaleUnit | null> {
    // Con el SELECTOR ENCENDIDO, una línea sin `price_tier_id` es la UNIDAD
    // SUELTA, no "no eligió". La vitrina ofrece la unidad como un chip más y
    // la card no deja agregar a ciegas cuando hay varias opciones, así que la
    // ausencia de tarifa ya es una elección. Rellenarla con la presentación
    // marcada era el bug visible: el chip decía $1.000 y el carrito cobraba
    // $2.000, el precio del "Kilo" que el comprador no eligió.
    //
    // Con el selector APAGADO no cambia nada: la presentación por defecto
    // sigue rigiendo, que es la cascada histórica de toda tienda que no
    // estrenó la feature.
    if (await this.isSaleUnitSelectorEnabled()) {
      const fallbacks = await this.resolveLooseUnitFallbacks([
        Number(productId),
      ]);
      // El fallback SOLO devuelve algo si el producto apagó su unidad suelta.
      return fallbacks.get(Number(productId)) ?? null;
    }

    return resolveDefaultSaleUnit(this.prisma as any, Number(productId));
  }

  /** Versión en LOTE, para no pagar una consulta por línea del carrito. */
  private async resolveSaleUnitsForProducts(
    productIds: number[],
  ): Promise<Map<number, DefaultSaleUnit>> {
    const ids = (productIds ?? []).map((id) => Number(id));
    // Misma regla que `resolveSaleUnit`, en lote.
    if (await this.isSaleUnitSelectorEnabled()) {
      return this.resolveLooseUnitFallbacks(ids);
    }
    return resolveDefaultSaleUnits(this.prisma as any, ids);
  }

  /**
   * Productos que apagaron su unidad suelta: la presentación que debe aplicarse
   * a una línea que no eligió ninguna.
   *
   * Sin esto, apagar "ofrecer la unidad suelta" solo escondía el chip: el
   * `POST /cart/items` sin `price_tier_id` seguía vendiendo la botella. Nunca
   * lanza — el peor caso es la cascada de precio de siempre.
   */
  private async resolveLooseUnitFallbacks(
    productIds: number[],
  ): Promise<Map<number, DefaultSaleUnit>> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return new Map();
    return resolveLooseUnitFallbacks(
      this.prisma as any,
      productIds,
      storeId,
    );
  }

  /**
   * ¿La tienda dejó que el comprador elija presentación?
   *
   * DEFAULT `false`, y por eso se compara con `=== true` y NO con el
   * `!== false` de `show_variants`: ese flag nació encendido, éste nace
   * apagado. Con `!== false`, toda tienda existente —cuyos settings ni
   * mencionan la clave— estrenaría el selector sin haberlo pedido.
   */
  private async isSaleUnitSelectorEnabled(): Promise<boolean> {
    try {
      const settings = await this.settingsService.getSettings();
      return (
        (settings as any)?.ecommerce?.catalog?.enable_sale_unit_selector ===
        true
      );
    } catch {
      // Sin settings legibles el selector queda apagado: fallar cerrado deja
      // el carrito exactamente como antes de la feature.
      return false;
    }
  }

  /**
   * Presentación de una línea NUEVA: la ELEGIDA por el comprador si la envía,
   * la default de la tienda si no.
   *
   * Sin `price_tier_id` no se toca ni una consulta nueva ni una regla nueva —
   * ése es el camino de todos los clientes que no se actualicen.
   *
   * Con `price_tier_id`, `resolvePublicSaleUnitSelections` es la única puerta:
   * lanza `ECOM_SALE_UNIT_001` si el comercio no publicó el selector y
   * `PRICE_TIER_NOT_ALLOWED` si la tarifa no existe, está inactiva, es de otra
   * tienda, no es `sale_unit` o no está asignada a ese producto.
   */
  private async resolveLineSaleUnit(
    productId: number,
    priceTierId?: number | null,
  ): Promise<DefaultSaleUnit | null> {
    if (priceTierId === undefined || priceTierId === null) {
      return this.resolveSaleUnit(productId);
    }

    const selectionEnabled = await this.isSaleUnitSelectorEnabled();
    const [selected] = await resolvePublicSaleUnitSelections(
      this.prisma as any,
      [{ product_id: Number(productId), price_tier_id: Number(priceTierId) }],
      { storeId: this.requireStoreId(), selectionEnabled },
    );
    return selected ?? null;
  }

  /**
   * Presentación de una línea QUE YA EXISTE, resuelta por la tarifa persistida.
   *
   * `selectionEnabled: true` a propósito: el flag gatea la ELECCIÓN, no el
   * mantenimiento de una línea que ya fue autorizada cuando se agregó. Apagar
   * el selector no puede dejar al comprador sin poder cambiar la cantidad de lo
   * que ya tiene en el carrito. Las defensas duras —tienda, `kind`, asignación,
   * `is_active`— siguen aplicando, así que una tarifa retirada devuelve
   * `PRICE_TIER_NOT_ALLOWED` en vez de degradar en silencio a packSize 1 y
   * reservar de menos.
   */
  private async resolveSaleUnitForExistingLine(
    productId: number,
    appliedPriceTierId: number | null,
  ): Promise<DefaultSaleUnit | null> {
    if (appliedPriceTierId === null || appliedPriceTierId === undefined) {
      return null;
    }
    const [selected] = await resolvePublicSaleUnitSelections(
      this.prisma as any,
      [
        {
          product_id: Number(productId),
          price_tier_id: Number(appliedPriceTierId),
        },
      ],
      { storeId: this.requireStoreId(), selectionEnabled: true },
    );
    return selected ?? null;
  }

  /**
   * Todas las presentaciones publicables de un lote de productos, indexadas por
   * producto. Nunca lanza: es una lectura de PRESENTACIÓN, y el precio de la
   * línea ya viaja persistido, así que una falla degrada a packSize 1 (el
   * número histórico) en vez de tumbar la vista del carrito.
   */
  private async listSaleUnitsForProducts(
    productIds: number[],
  ): Promise<Map<number, DefaultSaleUnit[]>> {
    try {
      const storeId = RequestContextService.getStoreId();
      if (!storeId) return new Map();
      const { byProduct } = await listPublicSaleUnitsForProducts(
        this.prisma as any,
        (productIds ?? []).map((id) => Number(id)),
        storeId,
      );
      return byProduct;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve cart sale units: ${error?.message ?? error}`,
      );
      return new Map();
    }
  }

  /**
   * La presentación de UNA línea dentro del lote leído por
   * `listSaleUnitsForProducts`.
   *
   * `applied_price_tier_id` en `NULL` significa "esta línea NO tiene
   * presentación" y devuelve `null` (packSize 1). No se cae al default del
   * producto: la fila persiste también `stock_units_consumed` en `NULL`, y
   * pintar un empaque que el commit de stock no va a aplicar es mentirle al
   * comprador sobre el peso de su envío.
   */
  private pickSaleUnitForLine(
    byProduct: Map<number, DefaultSaleUnit[]>,
    productId: number,
    appliedPriceTierId: number | null,
  ): DefaultSaleUnit | null {
    if (appliedPriceTierId === null || appliedPriceTierId === undefined) {
      return null;
    }
    const options = byProduct.get(Number(productId)) ?? [];
    return (
      options.find((o) => o.tier.id === Number(appliedPriceTierId)) ?? null
    );
  }

  /**
   * `store_id` de la petición. Es la ÚNICA defensa contra vender con una tarifa
   * de otra tienda: `product_price_tier_assignments` no tiene FK que ate
   * `price_tier.store_id` a `product.store_id`, así que una fila cruzada es
   * representable en la base. Nunca se deriva del producto.
   */
  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return Number(storeId);
  }

  /**
   * Valida disponibilidad en UNIDADES DE STOCK.
   *
   * El parámetro NO es la cantidad de la línea: el caller ya la multiplicó por
   * el pack size. Vender 1 bulto de 50 consume 50 unidades, y validar contra 1
   * dejaba pasar carritos que el checkout rechazaba después
   * (`assertPackagedStockAvailability`), es decir, el cliente descubría el
   * faltante recién al pagar.
   */
  private async validateStock(
    product: any,
    variant: any,
    stockUnits: number,
  ) {
    const shouldTrack = this.stockValidatorService.resolveEffectiveTracking(
      product,
      variant ?? undefined,
    );

    if (!shouldTrack) return;

    const availability = await this.stockValidatorService.validateAvailability(
      product.id,
      variant?.id,
      stockUnits,
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
    /**
     * Presentación elegida por el INVITADO (su carrito vive en localStorage y
     * no tiene fila que la persista). Se autoriza igual que en `addItem`: el
     * cotizador no puede ofrecer un precio que la escritura rechazaría.
     */
    price_tier_id?: number | null;
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
      /**
       * Human-readable labels for the products/categories the discount was
       * applied to. Empty for `scope: 'order'` (whole order). Used by the
       * cart summary UI to render "(Guanabana, Mango)" next to the promo
       * name so the customer knows exactly which line got the discount.
       */
      applicable_descriptions?: Array<{
        label: string;
        kind: 'product' | 'category';
      }>;
    }>;
    tier_progress: Array<{
      promotion_id: number;
      name: string;
      remaining_quantity: number;
      benefit_type: 'percentage' | 'fixed_amount';
      benefit_value: number;
    }>;
    /**
     * Per-product tier ladder for the promotions that already touched the
     * cart. Surfaced so the cart UI can render the full ladder next to each
     * line ("Lleva 3 → -10% · Lleva 6 → -15% …") without re-querying the
     * backend. Same shape as `ActiveProductPromotion.quantity_tiers`
     * (`QuantityTierSummary[]`), plus the index of the tier the current
     * quantity is sitting on (`null` when the cart has fewer units than
     * the first threshold). Omitted from the response when the cart has
     * no quantity_tiered promotions in scope.
     */
    per_product_tier_ladder?: Array<{
      promotion_id: number;
      target_product_id: number;
      tiers: Array<{
        min_quantity: number;
        max_quantity: number | null;
        type: 'percentage' | 'fixed_amount';
        value: number;
        sort_order: number;
      }>;
      current_tier_index: number | null;
    }>;
  }> {
    // Auth users: prefer the backend cart so quantities are server-side
    // canonical. Guests: use the DTO items array as the source of truth.
    // `product_name` is retained alongside `product_id` so the cart UI can
    // show which line the discount was applied to (Phase 4 — products on
    // promotions).
    //
    // ESCALA DEL SUMMARY — unificada en CON IMPUESTO.
    //
    // Las dos ramas publicaban números distintos para el MISMO carrito: la de
    // invitado resolvía el precio NETO y la de sesión leía
    // `cart_items.unit_price`, que se persiste CON impuesto. Un mismo carrito
    // cotizaba dos subtotales según hubiera sesión o no, y el descuento
    // promocional salía calculado sobre bases distintas. Se unifica en CON
    // IMPUESTO porque es lo que muestra `subtotal` en la vista del carrito.
    let resolvedItems: Array<{
      product_id: number;
      product_name: string;
      product_variant_id: number | null;
      quantity: number;
      unit_price: number;
      applied_price_tier_id: number | null;
      stock_units_consumed: number | null;
    }> = [];

    if (items && items.length > 0) {
      const saleUnits = await this.resolveSaleUnitsForProducts(
        items.map((i) => i.product_id),
      );
      // Elección del comprador, AUTORIZADA y alineada POR ÍNDICE. Nunca un mapa
      // por `product_id`: "2 bultos + 3 kilos del mismo producto" son dos
      // líneas legítimas y un mapa las colapsaría en una sola presentación.
      // Sin ningún `price_tier_id` en el lote esto no toca la base y devuelve
      // puros `null`, así que la cascada de siempre queda intacta.
      const selectionEnabled = items.some(
        (i) => i.price_tier_id !== undefined && i.price_tier_id !== null,
      )
        ? await this.isSaleUnitSelectorEnabled()
        : false;
      const selections = await resolvePublicSaleUnitSelections(
        this.prisma as any,
        items.map((i) => ({
          product_id: Number(i.product_id),
          price_tier_id:
            i.price_tier_id === undefined || i.price_tier_id === null
              ? null
              : Number(i.price_tier_id),
        })),
        {
          storeId: Number(RequestContextService.getStoreId() ?? 0),
          selectionEnabled,
        },
      );
      resolvedItems = await Promise.all(
        items.map(async (item, index) => {
          const product = await this.prisma.products.findUnique({
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
          if (!product) {
            return null;
          }
          const variant = item.product_variant_id
            ? await this.prisma.product_variants.findUnique({
                where: { id: item.product_variant_id },
              })
            : null;
          const saleUnit =
            selections[index] ?? saleUnits.get(item.product_id) ?? null;
          const line = this.storefrontPrice.resolveLine({
            product,
            variant,
            saleUnit,
            quantity: item.quantity,
            taxRate: this.storefrontPrice.getTotalTaxRate(product),
          });
          return {
            product_id: item.product_id,
            product_name: product.name,
            product_variant_id: item.product_variant_id ?? null,
            quantity: item.quantity,
            unit_price: line.gross_unit_price,
            applied_price_tier_id: line.applied_price_tier_id,
            stock_units_consumed: line.stock_units_consumed,
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
      // The cart_items rows do not denormalize the product name; pull the
      // names in a single batch query to avoid N+1.
      // `Set<number>` explícito: el cliente Prisma con alcance devuelve el
      // carrito sin tipar, así que sin la anotación el conjunto sale
      // `Set<unknown>` y `listSaleUnitsForProducts(number[])` no compila. El
      // `where: { in }` de Prisma sí lo aceptaba, que es por lo que el error
      // solo aparecía al construir con tsc.
      const cartProductIds = Array.from(
        new Set<number>(cart.cart_items.map((ci: any) => ci.product_id)),
      );
      const cartProducts = await this.prisma.products.findMany({
        where: { id: { in: cartProductIds } },
        select: { id: true, name: true },
      });
      const cartProductName = new Map<number, string>(
        cartProducts.map((p) => [p.id, p.name]),
      );
      // La presentación de cada línea sale de su `applied_price_tier_id`
      // PERSISTIDO, para poder decirle al motor de promociones que la línea ya
      // viene en escala de paquete. Antes se releía el default del producto:
      // con selector eso cotizaría dos líneas distintas del mismo producto con
      // el mismo empaque. `unit_price` no se recalcula: la fila guarda el
      // precio CON impuesto que se resolvió al agregar, y ese es el número que
      // el cliente vio.
      const cartSaleUnits = await this.listSaleUnitsForProducts(cartProductIds);
      resolvedItems = cart.cart_items.map((ci) => {
        const saleUnit = this.pickSaleUnitForLine(
          cartSaleUnits,
          ci.product_id,
          (ci as any).applied_price_tier_id ?? null,
        );
        const packSize =
          this.storefrontPrice.resolvePackSizeForSaleUnit(saleUnit);
        return {
          product_id: ci.product_id,
          product_name: cartProductName.get(ci.product_id) ?? '',
          product_variant_id: ci.product_variant_id,
          quantity: ci.quantity,
          unit_price: Number(ci.unit_price),
          applied_price_tier_id: saleUnit?.tier.id ?? null,
          stock_units_consumed: resolveStockUnitsConsumed(
            ci.quantity,
            packSize,
          ),
        };
      });
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
        // Señal de "esta línea ya viene en escala de paquete". Sin ella, un
        // producto que además declara escala (`price_unit_quantity > 1`) hace
        // que el motor vuelva a dividir el precio del paquete por la escala y
        // cotice de menos.
        applied_price_tier_id: item.applied_price_tier_id,
        stock_units_consumed: item.stock_units_consumed,
      })),
      customer_id: RequestContextService.getUserId() ?? null,
    });

    // Per-product tier ladder for promotions that touched this cart. Fed by
    // `getTierLaddersForQuote`, which fans out one batched read of
    // `promotion_quantity_tiers` plus `promotion_products` and returns one
    // entry per (promotion_id, target_product_id). We narrow the result to
    // promos that already have items in scope — the SAME
    // `(promotion_id, target_product_id)` pairs that `tier_progress` named,
    // which keeps the ladder consistent with the "next tier" nudge the
    // customer is already seeing. Without this filter the engine would emit
    // ladders for EVERY tiered promo with `promotion_products`, even when
    // the cart has no relevant line — and the UI would render orphan
    // ladders. Wrapped in try/catch so a failed tier read NEVER breaks the
    // cart: log WARN and continue with the field omitted.
    let per_product_tier_ladder:
      | Array<{
          promotion_id: number;
          target_product_id: number;
          tiers: Array<{
            min_quantity: number;
            max_quantity: number | null;
            type: 'percentage' | 'fixed_amount';
            value: number;
            sort_order: number;
          }>;
          current_tier_index: number | null;
        }>
      | undefined;
    try {
      const promotionIds = Array.from(
        new Set<number>([
          ...quote.applied_promotions.map((p) => Number(p.promotion_id)),
          ...quote.tier_progress.map((t) => Number(t.promotion_id)),
        ]),
      );
      if (promotionIds.length > 0) {
        const ladders =
          await this.promotionEngine.getTierLaddersForQuote(
            promotionIds,
            resolvedItems.map((i) => ({
              product_id: i.product_id,
              quantity: i.quantity,
              stock_units_consumed: i.stock_units_consumed,
            })),
          );
        // Keep only ladders whose (promotion_id, target_product_id) is also
        // named by `tier_progress`. This matches the engine's "items in
        // scope" gate and prevents rendering orphan ladders when the cart
        // has no qualifying line.
        const scopedPairs = new Set<string>(
          quote.tier_progress
            .map((t) =>
              t.target_product_id != null
                ? `${Number(t.promotion_id)}:${Number(t.target_product_id)}`
                : null,
            )
            .filter((k): k is string => k !== null),
        );
        const filtered = ladders.filter((l) =>
          scopedPairs.has(
            `${Number(l.promotion_id)}:${Number(l.target_product_id)}`,
          ),
        );
        if (filtered.length > 0) {
          per_product_tier_ladder = filtered;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve cart per_product_tier_ladder: ${error?.message ?? error}`,
      );
      // Leave the field undefined: cart must keep serving 200.
    }

    // Pre-fetch category names only if any applied promotion has scope
    // 'category'. Avoids the join when not needed.
    const appliedCategories = quote.applied_promotions.filter(
      (p) => p.scope === 'category',
    );
    let categoryLabelMap = new Map<number, string>();
    if (appliedCategories.length > 0) {
      const allCategoryIds = Array.from(
        new Set(
          appliedCategories.flatMap((p) =>
            (p.applicable_item_ids ?? [])
              .map((lineId) => {
                const idx =
                  typeof lineId === 'number' ? lineId : Number(lineId);
                const item = Number.isFinite(idx)
                  ? resolvedItems[idx]
                  : undefined;
                return item
                  ? (categoryMap.get(item.product_id) ?? [])
                  : [];
              })
              .flat(),
          ),
        ),
      );
      if (allCategoryIds.length > 0) {
        const categoryNameRows =
          await this.prisma.categories.findMany({
            where: { id: { in: allCategoryIds } },
            select: { id: true, name: true },
          });
        categoryLabelMap = new Map<number, string>(
          categoryNameRows.map((c) => [c.id, c.name]),
        );
      }
    }

    return {
      subtotal: quote.subtotal,
      promotion_discount: quote.total_discount,
      promotional_subtotal: quote.promotional_subtotal,
      item_count: resolvedItems.reduce((sum, i) => sum + i.quantity, 0),
      applied_promotions: quote.applied_promotions.map((p) => {
        const base = {
          promotion_id: p.promotion_id,
          name: p.name,
          type: p.type,
          scope: p.scope,
          discount_amount: p.discount_amount,
          // Surfaced for the cart UI audit trail. With the winner-takes-all
          // engine, an order has at most one entry here.
          priority: p.priority,
          // product_ids that actually unlocked the discount under
          // `per_product` grouping. Empty for `cart_total` promos — the
          // frontend uses this to render "en: Producto X, Producto Y" next
          // to the applied promotion name and resolve it locally against
          // `cart.items[]`.
          target_product_ids: p.target_product_ids ?? [],
        };

        // QUI-515: `applicable_descriptions` se CONSERVA junto al campo nuevo,
        // no se reemplaza. Los dos responden preguntas distintas:
        //   - target_product_ids → "qué SKU desbloqueó la promo per_product"
        //   - applicable_descriptions → "a qué líneas se aplicó el descuento"
        // El segundo es el que hoy alimenta la etiqueta "(Guanabana, Mango)"
        // en promos `cart_total` de scope producto/categoría. Si se borra, esas
        // promos pierden esa etiqueta y el cliente deja de saber sobre qué se
        // le aplicó el descuento. Además `categoryLabelMap` arriba ya paga la
        // query de nombres de categoría, así que sin este consumidor esa
        // consulta quedaría sin uso.
        if (p.scope === 'order') {
          // Scope 'order': el descuento va sobre todo el carrito, no hay
          // etiquetas por línea que mostrar.
          return { ...base, applicable_descriptions: [] };
        }

        // `applicable_item_ids` trae los `line_id` que el engine recibió, y
        // esos line_id SON el índice de `resolvedItems` (ver el map de
        // `quoteDiscounts` arriba: `line_id: index`), así que indexar es
        // correcto.
        const labels: Array<{ label: string; kind: 'product' | 'category' }> =
          [];
        const seenLabel = new Set<string>();
        for (const lineId of p.applicable_item_ids ?? []) {
          const idx = typeof lineId === 'number' ? lineId : Number(lineId);
          if (!Number.isFinite(idx)) continue;
          const item = resolvedItems[idx];
          if (!item) continue;

          if (p.scope === 'product') {
            const label = item.product_name;
            if (label && !seenLabel.has(label)) {
              seenLabel.add(label);
              labels.push({ label, kind: 'product' });
            }
          } else if (p.scope === 'category') {
            for (const categoryId of categoryMap.get(item.product_id) ?? []) {
              const label = categoryLabelMap.get(categoryId);
              if (label && !seenLabel.has(label)) {
                seenLabel.add(label);
                labels.push({ label, kind: 'category' });
              }
            }
          }
        }
        return { ...base, applicable_descriptions: labels };
      }),
      // Each entry may include `target_product_id` (populated by the engine
      // for `per_product` promos) which the banner uses to name the SKU.
      tier_progress: quote.tier_progress,
      // Conditional spread: omit the field when no ladders survive the
      // (promotion_id, target_product_id) filter above. Empty array and
      // absent field are distinguishable in the JSON response (the latter
      // is what the cart UI sees when the cart has no tiered promos).
      ...(per_product_tier_ladder
        ? { per_product_tier_ladder }
        : {}),
    };
  }
}

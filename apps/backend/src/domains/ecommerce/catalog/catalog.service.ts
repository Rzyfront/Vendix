import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CatalogQueryDto, ProductSortBy } from './dto/catalog-query.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import type {
  ActiveProductPromotion,
  ActivePromotionProductInput,
} from '../../store/promotions/dto/promotion-quote.interface';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly storePrisma: StorePrismaService,
    private readonly s3Service: S3Service,
    private readonly priceResolverService: PriceResolverService,
    private readonly promotionEngine: PromotionEngineService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getProducts(query: CatalogQueryDto) {
    const {
      search,
      category_id,
      category_ids,
      brand_id,
      brand_ids,
      ids,
      min_price,
      max_price,
      sort_by = ProductSortBy.NEWEST,
      page = 1,
      limit = 20,
    } = query;

    const skip = (page - 1) * limit;
    const store_id = RequestContextService.getStoreId();
    const catalogSettings = await this.getCatalogSettings(store_id);

    const where: any = {
      state: 'active',
      available_for_ecommerce: true,
      // store_id se aplica automáticamente por EcommercePrismaService
    };
    const andFilters: any[] = [];
    const categoryIds = this.mergeIdFilters(category_id, category_ids);
    const brandIds = this.mergeIdFilters(brand_id, brand_ids);

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryIds.length > 0) {
      where.product_categories = {
        some: {
          category_id:
            categoryIds.length === 1 ? categoryIds[0] : { in: categoryIds },
        },
      };
    }

    if (brandIds.length > 0) {
      where.brand_id = brandIds.length === 1 ? brandIds[0] : { in: brandIds };
    }

    if (ids) {
      const idList = ids
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => !isNaN(id));

      if (idList.length > 0) {
        where.id = { in: idList };
      }
    }

    if (min_price !== undefined) {
      where.base_price = { ...where.base_price, gte: min_price };
    }
    if (max_price !== undefined) {
      where.base_price = { ...where.base_price, lte: max_price };
    }

    // `has_discount=true` filters products that should show some kind of
    // promotional badge on the card. We surface either:
    //  (a) products with an explicit sale price (is_on_sale = true), or
    //  (b) products eligible for an active auto-apply promotion by
    //      scope=product (direct) or scope=category (via product_categories).
    // Order-scope promotions are not included because they depend on cart
    // context, not on the product itself.
    if (String(query.has_discount) === 'true') {
      const promotedProductIds =
        await this.fetchPromotedProductIdsForActiveAutoPromotions();
      const promotionalIdFilter =
        promotedProductIds.length > 0
          ? [{ id: { in: promotedProductIds } }]
          : [];
      andFilters.push({
        OR: [{ is_on_sale: true }, ...promotionalIdFilter],
      });
    }

    if (String(query.is_featured) === 'true') {
      where.is_featured = true;
    }

    if (catalogSettings.show_out_of_stock !== true) {
      andFilters.push({
        OR: [
          { product_type: 'service' },
          { track_inventory: false },
          { stock_quantity: { gt: 0 } },
          {
            product_variants: {
              some: {
                OR: [
                  { track_inventory_override: false },
                  { stock_quantity: { gt: 0 } },
                ],
              },
            },
          },
        ],
      });
    }

    if (andFilters.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...andFilters,
      ];
    }

    let orderBy: any;
    let explicitIds: number[] | null = null;

    if (sort_by === ProductSortBy.BEST_SELLING && store_id) {
      // 1. Intentar obtener IDs de caché o base de datos
      explicitIds = await this.getBestSellingFromCache(store_id);
      if (!explicitIds) {
        explicitIds = await this.fetchBestSellingIds(store_id, Number(limit));
        await this.setBestSellingCache(store_id, explicitIds);
      }

      // Si no hay ventas suficientes, rellenar con productos nuevos
      // Pero esto lo haremos en la query principal si es necesario
      if (explicitIds.length > 0) {
        // Si tenemos IDs, priorizamos estos.
        // Prisma no tiene un "sortByField" nativo fácil, así que lo ideal es traerlos
        // y luego si faltan, traer más.
        // Ojo: Si hay filtros activos (search, category), la lista de best selling
        // podría reducirse al aplicar esos filtros.
        // Para simplificar: Si ordenamos por ventas, usamos los IDs en el WHERE
        // pero SOLO si no estamos filtrando agresivamente.
        // Si el usuario filtra por categoría, el "best selling" debería ser "best selling de esa categoría".
        // Por complejidad, implementaremos:
        // Si sort_by=BEST_SELLING, ordenamos por created_at (fallback) pero
        // intentamos boostear los productos populares si no hay otros filtros complejos.
        // Dado el requerimiento exacto: "productos destacados... listado... mas vendidos el ultimo mes"
        // esto suele ser una sección HOME sin filtros.
        // Asumiremos que si se pide BEST_SELLING, se quiere esa lista específica.
      }
    }

    // Configuración de Ordenamiento Estándar
    switch (sort_by) {
      case ProductSortBy.NAME:
        orderBy = { name: 'asc' };
        break;
      case ProductSortBy.PRICE_ASC:
        orderBy = { base_price: 'asc' };
        break;
      case ProductSortBy.PRICE_DESC:
        orderBy = { base_price: 'desc' };
        break;
      case ProductSortBy.BEST_SELLING:
        // Si es best selling, no confiamos en el orderBy de DB para el orden exacto de IDs
        // pero usaremos created_at como fallback para el resto
        orderBy = { created_at: 'desc' };
        break;
      case ProductSortBy.OLDEST:
        orderBy = { created_at: 'asc' };
        break;
      case ProductSortBy.NEWEST:
      default:
        orderBy = { created_at: 'desc' };
    }

    // Caso Especial: Best Selling (Lógica de mezcla)
    if (
      sort_by === ProductSortBy.BEST_SELLING &&
      explicitIds &&
      explicitIds.length > 0
    ) {
      // Opción A: Traer los productos de la lista de IDs (respetando filtros si los hay)
      // Y luego traer el resto si falta para llenar el límite.
      // Debido a la paginación y filtros combinados, esto es complejo.
      // Simplificación para el HOME (sin filtros search/category usualmente):

      const whereBestSelling = { ...where, id: { in: explicitIds } };

      const [bestSellingProducts, totalBest] = await Promise.all([
        this.prisma.products.findMany({
          where: whereBestSelling,
          include: {
            product_images: { where: { is_main: true }, take: 1 },
            brands: { select: { id: true, name: true } },
            product_categories: {
              include: {
                categories: { select: { id: true, name: true, slug: true } },
              },
            },
            product_tax_assignments: {
              include: {
                tax_categories: {
                  include: {
                    tax_rates: true,
                  },
                },
              },
            },
            stock_levels: {
              select: {
                product_variant_id: true,
                quantity_available: true,
              },
            },
            _count: { select: { product_variants: true } },
          },
        }),
        this.prisma.products.count({ where: whereBestSelling }),
      ]);

      // Ordenar manualmente según el array de IDs
      const sortedBestSelling = bestSellingProducts.sort((a, b) => {
        return explicitIds.indexOf(a.id) - explicitIds.indexOf(b.id);
      });

      let finalData = sortedBestSelling;

      // Si faltan productos para llenar la página 1 (limit), rellenar con nuevos
      if (finalData.length < limit && page === 1) {
        const needed = Number(limit) - finalData.length;
        const excludeIds = finalData.map((p) => p.id);

        const fallbackProducts = await this.prisma.products.findMany({
          where: { ...where, id: { notIn: excludeIds } },
          take: needed,
          orderBy: { created_at: 'desc' },
          include: {
            product_images: { where: { is_main: true }, take: 1 },
            brands: { select: { id: true, name: true } },
            product_categories: {
              include: {
                categories: { select: { id: true, name: true, slug: true } },
              },
            },
            product_tax_assignments: {
              include: {
                tax_categories: {
                  include: {
                    tax_rates: true,
                  },
                },
              },
            },
            stock_levels: {
              select: {
                product_variant_id: true,
                quantity_available: true,
              },
            },
            _count: { select: { product_variants: true } },
          },
        });

        finalData = [...finalData, ...fallbackProducts];
      }

      // Si estamos en página > 1, usamos el comportamiento estándar (Newest)
      // o podríamos implementar paginación híbrida compleja, pero para "Destacados" suele ser solo 1 página.
      if (page > 1) {
        // Fallback a comportamiento normal para páginas siguientes
        // O devolver vacío si solo queremos mostrar los destacados en home.
        // El requerimiento dice "listado... 16 productos". Asumimos una sola carga.
        // Para robustez, si piden pagina 2 con best_selling, devolvemos newest ignorando los best selling ya mostrados?
        // Simplificaremos: paginación normal sobre "newest" para páginas > 1
        // O simplemente devolvemos vacío si es muy complejo.
        // Lo mejor: Comportamiento normal (orderBy created_at) para page > 1
      } else {
        const activePromotionsByProductId =
          await this.resolveActivePromotionsForListing(finalData);
        const mappedData = await Promise.all(
          finalData.map((p) =>
            this.mapProductToResponse(
              p,
              activePromotionsByProductId.get(p.id) ?? null,
            ),
          ),
        );

        return {
          data: mappedData,
          meta: {
            total: totalBest < limit ? Number(limit) : totalBest, // Estimado
            page: Number(page),
            limit: Number(limit),
            total_pages: 1, // Simplificado para sección destacados
          },
        };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.products.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy,
        include: {
          product_images: {
            where: { is_main: true },
            take: 1,
          },
          brands: {
            select: { id: true, name: true },
          },
          product_categories: {
            include: {
              categories: {
                select: { id: true, name: true, slug: true },
              },
            },
          },
          product_tax_assignments: {
            include: {
              tax_categories: {
                include: {
                  tax_rates: true,
                },
              },
            },
          },
          // Source of truth de disponibilidad para card del listado.
          // Incluye filas base y de variantes; el mapper decide cuál sumar.
          stock_levels: {
            select: {
              product_variant_id: true,
              quantity_available: true,
            },
          },
          _count: { select: { product_variants: true } },
        },
      }),
      this.prisma.products.count({ where }),
    ]);

    const activePromotionsByProductId =
      await this.resolveActivePromotionsForListing(data);
    const mappedData = await Promise.all(
      data.map((product) =>
        this.mapProductToResponse(
          product,
          activePromotionsByProductId.get(product.id) ?? null,
        ),
      ),
    );

    return {
      data: mappedData,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async getProductBySlug(slug: string) {
    const reviews_enabled = await this.areReviewsEnabled();
    const include: any = {
      product_images: {
        orderBy: { sort_order: 'asc' },
      },
      brands: true,
      product_categories: {
        include: {
          categories: true,
        },
      },
      product_variants: {
        include: {
          product_images: true,
          // Source of truth de disponibilidad por variante.
          stock_levels: {
            select: {
              quantity_available: true,
            },
          },
        },
      },
      // Stock base del producto (cuando NO hay variantes).
      stock_levels: {
        select: {
          product_variant_id: true,
          quantity_available: true,
        },
      },
      product_tax_assignments: {
        include: {
          tax_categories: {
            include: {
              tax_rates: true,
            },
          },
        },
      },
    };

    if (reviews_enabled) {
      include.reviews = {
        where: { state: 'approved' },
        include: {
          users: {
            select: { first_name: true, last_name: true },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      };
    }

    const product = await this.prisma.products.findFirst({
      where: {
        ...(isNaN(Number(slug)) ? { slug } : { id: Number(slug) }),
        state: 'active',
        available_for_ecommerce: true,
        // store_id se aplica automáticamente por EcommercePrismaService
      },
      include,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return await this.mapProductDetailToResponse(product, reviews_enabled);
  }

  async getCategories() {
    const categories = await this.prisma.categories.findMany({
      where: {
        state: 'active',
        // store_id se aplica automáticamente por EcommercePrismaService
      },
      orderBy: [{ is_featured: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image_url: true,
        is_featured: true,
      },
    });

    return await Promise.all(
      categories.map(async (cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        image_url: await this.s3Service.signUrl(cat.image_url),
        is_featured: cat.is_featured,
      })),
    );
  }

  async getBrands() {
    const store_id = RequestContextService.getStoreId();

    const brands = await this.prisma.brands.findMany({
      where: {
        state: 'active',
        store_id,
      },
      orderBy: [{ is_featured: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        logo_url: true,
        is_featured: true,
      },
    });

    return await Promise.all(
      brands.map(async (brand) => ({
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
        is_featured: brand.is_featured,
      })),
    );
  }

  async getPublicConfig() {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) return {};

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      include: {
        store_settings: true,
      },
    });
    const settings = (store?.store_settings?.settings || {}) as any;
    const has_configured_shipping = await this.hasConfiguredShipping();

    return {
      ...settings,
      ecommerce: {
        ...(settings.ecommerce || {}),
        shipping: {
          ...(settings.ecommerce?.shipping || {}),
          has_configured_shipping,
        },
      },
    };
  }

  private mergeIdFilters(singleId?: number, csvIds?: string): number[] {
    const ids = [...(singleId ? [singleId] : []), ...this.parseIdList(csvIds)];

    return [...new Set(ids)];
  }

  private parseIdList(value?: string): number[] {
    if (!value) return [];

    return value
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  private async hasConfiguredShipping(): Promise<boolean> {
    const active_rates = await this.storePrisma.shipping_rates.count({
      where: {
        is_active: true,
        shipping_zone: {
          is_active: true,
          is_system: false,
        },
        shipping_method: {
          is_active: true,
          is_system: false,
          type: { not: 'pickup' },
        },
      },
    });

    return active_rates > 0;
  }

  private async getCatalogSettings(storeId?: number | null): Promise<{
    show_out_of_stock?: boolean;
  }> {
    if (!storeId) return {};

    const settings = await this.prisma.store_settings.findFirst({
      where: { store_id: storeId },
      select: { settings: true },
    });

    return ((settings?.settings as any)?.ecommerce?.catalog ?? {}) as {
      show_out_of_stock?: boolean;
    };
  }

  private async areReviewsEnabled(): Promise<boolean> {
    const settings = await this.prisma.store_settings.findFirst({
      where: {},
      select: { settings: true },
    });
    const allow_reviews = (settings?.settings as any)?.ecommerce?.catalog
      ?.allow_reviews;

    return allow_reviews !== false;
  }

  private async getBestSellingFromCache(
    storeId: number,
  ): Promise<number[] | null> {
    return (
      (await this.cache.get<number[]>(`catalog:bestselling:${storeId}`)) ?? null
    );
  }

  private async setBestSellingCache(
    storeId: number,
    ids: number[],
  ): Promise<void> {
    await this.cache.set(`catalog:bestselling:${storeId}`, ids, 86_400_000);
  }

  private async fetchBestSellingIds(
    storeId: number,
    limit: number,
  ): Promise<number[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Agregación manual porque Prisma groupBy no siempre respeta el scope global en todas las configuraciones
    // y order_items necesita filtrarse por store_id a través de orders
    const bestSelling = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        created_at: {
          gte: thirtyDaysAgo,
        },
        orders: {
          store_id: storeId,
        },
      },
      _sum: {
        quantity: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: limit,
    });

    return bestSelling
      .filter((item) => item.product_id !== null)
      .map((item) => item.product_id as number);
  }

  private async mapProductToResponse(
    product: any,
    activePromotion: ActiveProductPromotion | null = null,
  ) {
    const raw_image_url = product.product_images?.[0]?.image_url || null;
    const signed_image_url = await this.s3Service.signUrl(raw_image_url);

    const variantCount = product._count?.product_variants || 0;
    const effectiveTracking = this.resolveEffectiveTracking(product);

    // Stock del producto base se calcula sólo cuando NO hay variantes.
    // Si hay variantes, la disponibilidad real depende de cada variante y se
    // resuelve en detalle; el card no agrega variantes en este endpoint.
    const baseAvailable = this.sumBaseProductStock(product);
    const totalLevelsAvailable = this.sumStockLevelsAvailable(
      product.stock_levels,
    );
    // Para listado: si tiene variantes, considerar disponible si cualquier
    // stock_level (incluyendo variantes) tiene unidades; si no, sólo base.
    const availableStock = variantCount > 0
      ? totalLevelsAvailable
      : baseAvailable;
    const isAvailable = !effectiveTracking || availableStock > 0;

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      base_price: product.base_price,
      sale_price: product.sale_price,
      is_on_sale: product.is_on_sale,
      is_featured: product.is_featured,
      final_price: this.calculateFinalPrice(product),
      active_promotion: activePromotion,
      sku: product.sku,
      // Mantener compatibilidad: stock_quantity ahora se calcula desde stock_levels.
      stock_quantity: availableStock,
      available_stock: effectiveTracking ? availableStock : null,
      is_available: isAvailable,
      effective_track_inventory: effectiveTracking,
      track_inventory: product.track_inventory,
      image_url: signed_image_url || null,
      brand: product.brands,
      categories:
        product.product_categories?.map((pc: any) => pc.categories) || [],
      variant_count: variantCount,
      product_type: product.product_type,
      requires_booking: product.requires_booking,
      service_duration_minutes: product.service_duration_minutes,
      service_modality: product.service_modality,
      booking_mode: product.booking_mode,
    };
  }

  private async mapProductDetailToResponse(
    product: any,
    reviews_enabled = true,
  ) {
    const reviews = reviews_enabled ? product.reviews || [] : [];
    let avg_rating = 0;
    let review_count = 0;

    if (reviews_enabled) {
      const [rating_aggregate, total_reviews] = await Promise.all([
        this.prisma.reviews.aggregate({
          where: { product_id: product.id, state: 'approved' },
          _avg: { rating: true },
        }),
        this.prisma.reviews.count({
          where: { product_id: product.id, state: 'approved' },
        }),
      ]);
      avg_rating = Number(rating_aggregate._avg.rating || 0);
      review_count = total_reviews;
    }

    // Firmar todas las imágenes del producto
    const signed_images = await Promise.all(
      (product.product_images || []).map(async (img: any) => ({
        ...img,
        image_url: await this.s3Service.signUrl(img.image_url),
      })),
    );

    const variants = await this.mapVariantsToResponse(product);
    const hasVariants = variants.length > 0;
    const effectiveTracking = this.resolveEffectiveTracking(product);

    // Disponibilidad del producto:
    // - Con variantes: el frontend muestra variant pickers; el flag a nivel
    //   producto refleja "al menos una variante disponible".
    // - Sin variantes: usar el stock base desde stock_levels.
    const productAvailableStock = hasVariants
      ? variants.reduce(
          (sum: number, v: any) =>
            sum + (typeof v.available_stock === 'number' ? v.available_stock : 0),
          0,
        )
      : this.sumBaseProductStock(product);
    const productIsAvailable = hasVariants
      ? variants.some((v: any) => v.is_available)
      : !effectiveTracking || productAvailableStock > 0;

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      base_price: product.base_price,
      sale_price: product.sale_price,
      is_on_sale: product.is_on_sale,
      is_featured: product.is_featured,
      final_price: this.calculateFinalPrice(product),
      sku: product.sku,
      // Mantener compatibilidad: ahora reflejan stock_levels.
      stock_quantity: productAvailableStock,
      available_stock: effectiveTracking ? productAvailableStock : null,
      is_available: productIsAvailable,
      effective_track_inventory: effectiveTracking,
      track_inventory: product.track_inventory,
      images: signed_images,
      image_url: signed_images[0]?.image_url || null,
      brand: product.brands,
      categories:
        product.product_categories?.map((pc: any) => pc.categories) || [],
      variants,
      reviews: reviews.map((r: any) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        user_name:
          `${r.users?.first_name || ''} ${r.users?.last_name || ''}`.trim(),
      })),
      avg_rating: Math.round(avg_rating * 10) / 10,
      review_count,
      product_type: product.product_type,
      requires_booking: product.requires_booking,
      service_duration_minutes: product.service_duration_minutes,
      service_modality: product.service_modality,
      booking_mode: product.booking_mode,
    };
  }

  /**
   * Maps product variants to enriched response with pricing and signed image URLs.
   */
  private async mapVariantsToResponse(product: any): Promise<any[]> {
    const variants = product.product_variants || [];
    if (variants.length === 0) return [];

    return Promise.all(
      variants.map(async (variant: any) => {
        const priceResult = this.resolvePrice(product, variant);
        const signedImageUrl = variant.product_images?.image_url
          ? await this.s3Service.signUrl(variant.product_images.image_url)
          : null;
        const effectiveTrackInventory = this.resolveEffectiveTracking(
          product,
          variant,
        );

        // Disponibilidad real desde stock_levels (source of truth), NUNCA desde
        // el denormalizado variant.stock_quantity que puede desfasarse.
        const availableStock = this.sumStockLevelsAvailable(
          variant.stock_levels,
        );
        const isAvailable = !effectiveTrackInventory || availableStock > 0;

        return {
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          attributes: variant.attributes,
          price_override: variant.price_override
            ? Number(variant.price_override)
            : null,
          effective_base_price: priceResult.unitBasePrice,
          final_price: Math.round(priceResult.unitPriceWithTax * 100) / 100,
          // Compatibilidad: stock_quantity refleja ahora la suma desde stock_levels.
          stock_quantity: availableStock,
          available_stock: effectiveTrackInventory ? availableStock : null,
          track_inventory_override: variant.track_inventory_override,
          effective_track_inventory: effectiveTrackInventory,
          is_available: isAvailable,
          image_url: signedImageUrl,
          is_on_sale: variant.is_on_sale,
          sale_price: variant.sale_price ? Number(variant.sale_price) : null,
          service_duration_minutes: variant.service_duration_minutes,
          service_pricing_type: variant.service_pricing_type,
          buffer_minutes: variant.buffer_minutes,
          preparation_time_minutes: variant.preparation_time_minutes,
        };
      }),
    );
  }

  /**
   * Calculates the final price of a product including taxes and active offers.
   * Supports variant price overrides.
   */
  private calculateFinalPrice(product: any, variant?: any): number {
    const totalTaxRate = this.getTotalTaxRate(product);
    const priceResult = this.resolvePrice(product, variant, totalTaxRate);
    const finalPrice = priceResult.unitPriceWithTax;
    return Math.round(finalPrice * 100) / 100;
  }

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

  private resolvePrice(product: any, variant?: any, taxRate?: number) {
    return this.priceResolverService.resolvePrice(
      {
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
      },
      taxRate ?? this.getTotalTaxRate(product),
    );
  }

  private resolveEffectiveTracking(product: any, variant?: any): boolean {
    return variant?.track_inventory_override ?? product.track_inventory;
  }

  /**
   * Suma `quantity_available` desde stock_levels (source of truth).
   * Catalog ecommerce no aplica `pos_stock_scope`; agrega todas las locations
   * del store. El scope tenant ya se aplica vía la relación con
   * inventory_locations.store_id en la query de productos.
   */
  private sumStockLevelsAvailable(stockLevels: any[] | undefined): number {
    if (!Array.isArray(stockLevels) || stockLevels.length === 0) return 0;
    return stockLevels.reduce(
      (sum, sl) => sum + Number(sl?.quantity_available ?? 0),
      0,
    );
  }

  /**
   * Suma stock base del producto (filas en stock_levels con product_variant_id = null).
   * Usado cuando el producto NO tiene variantes.
   */
  private sumBaseProductStock(product: any): number {
    const baseLevels = (product.stock_levels || []).filter(
      (sl: any) => sl.product_variant_id == null,
    );
    return this.sumStockLevelsAvailable(baseLevels);
  }

  /**
   * Batch-resolve the active auto-apply promotion for each product in a
   * listing. Cards display the promotional price computed off the same
   * tax-inclusive `final_price` they would otherwise show, so the badge
   * stays visually consistent. Errors are swallowed: the catalog must
   * never fail because of promotions, the card simply omits the badge.
   */
  private async resolveActivePromotionsForListing(
    products: any[],
  ): Promise<Map<number, ActiveProductPromotion>> {
    if (!Array.isArray(products) || products.length === 0) {
      return new Map();
    }

    const inputs: ActivePromotionProductInput[] = products
      .map((product) => {
        const productId = Number(product?.id);
        if (!Number.isFinite(productId)) return null;
        const unitPrice = this.calculateFinalPrice(product);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
        const categoryIds: number[] = (product.product_categories ?? [])
          .map((pc: any) => Number(pc?.categories?.id ?? pc?.category_id))
          .filter((id: number) => Number.isFinite(id));
        return {
          product_id: productId,
          category_ids: categoryIds,
          unit_price: unitPrice,
        } as ActivePromotionProductInput;
      })
      .filter((value): value is ActivePromotionProductInput => value !== null);

    if (inputs.length === 0) return new Map();

    try {
      return await this.promotionEngine.findActiveAutoPromotionsForProducts(
        inputs,
      );
    } catch {
      return new Map();
    }
  }

  /**
   * Return the product ids covered by at least one active auto-apply
   * promotion eligible by scope=product or scope=category. Used by the
   * `has_discount=true` filter so the catalog returns BOTH products with
   * sale_price and products with an active promotional badge.
   */
  private async fetchPromotedProductIdsForActiveAutoPromotions(): Promise<
    number[]
  > {
    const now = new Date();

    // `promotions` and `product_categories` are not scoped by
    // EcommercePrismaService, so we use storePrisma — which scopes by the
    // request store via its standard interceptors.
    const promotions = await this.storePrisma.promotions.findMany({
      where: {
        state: { in: ['active', 'scheduled'] },
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
        is_auto_apply: true,
        scope: { in: ['product', 'category'] },
      },
      select: {
        scope: true,
        promotion_products: { select: { product_id: true } },
        promotion_categories: { select: { category_id: true } },
      },
    });

    if (promotions.length === 0) return [];

    const directProductIds = new Set<number>();
    const categoryIds = new Set<number>();
    for (const promo of promotions) {
      if (promo.scope === 'product') {
        for (const pp of promo.promotion_products) {
          if (Number.isFinite(pp.product_id)) {
            directProductIds.add(Number(pp.product_id));
          }
        }
      } else if (promo.scope === 'category') {
        for (const pc of promo.promotion_categories) {
          if (Number.isFinite(pc.category_id)) {
            categoryIds.add(Number(pc.category_id));
          }
        }
      }
    }

    if (categoryIds.size > 0) {
      const categoryProductLinks =
        await this.storePrisma.product_categories.findMany({
          where: { category_id: { in: Array.from(categoryIds) } },
          select: { product_id: true },
        });
      for (const link of categoryProductLinks) {
        if (Number.isFinite(link.product_id)) {
          directProductIds.add(Number(link.product_id));
        }
      }
    }

    return Array.from(directProductIds);
  }
}

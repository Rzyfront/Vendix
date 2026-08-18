import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CatalogQueryDto, ProductSortBy } from './dto/catalog-query.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import {
  resolveDefaultSaleUnit,
  resolveDefaultSaleUnits,
  type DefaultSaleUnit,
} from '../../store/products/services/default-sale-unit.util';
import { listPublicSaleUnitsForProducts } from '../../store/products/services/public-sale-unit.util';
import { StorefrontPriceService } from '../shared/services/storefront-price.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import {
  MenuAvailabilityCheckerService,
  ProductAvailability,
} from '../../store/menus/menu-availability-checker.service';
import type {
  ActiveProductPromotion,
  ActivePromotionProductInput,
} from '../../store/promotions/dto/promotion-quote.interface';

/**
 * Una opción del selector de presentación de la vitrina
 * (`available_sale_units[]`).
 *
 * `price_tier_id: null` es la UNIDAD SUELTA: la línea sin tarifa, el
 * equivalente exacto del "Default (sin tarifa)" que el POS ofrece de primero.
 */
type PublicSaleUnitProjection = {
  price_tier_id: number | null;
  name: string;
  units_per_package: number | null;
  is_default: boolean;
  price: number;
  compare_at_price: number | null;
  available_packages: number | null;
  is_available: boolean;
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly storePrisma: StorePrismaService,
    private readonly s3Service: S3Service,
    private readonly priceResolverService: PriceResolverService,
    private readonly storefrontPrice: StorefrontPriceService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly menuAvailabilityChecker: MenuAvailabilityCheckerService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Catálogo global de unidades, cacheado por proceso. Es de solo lectura y
   * cambia únicamente cuando el equipo agrega una unidad nueva, así que pagar
   * una consulta por producto para leerlo sería gratuito solo en la demo.
   */
  private uomByIdCache: Map<
    number,
    { code: string; name: string; dimension: string; factor_to_base: number }
  > | null = null;

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
      is_sellable: true,
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

    // Cascada de relleno para la sección de destacados del home:
    // destacados -> más vendidos -> cualquiera, hasta completar `limit`.
    // Sólo aplica a la carga inicial (page 1) sin búsqueda ni ids explícitos,
    // para no interferir con listados filtrados o paginados.
    if (
      String(query.fill) === 'true' &&
      String(query.is_featured) === 'true' &&
      page === 1 &&
      !search &&
      !ids
    ) {
      return this.getFeaturedWithFill(where, store_id, Number(limit));
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
        await this.hydrateSaleUnitsForListing(finalData);
        const activePromotionsByProductId =
          await this.resolveActivePromotionsForListing(finalData);
        const availabilityByProductId =
          await this.resolveAvailabilityForProducts(store_id, finalData);
        const mappedData = await Promise.all(
          finalData.map((p) =>
            this.mapProductToResponse(
              p,
              activePromotionsByProductId.get(p.id) ?? null,
              availabilityByProductId.get(p.id) ?? null,
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

    await this.hydrateSaleUnitsForListing(data);
    const activePromotionsByProductId =
      await this.resolveActivePromotionsForListing(data);
    const availabilityByProductId =
      await this.resolveAvailabilityForProducts(store_id, data);
    const mappedData = await Promise.all(
      data.map((product) =>
        this.mapProductToResponse(
          product,
          activePromotionsByProductId.get(product.id) ?? null,
          availabilityByProductId.get(product.id) ?? null,
        ),
      ),
    );

    // Las cartas (menús) NO filtran el catálogo general: cartas y productos
    // conviven sin interferir. Un producto enlazado a una carta con ventana
    // horaria sigue visible en el catálogo aunque esté fuera de ese horario;
    // la disponibilidad por horario se expone aparte en GET /ecommerce/menus.
    return {
      data: mappedData,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.max(1, Math.ceil(total / Number(limit))),
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
        is_sellable: true,
        // store_id se aplica automáticamente por EcommercePrismaService
      },
      include,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Resolve the active auto-apply promotion for this single product reusing
    // the SAME batch helper the listing uses, so the detail badge/price match
    // the card byte-for-byte (identical unit_price + category_ids inputs).
    // Never break the detail because of promotions: the helper already
    // swallows errors and degrades to an empty map.
    await this.hydrateSaleUnitsForListing([product]);
    const activePromotionsByProductId =
      await this.resolveActivePromotionsForListing([product]);
    const activePromotion =
      activePromotionsByProductId.get(product.id) ?? null;

    // Menu availability for the detail view via the SAME shared checker as the
    // card, so the "Disponible a las HH:mm" badge matches the catalog listing.
    const store_id = RequestContextService.getStoreId();
    const availabilityByProductId = await this.resolveAvailabilityForProducts(
      store_id,
      [product],
    );
    const availability = availabilityByProductId.get(product.id) ?? null;

    return await this.mapProductDetailToResponse(
      product,
      reviews_enabled,
      activePromotion,
      availability,
    );
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

    const industries = (store?.industries ?? []) as string[];
    const is_restaurant = industries.includes('restaurant');

    // La sección "Cartas" (home_sections.menus) solo aplica a restaurantes.
    // Defensa en profundidad: aunque el admin no muestra el toggle para otras
    // industrias, aquí se elimina por si quedó persistido.
    const home_sections = { ...(settings.ecommerce?.home_sections || {}) };
    if (!is_restaurant && 'menus' in home_sections) {
      delete (home_sections as any).menus;
    }

    return {
      ...settings,
      industries,
      ecommerce: {
        ...(settings.ecommerce || {}),
        home_sections,
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
    enable_sale_unit_selector?: boolean;
  }> {
    if (!storeId) return {};

    const settings = await this.prisma.store_settings.findFirst({
      where: { store_id: storeId },
      select: { settings: true },
    });

    return ((settings?.settings as any)?.ecommerce?.catalog ?? {}) as {
      show_out_of_stock?: boolean;
      enable_sale_unit_selector?: boolean;
    };
  }

  /**
   * ¿La tienda publica el selector de presentaciones? (QUI-648, fase 2b)
   *
   * DEFAULT `false`, y por eso la comparación es `=== true` y NO el
   * `!== false` que usan `allow_reviews` o `show_variants`: esos nacieron
   * encendidos, éste nace apagado. Con `!== false`, una tienda que jamás oyó
   * hablar del selector —settings sin la clave— lo estrenaría encendido, y
   * publicar presentaciones que el comercio no revisó es exactamente lo que el
   * flag existe para impedir.
   *
   * El flag gatea la LECTURA (esta proyección) y la ESCRITURA (la autorización
   * del carrito, en `public-sale-unit.util.ts`). Si solo gateara el display, un
   * `curl` con `price_tier_id` compraría en una presentación no publicada.
   */
  private async isSaleUnitSelectorEnabled(
    storeId?: number | null,
  ): Promise<boolean> {
    const id = storeId ?? RequestContextService.getStoreId();
    if (!id) return false;
    try {
      const settings = await this.getCatalogSettings(id);
      return settings.enable_sale_unit_selector === true;
    } catch {
      // Sin settings legibles no se publica el selector: fallar cerrado deja la
      // vitrina exactamente como antes de la feature.
      return false;
    }
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

  /**
   * Include compartido para las cards del listado. Se define aquí para que la
   * cascada de destacados (`getFeaturedWithFill`) no diverja del shape que
   * consume `mapProductToResponse`. No se refactorizan los usos existentes.
   */
  private listingInclude(): any {
    return {
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
    };
  }

  /**
   * Cascada de relleno para "Productos destacados" del home.
   * Completa hasta `limit` en 3 escalones sin duplicados, respetando el mismo
   * where base (state/available/sellable + show_out_of_stock) que los destacados.
   *   1) destacados (is_featured=true, newest)
   *   2) más vendidos últimos 30d (ranking cacheado)
   *   3) cualquiera (newest)
   */
  private async getFeaturedWithFill(
    whereFeatured: any,
    storeId: number | undefined,
    limit: number,
  ) {
    const include = this.listingInclude();

    // Escalón 1: destacados
    const featured = await this.prisma.products.findMany({
      where: whereFeatured,
      take: limit,
      orderBy: { created_at: 'desc' },
      include,
    });
    const collected: any[] = [...featured];
    const seen = new Set<number>(collected.map((p) => p.id));

    // where SIN is_featured para escalones 2 y 3
    const whereBase: any = { ...whereFeatured };
    delete whereBase.is_featured;

    // Escalón 2: más vendidos (ranking 30d, cacheado)
    if (collected.length < limit && storeId) {
      let rankedIds = await this.getBestSellingFromCache(storeId);
      if (!rankedIds) {
        rankedIds = await this.fetchBestSellingIds(storeId, limit);
        await this.setBestSellingCache(storeId, rankedIds);
      }
      const candidateIds = rankedIds.filter((id) => !seen.has(id));
      if (candidateIds.length > 0) {
        const bestSellers = await this.prisma.products.findMany({
          where: { ...whereBase, id: { in: candidateIds } },
          include,
        });
        bestSellers.sort(
          (a, b) => candidateIds.indexOf(a.id) - candidateIds.indexOf(b.id),
        );
        for (const product of bestSellers) {
          if (collected.length >= limit) break;
          if (!seen.has(product.id)) {
            collected.push(product);
            seen.add(product.id);
          }
        }
      }
    }

    // Escalón 3: cualquiera (newest)
    if (collected.length < limit) {
      const needed = limit - collected.length;
      const filler = await this.prisma.products.findMany({
        where: { ...whereBase, id: { notIn: Array.from(seen) } },
        take: needed,
        orderBy: { created_at: 'desc' },
        include,
      });
      for (const product of filler) {
        if (collected.length >= limit) break;
        if (!seen.has(product.id)) {
          collected.push(product);
          seen.add(product.id);
        }
      }
    }

    // Mapeo con el pipeline compartido (idéntico a getProducts)
    await this.hydrateSaleUnitsForListing(collected);
    const activePromotionsByProductId =
      await this.resolveActivePromotionsForListing(collected);
    const availabilityByProductId = await this.resolveAvailabilityForProducts(
      storeId,
      collected,
    );
    const data = await Promise.all(
      collected.map((product) =>
        this.mapProductToResponse(
          product,
          activePromotionsByProductId.get(product.id) ?? null,
          availabilityByProductId.get(product.id) ?? null,
        ),
      ),
    );

    return {
      data,
      meta: {
        total: data.length,
        page: 1,
        limit,
        total_pages: 1,
      },
    };
  }

  /**
   * Resolve per-product menu availability for a page/detail through the shared
   * single source of truth
   * (`MenuAvailabilityCheckerService.getAvailabilityMap`). The checker resolves
   * store timezone and "now" internally; retail products (not gated by any
   * carta window) default to available. Returns an empty map when there is no
   * store context or no products, so callers fall back to the
   * `{ is_available_now: true, next_available: null }` default.
   */
  private async resolveAvailabilityForProducts(
    storeId: number | undefined,
    products: any[],
  ): Promise<Map<number, ProductAvailability>> {
    if (!storeId || !Array.isArray(products) || products.length === 0) {
      return new Map();
    }
    const ids = products
      .map((p) => Number(p?.id))
      .filter((id) => Number.isFinite(id));
    if (ids.length === 0) return new Map();
    return this.menuAvailabilityChecker.getAvailabilityMap(storeId, ids);
  }

  private async mapProductToResponse(
    product: any,
    activePromotion: ActiveProductPromotion | null = null,
    availability: ProductAvailability | null = null,
  ) {
    const raw_image_url = product.product_images?.[0]?.image_url || null;
    const signed_image_url = await this.s3Service.signUrl(raw_image_url);
    await this.hydrateDefaultSaleUnit(product);

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
    const availableStockUnits =
      variantCount > 0 ? totalLevelsAvailable : baseAvailable;

    // QUI-648 — cuando el producto se publica en una presentación, la vitrina
    // cuenta PAQUETES, no unidades: con 30 kg en bodega y un Bulto×50 no hay
    // ni un bulto que vender, así que la card debe decir "agotado".
    //
    // Es un cambio de comportamiento DELIBERADO: hoy esa card se muestra
    // comprable, el cliente la agrega y el checkout la rechaza en
    // `assertPackagedStockAvailability`. Mover el "no hay" a la vitrina es
    // mostrarle al cliente la misma verdad que ya aplica el cobro. Sin
    // presentación, packSize = 1 y la aritmética queda idéntica a la histórica.
    const packSize = this.resolveProductPackSize(product);
    const availablePackages =
      packSize > 1
        ? Math.floor(availableStockUnits / packSize)
        : availableStockUnits;
    const isAvailable = !effectiveTracking || availablePackages > 0;

    // Fase 2b — el ABANICO de presentaciones. `[]` con el flag apagado o sin
    // presentaciones publicadas, y en ese caso la card queda idéntica a la
    // histórica: `sale_unit_count: 0` y `price_from: null` son aditivos.
    const saleUnitOptions = this.buildAvailableSaleUnits(
      product,
      availableStockUnits,
      effectiveTracking,
    );

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
      // Presentación en la que se publica y se vende. `null` = unidad principal.
      // NO cambia con el selector: sigue siendo la marcada por defecto, que es
      // la garantía de cero regresión para el cliente que no se actualice.
      sale_unit: product.__default_sale_unit
        ? {
            price_tier_id: product.__default_sale_unit.tier.id,
            name: product.__default_sale_unit.tier.name,
            units_per_package:
              product.__default_sale_unit.tier.units_per_package,
          }
        : null,
      // Cuántas presentaciones ofrece el producto. `> 1` es la señal de que el
      // comprador tiene algo que ELEGIR y la card no puede agregar a ciegas —
      // mismo criterio que `variant_count`.
      sale_unit_count: saleUnitOptions.length,
      // Mínimo de `available_sale_units[].price`, para el "desde $2.380".
      // `final_price` sigue siendo el de la presentación por defecto.
      price_from:
        saleUnitOptions.length > 0
          ? Math.min(...saleUnitOptions.map((o) => o.price))
          : null,
      // Precio de la UNIDAD SUELTA, o `null` cuando el producto no la ofrece.
      // El listado no publica `available_sale_units` (pesa), pero el carrito
      // invitado SÍ necesita poder cotizar una línea SIN tarifa, y para eso
      // `final_price` no sirve: con el selector encendido `final_price` es el
      // de la presentación marcada por defecto, no el de la unidad. Sin este
      // campo la línea suelta se pintaba con el precio de la presentación.
      loose_unit_price: this.looseUnitPriceOf(saleUnitOptions),
      // Escala del precio publicado: "$5.000 por metro" y no "$5.000" a secas
      // sobre un producto que se mide en milímetros.
      price_unit: this.buildPriceUnit(product),
      active_promotion: activePromotion,
      sku: product.sku,
      // Mantener compatibilidad: stock_quantity ahora se calcula desde
      // stock_levels y sigue expresado en UNIDADES DE STOCK (sin cambio).
      stock_quantity: availableStockUnits,
      // Expresado en PAQUETES: es lo que el cliente puede llegar a comprar.
      available_stock: effectiveTracking ? availablePackages : null,
      // Crudo, en unidades de stock. Necesario para que el frontend pueda
      // explicar "quedan 30 unidades, el bulto es de 50" sin volver a
      // preguntar.
      available_stock_units: availableStockUnits,
      is_available: isAvailable,
      // Menu availability (carta horario) — independiente del stock. Productos
      // retail (sin ventana de carta) quedan siempre disponibles.
      is_available_now: availability?.is_available_now ?? true,
      next_available: availability?.next_available ?? null,
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
    activePromotion: ActiveProductPromotion | null = null,
    availability: ProductAvailability | null = null,
  ) {
    await this.hydrateDefaultSaleUnit(product);
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
    const productAvailableStockUnits = hasVariants
      ? variants.reduce(
          (sum: number, v: any) =>
            sum + (typeof v.available_stock === 'number' ? v.available_stock : 0),
          0,
        )
      : this.sumBaseProductStock(product);

    // Mismo desdoblamiento que la card (ver `mapProductToResponse`). El camino
    // con variantes nunca coexiste con presentación —un producto publicado en
    // presentación no expone variantes (`mapVariantsToResponse` devuelve [])—,
    // así que ahí packSize siempre vale 1.
    const packSize = this.resolveProductPackSize(product);
    const productAvailablePackages =
      packSize > 1
        ? Math.floor(productAvailableStockUnits / packSize)
        : productAvailableStockUnits;
    const productIsAvailable = hasVariants
      ? variants.some((v: any) => v.is_available)
      : !effectiveTracking || productAvailablePackages > 0;

    // Fase 2b — el abanico completo, que es lo que pinta el selector del
    // detalle. Se mide contra el MISMO stock que `available_stock`, así que un
    // chip "Agotado" y el badge del producto no pueden contradecirse.
    const saleUnitOptions = this.buildAvailableSaleUnits(
      product,
      productAvailableStockUnits,
      effectiveTracking,
    );

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
      // Presentación en la que se publica y se vende. `null` = unidad principal.
      // NO cambia con el selector: sigue siendo la marcada por defecto, que es
      // la garantía de cero regresión para el cliente que no se actualice.
      sale_unit: product.__default_sale_unit
        ? {
            price_tier_id: product.__default_sale_unit.tier.id,
            name: product.__default_sale_unit.tier.name,
            units_per_package:
              product.__default_sale_unit.tier.units_per_package,
          }
        : null,
      // Presentaciones entre las que el comprador puede elegir. SIEMPRE
      // presente: `[]` con el flag apagado o sin presentaciones publicadas.
      // Invariante: `find(u => u.is_default).price === final_price`.
      available_sale_units: saleUnitOptions,
      // Los mismos dos campos del listado, para que `ProductDetail` no tenga un
      // contrato más pobre que la card de la que viene el usuario.
      sale_unit_count: saleUnitOptions.length,
      price_from:
        saleUnitOptions.length > 0
          ? Math.min(...saleUnitOptions.map((o) => o.price))
          : null,
      // Mismo campo que el listado, para que el detalle no tenga un contrato
      // más pobre. Aquí es derivable de `available_sale_units`, pero se publica
      // igual: el carrito lee productos de las dos fuentes.
      loose_unit_price: this.looseUnitPriceOf(saleUnitOptions),
      // Escala del precio publicado: "$5.000 por metro" y no "$5.000" a secas
      // sobre un producto que se mide en milímetros.
      price_unit: this.buildPriceUnit(product),
      active_promotion: activePromotion,
      sku: product.sku,
      // Mantener compatibilidad: sigue en UNIDADES DE STOCK (sin cambio).
      stock_quantity: productAvailableStockUnits,
      // Expresado en PAQUETES: es lo que el cliente puede llegar a comprar.
      available_stock: effectiveTracking ? productAvailablePackages : null,
      available_stock_units: productAvailableStockUnits,
      is_available: productIsAvailable,
      // Menu availability (carta horario) — independiente del stock. Productos
      // retail (sin ventana de carta) quedan siempre disponibles.
      is_available_now: availability?.is_available_now ?? true,
      next_available: availability?.next_available ?? null,
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

    // Multi-tarifa ⊕ variantes: si el producto se publica en una presentación
    // por defecto, la vitrina NO expone variantes. No es cosmético — las dos
    // proyecciones resuelven el precio por caminos distintos (el producto con
    // `calculateFinalPrice`, tier-aware; la variante con `resolvePrice`, cascada
    // legacy), y el detalle público muestra el mínimo de variante. Un producto
    // legacy con ambos ejes publicaba el precio de la unidad mínima ($1.000) en
    // vez del de la presentación ($2.000). La regla es excluyente en escritura;
    // acá se cierra la lectura para los datos que ya nacieron mezclados.
    if (product.__default_sale_unit) return [];

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
   * Precio publicado CON IMPUESTO.
   *
   * QUI-648 — cuando el producto tiene presentación por defecto, el precio
   * publicado es el del PAQUETE. Tiene que coincidir con lo que cobra el
   * checkout: si la vitrina mostrara el precio unitario, el total cambiaría al
   * pagar.
   *
   * La aritmética vive en `StorefrontPriceService` para que la vitrina, el
   * carrito y el cobro no puedan volver a dar tres cifras distintas del mismo
   * producto. El default se hidrata antes (`__default_sale_unit`), en lote para
   * los listados y por producto en el detalle.
   */
  private calculateFinalPrice(product: any, variant?: any): number {
    return this.storefrontPrice.resolveLine({
      product,
      variant: variant ?? null,
      saleUnit: product?.__default_sale_unit ?? null,
      taxRate: this.storefrontPrice.getTotalTaxRate(product),
    }).gross_unit_price;
  }

  /**
   * Unidades de stock que ocupa UN paquete de la presentación publicada.
   * `1` cuando el producto se vende en su unidad principal.
   */
  private resolveProductPackSize(product: any): number {
    return this.storefrontPrice.resolvePackSizeForSaleUnit(
      product?.__default_sale_unit ?? null,
    );
  }

  /**
   * Hidrata `__default_sale_unit` de TODO un listado en una sola pasada.
   *
   * Tiene que correr ANTES de `resolveActivePromotionsForListing`: ese helper
   * cotiza la promoción sobre `calculateFinalPrice`, y sin la presentación
   * hidratada la cotiza sobre el precio de la UNIDAD mientras la card publica
   * el del PAQUETE — el badge de descuento no cuadraba con el precio tachado
   * que estaba al lado.
   *
   * Los productos sin presentación quedan marcados explícitamente en `null`
   * (no `undefined`) para que el guard de `hydrateDefaultSaleUnit` convierta en
   * no-op la llamada por producto de los mapeadores: ese era el N+1.
   */
  private async hydrateSaleUnitsForListing(products: any[]): Promise<void> {
    if (!Array.isArray(products) || products.length === 0) return;

    const pending = products.filter(
      (p) => p && p.id != null && p.__default_sale_unit === undefined,
    );

    if (pending.length > 0) {
      let saleUnits = new Map<number, DefaultSaleUnit>();
      try {
        saleUnits = await resolveDefaultSaleUnits(
          this.prisma as any,
          pending.map((p) => Number(p.id)),
        );
      } catch {
        // Una falla leyendo las presentaciones no debe tumbar la vitrina: sin
        // default, cada producto se publica en su unidad principal (cascada
        // legacy). Se marca `null` igual para no disparar el N+1 de reintentos
        // producto por producto en los mapeadores.
        saleUnits = new Map();
      }

      for (const product of pending) {
        product.__default_sale_unit = saleUnits.get(Number(product.id)) ?? null;
      }
    }

    // Fase 2b: el ABANICO de presentaciones viaja por el MISMO punto de
    // hidratación por lote que el default. Engancharlo acá —y no dentro de los
    // mapeadores— es lo que impide el N+1: `getProducts`, `getFeaturedWithFill`
    // y `getProductBySlug` ya pasan todos por aquí.
    await this.hydratePublicSaleUnits(products);
  }

  /**
   * Hidrata `__public_sale_units` (todas las presentaciones publicables) y
   * `__public_default_tier_id` para un lote de productos.
   *
   * Se marca SIEMPRE, aunque el flag esté apagado o la lectura falle: el valor
   * por defecto es `[]`, de modo que la proyección degrada a la respuesta
   * histórica exacta en vez de quedar `undefined` y tentar a un mapeador a
   * releer producto por producto.
   *
   * Nunca lanza: la vitrina no puede caerse porque el catálogo de tarifas esté
   * ilegible.
   */
  private async hydratePublicSaleUnits(products: any[]): Promise<void> {
    const pending = products.filter(
      (p) => p && p.id != null && p.__public_sale_units === undefined,
    );
    if (pending.length === 0) return;

    for (const product of pending) {
      product.__public_sale_units = [];
      product.__public_default_tier_id = null;
    }

    const storeId = RequestContextService.getStoreId();
    if (!storeId) return;
    if (!(await this.isSaleUnitSelectorEnabled(storeId))) return;

    try {
      const { byProduct, defaultTierByProduct } =
        await listPublicSaleUnitsForProducts(
          this.prisma as any,
          pending.map((p) => Number(p.id)),
          storeId,
        );
      for (const product of pending) {
        const id = Number(product.id);
        product.__public_sale_units = byProduct.get(id) ?? [];
        product.__public_default_tier_id =
          defaultTierByProduct.get(id) ?? null;
        this.applyLooseUnitPolicy(product);
      }
    } catch {
      // Ya quedaron marcados en `[]` arriba: sin presentaciones publicadas la
      // respuesta es byte a byte la de antes de la feature.
    }
  }

  /**
   * Cierra el hueco que deja `offer_loose_unit = false`.
   *
   * Con la unidad suelta apagada, la vitrina no ofrece la línea sin
   * `price_tier_id` — pero `final_price`, `sale_unit` y `price_unit` siguen
   * leyendo `__default_sale_unit`, que solo se llena si alguna asignación está
   * marcada `is_default`. Sin esta política, un producto con la unidad suelta
   * apagada y ninguna presentación marcada publicaba el precio de la unidad que
   * acaba de retirar de la venta: el número más caro para el comercio y el más
   * confuso para el comprador.
   *
   * Se elige la marcada por defecto y, si no hay ninguna, la primera publicable
   * (el orden ya es el `sort_order` que definió el comercio). Así se conserva la
   * invariante que documenta `buildAvailableSaleUnits`:
   * `available_sale_units.find(u => u.is_default).price === final_price`.
   */
  private applyLooseUnitPolicy(product: any): void {
    if (product?.offer_loose_unit !== false) return;
    const options: DefaultSaleUnit[] = Array.isArray(product.__public_sale_units)
      ? product.__public_sale_units
      : [];
    if (options.length === 0) return;

    const markedId = product.__public_default_tier_id;
    const chosen =
      (markedId != null
        ? options.find((option) => option.tier.id === markedId)
        : null) ?? options[0];
    if (!chosen) return;

    product.__public_default_tier_id = chosen.tier.id;
    product.__default_sale_unit = chosen;
  }

  /**
   * Proyecta las presentaciones publicables de un producto (`available_sale_units`).
   *
   * REGLAS DE DINERO Y STOCK (las tres se rompen juntas si se toca una):
   *
   * 1. `price` es el precio del PAQUETE ENTERO y viene CON IMPUESTO, la MISMA
   *    escala que `final_price`. Sale de `StorefrontPriceService.resolveLine`
   *    con `quantity: 1`. Jamás se multiplica dinero por `units_per_package`:
   *    el precio del bulto YA es el precio del bulto, y multiplicarlo inflaría
   *    el cobro por el tamaño del empaque.
   * 2. `compare_at_price` sale del resolver en escala NETA (así lo documenta
   *    `StorefrontLinePrice`), así que acá se le aplica la tasa para que el
   *    precio tachado y el vigente no queden en dos escalas distintas dentro
   *    del mismo chip.
   * 3. `available_packages = floor(unidades / packSize)`, con el packSize que
   *    el propio resolver eligió (`line.pack_size`, cascada
   *    `override_units_per_package ?? tier.units_per_package ?? 1`). Se toma de
   *    ahí y no de una segunda lectura para que el dinero y el stock no puedan
   *    elegir filas de override distintas.
   *
   * `is_default` marca la presentación preseleccionada: la MISMA que alimenta
   * `sale_unit` y `final_price`, de modo que
   * `available_sale_units.find(u => u.is_default).price === final_price`.
   */
  private buildAvailableSaleUnits(
    product: any,
    availableStockUnits: number,
    effectiveTracking: boolean,
  ): PublicSaleUnitProjection[] {
    const options: DefaultSaleUnit[] = Array.isArray(
      product?.__public_sale_units,
    )
      ? product.__public_sale_units
      : [];
    if (options.length === 0) return [];

    // El default sale del assignment (`is_default` por producto). Se cae al
    // tier ya hidratado para el caso en que el lote no lo trajera.
    const defaultTierId: number | null =
      product?.__public_default_tier_id ??
      product?.__default_sale_unit?.tier?.id ??
      null;
    const taxRate = this.storefrontPrice.getTotalTaxRate(product);

    // La UNIDAD SUELTA va primero, igual que el POS abre su menú con "Default
    // (sin tarifa)".
    //
    // Es la línea sin `price_tier_id`: el mismo camino que el carrito ya
    // resuelve por la cascada de siempre, así que publicarla no abre ninguna
    // puerta de escritura nueva. Sin ella, un producto con UNA sola
    // presentación se quedaba sin selector (el frontend exige más de una
    // opción) y su "desde" salía al precio del paquete — el comprador leía
    // "$632.580" sobre una botella de $56.190.
    //
    // `is_default` recae en ella solo cuando ninguna presentación está marcada:
    // esa es exactamente la condición en la que `final_price` es el precio de
    // la unidad, que es lo que mantiene la invariante del docblock.
    const looseUnit: PublicSaleUnitProjection[] =
      product?.offer_loose_unit === false
        ? []
        : [this.buildLooseUnitOption(
            product,
            availableStockUnits,
            effectiveTracking,
            taxRate,
            defaultTierId === null,
          )];

    // El orden es el que devuelve `listPublicSaleUnitsForProducts`
    // (`price_tier.sort_order`): el comercio decide en qué orden se ofrecen.
    return looseUnit.concat(options.map((saleUnit) => {
      const line = this.storefrontPrice.resolveLine({
        product,
        variant: null,
        saleUnit,
        quantity: 1,
        taxRate,
      });
      const packSize = line.pack_size;
      const availablePackages = effectiveTracking
        ? packSize > 1
          ? Math.floor(availableStockUnits / packSize)
          : availableStockUnits
        : null;

      return {
        price_tier_id: saleUnit.tier.id,
        name: saleUnit.tier.name,
        // packSize EFECTIVO. `null` —y no `1`— cuando la presentación no
        // empaqueta nada, igual que `sale_unit.units_per_package`: el frontend
        // usa la ausencia para no pintar "(1 und)".
        units_per_package: packSize > 1 ? packSize : null,
        is_default:
          defaultTierId != null && saleUnit.tier.id === defaultTierId,
        price: line.gross_unit_price,
        compare_at_price:
          line.compare_at_price != null
            ? Math.round(line.compare_at_price * (1 + taxRate) * 100) / 100
            : null,
        available_packages: availablePackages,
        is_available: !effectiveTracking || (availablePackages ?? 0) > 0,
      };
    }));
  }

  /**
   * La unidad suelta como una opción más del selector.
   *
   * `price_tier_id: null` no es un hueco: es el contrato de "esta línea no
   * lleva presentación", el mismo que el carrito y el checkout ya interpretan
   * como la cascada histórica. El frontend lo usa como clave de selección igual
   * que cualquier otro chip.
   *
   * El precio sale del MISMO resolver que las presentaciones
   * (`resolveLine` con `saleUnit: null`), no de `final_price`: cuando la unidad
   * suelta deja de ser la default, `final_price` es el de la presentación y
   * copiarlo acá pondría el precio del bulto en el chip de la botella.
   */
  /**
   * Precio de la unidad suelta dentro de un abanico ya construido, o `null`
   * cuando el producto no la ofrece (`offer_loose_unit = false`) o cuando el
   * abanico está vacío (selector apagado / sin presentaciones).
   *
   * `null` significa "cotiza como siempre": el consumidor cae a `final_price`,
   * que es exactamente el comportamiento histórico.
   */
  private looseUnitPriceOf(
    options: PublicSaleUnitProjection[],
  ): number | null {
    const loose = options.find((option) => option.price_tier_id === null);
    return loose ? loose.price : null;
  }

  private buildLooseUnitOption(
    product: any,
    availableStockUnits: number,
    effectiveTracking: boolean,
    taxRate: number,
    isDefault: boolean,
  ): PublicSaleUnitProjection {
    const line = this.storefrontPrice.resolveLine({
      product,
      variant: null,
      saleUnit: null,
      quantity: 1,
      taxRate,
    });

    return {
      price_tier_id: null,
      // El nombre de la unidad de stock ("Botella", "Kilogramo") cuando el
      // producto la declara; "Unidad" cuando no, que es lo que el comerciante
      // escribiría igual.
      name: product?.__stock_unit?.name || 'Unidad',
      units_per_package: null,
      is_default: isDefault,
      price: line.gross_unit_price,
      compare_at_price:
        line.compare_at_price != null
          ? Math.round(line.compare_at_price * (1 + taxRate) * 100) / 100
          : null,
      available_packages: effectiveTracking ? availableStockUnits : null,
      is_available: !effectiveTracking || availableStockUnits > 0,
    };
  }

  /**
   * Hidrata `product.__default_sale_unit` para que la proyección sincrónica
   * (`calculateFinalPrice`) pueda usar la presentación por defecto sin volverse
   * asíncrona. Devuelve el mismo objeto recibido.
   */
  private async hydrateDefaultSaleUnit(product: any): Promise<any> {
    if (!product?.id) return product;
    // La unidad de stock se hidrata SIEMPRE, aunque la presentación ya venga
    // resuelta del lote: `buildPriceUnit` la lee para publicar "$5.000 por
    // metro". Si viviera detrás del guard de abajo, el listado hidratado en
    // lote perdería la unidad y la etiqueta degradaba a "por 1.000 unidades".
    await this.hydrateStockUnit(product);
    if (product.__default_sale_unit !== undefined) return product;
    try {
      product.__default_sale_unit = await resolveDefaultSaleUnit(
        this.prisma as any,
        Number(product.id),
      );
    } catch {
      // Una falla leyendo la presentación no debe tumbar la vitrina: sin default
      // el producto se publica en su unidad principal (cascada legacy).
      product.__default_sale_unit = null;
    }
    return product;
  }

  /**
   * Código de la unidad de stock del producto, para publicar el precio en la
   * escala del comerciante ("$5.000 por metro") en vez de un número sin unidad.
   *
   * El catálogo de unidades es global, diminuto e inmutable en runtime, así que
   * se lee una vez por proceso: la vitrina no puede pagar una consulta por
   * producto para mostrar dos palabras.
   */
  private async hydrateStockUnit(product: any): Promise<void> {
    // Idempotente: ahora se llama desde dos caminos (lote y por producto).
    if (product?.__stock_unit !== undefined) return;
    if (!product?.stock_uom_id) {
      product.__stock_unit = null;
      return;
    }
    try {
      if (!this.uomByIdCache) {
        const rows = await this.storePrisma.units_of_measure.findMany({
          where: { is_active: true },
          select: {
            id: true,
            code: true,
            name: true,
            dimension: true,
            factor_to_base: true,
          },
        });
        this.uomByIdCache = new Map(
          rows.map((u) => [
            u.id,
            {
              code: u.code,
              name: u.name,
              dimension: u.dimension as string,
              factor_to_base: Number(u.factor_to_base),
            },
          ]),
        );
      }
      product.__stock_unit =
        this.uomByIdCache.get(Number(product.stock_uom_id)) ?? null;
    } catch {
      product.__stock_unit = null;
    }
  }

  /**
   * Escala en la que se publica el precio: "por metro" cuando el producto vive
   * en milímetros y su precio cubre 1.000. `null` cuando el precio es por
   * unidad, que es todo el catálogo histórico.
   *
   * No aplica cuando hay presentación por defecto: ahí el precio publicado ya
   * es el del paquete completo y hablar de escala confundiría dos cosas.
   */
  private buildPriceUnit(product: any): {
    quantity: number;
    stock_unit_code: string | null;
    reference_unit_code: string | null;
    label: string;
  } | null {
    if (product?.__default_sale_unit) return null;
    const quantity = Number(product?.price_unit_quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 1) return null;

    const stock = product.__stock_unit ?? null;
    if (!stock) {
      return {
        quantity,
        stock_unit_code: null,
        reference_unit_code: null,
        label: `por ${quantity.toLocaleString('es-CO')} unidades`,
      };
    }

    const reference = this.uomByIdCache
      ? Array.from(this.uomByIdCache.values()).find(
          (u) =>
            u.dimension === stock.dimension &&
            Math.abs(u.factor_to_base / stock.factor_to_base - quantity) < 1e-9,
        )
      : undefined;

    return {
      quantity,
      stock_unit_code: stock.code,
      reference_unit_code: reference?.code ?? null,
      label: reference
        ? `por ${reference.code}`
        : `por ${quantity.toLocaleString('es-CO')} ${stock.code}`,
    };
  }

  /**
   * Delega en `StorefrontPriceService`: catálogo y carrito mantenían dos copias
   * idénticas de este recorrido, y dos copias de una base gravable terminan
   * publicando dos precios del mismo producto.
   */
  private getTotalTaxRate(product: any): number {
    return this.storefrontPrice.getTotalTaxRate(product);
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

  // --------------------------------------------------- Fase G menu windows

  /**
   * Public carta endpoint. Returns the store's active menus with their
   * sections, items and the product snapshot needed to render a storefront
   * carta. Each menu/section/item carries `is_available_now` (computed from
   * its availability windows in the store timezone) and, when not available,
   * `next_available` (the soonest upcoming window). Cartas and the general
   * catalog are independent: this never hides products from /ecommerce/catalog.
   *
   * Gated by industry: a store whose `industries` does not include
   * `restaurant` returns an empty list.
   */
  async getPublicMenus(): Promise<{
    store_timezone: string;
    now: { day_of_week: number; minutes: number };
    menus: any[];
  }> {
    const store_id = RequestContextService.getStoreId();
    const empty = (tz: string) => ({
      store_timezone: tz,
      now: { day_of_week: 0, minutes: 0 },
      menus: [] as any[],
    });
    if (!store_id) return empty('America/Bogota');

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        industries: true,
        store_settings: { select: { settings: true } },
      },
    });
    const timezone =
      ((store?.store_settings?.settings as any)?.general?.timezone as string) ||
      'America/Bogota';

    const industries = (store?.industries ?? []) as string[];
    if (!industries.includes('restaurant')) return empty(timezone);

    // `minutes` de getDateInTimezone es minuto-de-la-hora (0-59); isWindowActive
    // necesita minuto-del-día → componer hours*60+minutes (ver menu-availability-checker).
    const { day: nowDay, hours, minutes } =
      this.menuAvailabilityChecker.getDateInTimezone(timezone);
    const nowMinutes = hours * 60 + minutes;

    const menus = await this.storePrisma.menus.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        is_active: true,
        availability_windows: {
          select: {
            id: true,
            day_of_week: true,
            start_time: true,
            end_time: true,
          },
        },
        sections: {
          orderBy: { sort_order: 'asc' },
          select: {
            id: true,
            name: true,
            sort_order: true,
            availability_windows: {
              select: {
                id: true,
                day_of_week: true,
                start_time: true,
                end_time: true,
              },
            },
            items: {
              orderBy: { sort_order: 'asc' },
              select: {
                id: true,
                product_id: true,
                sort_order: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    base_price: true,
                    sale_price: true,
                    is_on_sale: true,
                    is_combo: true,
                    is_sellable: true,
                    // Buyability invariant: a carta item must be both active
                    // and available_for_ecommerce; non-buyable products are
                    // filtered out below so the carta never shows a dish the
                    // detail/cart/checkout would reject.
                    state: true,
                    available_for_ecommerce: true,
                    product_images: {
                      where: { is_main: true },
                      take: 1,
                      select: { image_url: true },
                    },
                    // Variant info so the storefront can decide "Agregar"
                    // (no variants) vs "Ver opciones" (has variants) without a
                    // second round-trip. Same source the regular catalog uses.
                    _count: { select: { product_variants: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const mapWindow = (w: {
      id: number;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }) => ({
      id: w.id,
      day_of_week: w.day_of_week,
      start_time: w.start_time,
      end_time: w.end_time,
      is_active_now: this.menuAvailabilityChecker.isWindowActive(w, nowDay, nowMinutes),
    });

    const result = await Promise.all(
      menus.map(async (menu) => {
        const menuWindows = menu.availability_windows ?? [];
        const sections = await Promise.all(
          (menu.sections ?? []).map(async (section) => {
            const sectionWindows = section.availability_windows ?? [];
            // Un item se rige por las ventanas de su sección + las del menú.
            const gatingWindows = [...sectionWindows, ...menuWindows];
            // Buyability invariant: only items whose product is active AND
            // available_for_ecommerce can ever be added to cart / checked out.
            // Drop the rest so display == purchasable (no orphan carta items).
            const buyableItems = (section.items ?? []).filter(
              (item) =>
                item.product &&
                item.product.state === 'active' &&
                item.product.available_for_ecommerce === true,
            );
            const items = await Promise.all(
              buyableItems.map(async (item) => {
                const p = item.product;
                const isAvail =
                  gatingWindows.length === 0 ||
                  gatingWindows.some((w) =>
                    this.menuAvailabilityChecker.isWindowActive(w, nowDay, nowMinutes),
                  );
                const image_url = p?.product_images?.[0]?.image_url
                  ? await this.s3Service.signUrl(p.product_images[0].image_url)
                  : null;
                const variantCount = p?._count?.product_variants ?? 0;
                return {
                  id: item.id,
                  product_id: item.product_id,
                  sort_order: item.sort_order,
                  is_available_now: isAvail,
                  // Sold-out invariant: is_sellable=false → el plato SIGUE VISIBLE
                  // en la carta (no se filtra) pero el frontend lo marca como
                  // "Agotado" (off-card + sin quick-add). cart.addItem y checkout
                  // lo rechazan backend-side. Va a nivel item, no del product,
                  // porque es un estado de display del plato en la carta.
                  is_sold_out: p ? !p.is_sellable : false,
                  next_available: isAvail
                    ? null
                    : this.nextAvailableWindow(
                        gatingWindows,
                        nowDay,
                        nowMinutes,
                      ),
                  product: p
                    ? {
                        id: p.id,
                        name: p.name,
                        slug: p.slug,
                        base_price: p.base_price,
                        sale_price: p.sale_price,
                        is_on_sale: p.is_on_sale,
                        is_combo: p.is_combo,
                        // Variant signal for direct add-to-cart from the carta.
                        has_variants: variantCount > 0,
                        variant_count: variantCount,
                        image_url,
                      }
                    : null,
                };
              }),
            );
            const sectionAvail =
              gatingWindows.length === 0
                ? true
                : gatingWindows.some((w) =>
                    this.menuAvailabilityChecker.isWindowActive(w, nowDay, nowMinutes),
                  );
            return {
              id: section.id,
              name: section.name,
              sort_order: section.sort_order,
              is_available_now: sectionAvail,
              next_available: sectionAvail
                ? null
                : this.nextAvailableWindow(gatingWindows, nowDay, nowMinutes),
              availability_windows: sectionWindows.map(mapWindow),
              items,
            };
          }),
        );
        // Drop sections that have no buyable items after the invariant filter
        // (mirrors how empty/unavailable carta nodes are omitted).
        const nonEmptySections = sections.filter(
          (section) => section.items.length > 0,
        );
        const menuAvail =
          menuWindows.length === 0
            ? true
            : menuWindows.some((w) =>
                this.menuAvailabilityChecker.isWindowActive(w, nowDay, nowMinutes),
              );
        return {
          id: menu.id,
          name: menu.name,
          is_active: menu.is_active,
          is_available_now: menuAvail,
          next_available: menuAvail
            ? null
            : this.nextAvailableWindow(menuWindows, nowDay, nowMinutes),
          availability_windows: menuWindows.map(mapWindow),
          sections: nonEmptySections,
        };
      }),
    );

    // Drop menus left without any section after filtering.
    const nonEmptyMenus = result.filter((menu) => menu.sections.length > 0);

    return {
      store_timezone: timezone,
      now: { day_of_week: nowDay, minutes: nowMinutes },
      menus: nonEmptyMenus,
    };
  }

  /**
   * Soonest upcoming window (within a week) as {day_of_week, start_time},
   * or null when there are no windows. Powers "Disponible a las HH:mm".
   */
  private nextAvailableWindow(
    windows: Array<{
      day_of_week: number;
      start_time: string;
      end_time: string;
    }>,
    nowDay: number,
    nowMinutes: number,
  ): { day_of_week: number; start_time: string } | null {
    if (!windows || windows.length === 0) return null;
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    let best: { day_of_week: number; start_time: string } | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const w of windows) {
      const start = toMinutes(w.start_time);
      const dayDiff = (w.day_of_week - nowDay + 7) % 7;
      let delta = dayDiff * 1440 + (start - nowMinutes);
      if (delta <= 0) delta += 7 * 1440;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = { day_of_week: w.day_of_week, start_time: w.start_time };
      }
    }
    return best;
  }
}

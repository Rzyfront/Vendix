import { Injectable, NotFoundException } from '@nestjs/common';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { CatalogQueryDto, ProductSortBy } from './dto/catalog-query.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';

@Injectable()
export class CatalogService {
  private bestSellingCache: {
    [storeId: number]: { ids: number[]; timestamp: number };
  } = {};
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly s3Service: S3Service,
  ) { }

  async getProducts(query: CatalogQueryDto) {
    const {
      search,
      category_id,
      brand_id,
      ids,
      min_price,
      max_price,
      sort_by = ProductSortBy.NEWEST,
      page = 1,
      limit = 20,
    } = query;

    const skip = (page - 1) * limit;
    const store_id = RequestContextService.getStoreId();

    const where: any = {
      state: 'active',
      available_for_ecommerce: true,
      // store_id se aplica automáticamente por EcommercePrismaService
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category_id) {
      where.product_categories = {
        some: { category_id },
      };
    }

    if (brand_id) {
      where.brand_id = brand_id;
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

    if (String(query.has_discount) === 'true') {
      where.is_on_sale = true;
    }

    let orderBy: any;
    let explicitIds: number[] | null = null;

    if (sort_by === ProductSortBy.BEST_SELLING && store_id) {
      // 1. Intentar obtener IDs de caché o base de datos
      explicitIds = this.getBestSellingFromCache(store_id);
      if (!explicitIds) {
        explicitIds = await this.fetchBestSellingIds(store_id, Number(limit));
        this.setBestSellingCache(store_id, explicitIds);
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
          },
        }),
        this.prisma.products.count({ where: whereBestSelling }),
      ]);

      // Ordenar manualmente según el array de IDs
      const sortedBestSelling = bestSellingProducts.sort((a, b) => {
        return explicitIds!.indexOf(a.id) - explicitIds!.indexOf(b.id);
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
        const mappedData = await Promise.all(
          finalData.map((p) => this.mapProductToResponse(p)),
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
        },
      }),
      this.prisma.products.count({ where }),
    ]);

    const mappedData = await Promise.all(
      data.map((product) => this.mapProductToResponse(product)),
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
    const product = await this.prisma.products.findFirst({
      where: {
        slug,
        state: 'active',
        available_for_ecommerce: true,
        // store_id se aplica automáticamente por EcommercePrismaService
      },
      include: {
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
          where: { stock_quantity: { gt: 0 } },
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
        reviews: {
          where: { state: 'approved' },
          include: {
            users: {
              select: { first_name: true, last_name: true },
            },
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return await this.mapProductDetailToResponse(product);
  }

  async getCategories() {
    const categories = await this.prisma.categories.findMany({
      where: {
        state: 'active',
        // store_id se aplica automáticamente por EcommercePrismaService
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image_url: true,
      },
    });

    return await Promise.all(
      categories.map(async (cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        image_url: await this.s3Service.signUrl(cat.image_url),
      })),
    );
  }

  async getBrands() {
    const brands = await this.prisma.brands.findMany({
      where: {
        state: 'active',
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        logo_url: true,
      },
    });

    return await Promise.all(
      brands.map(async (brand) => ({
        id: brand.id,
        name: brand.name,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
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
    return store?.store_settings?.settings || {};
  }

  private getBestSellingFromCache(storeId: number): number[] | null {
    const cached = this.bestSellingCache[storeId];
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.ids;
    }
    return null;
  }

  private setBestSellingCache(storeId: number, ids: number[]): void {
    this.bestSellingCache[storeId] = {
      ids,
      timestamp: Date.now(),
    };
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

  private async mapProductToResponse(product: any) {
    const raw_image_url = product.product_images?.[0]?.image_url || null;
    const signed_image_url = await this.s3Service.signUrl(raw_image_url);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      base_price: product.base_price,
      sale_price: product.sale_price,
      is_on_sale: product.is_on_sale,
      final_price: this.calculateFinalPrice(product),
      sku: product.sku,
      stock_quantity: product.stock_quantity,
      image_url: signed_image_url || null,
      brand: product.brands,
      categories:
        product.product_categories?.map((pc: any) => pc.categories) || [],
    };
  }

  private async mapProductDetailToResponse(product: any) {
    const reviews = product.reviews || [];
    const avg_rating =
      reviews.length > 0
        ? reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) /
        reviews.length
        : 0;

    // Firmar todas las imágenes del producto
    const signed_images = await Promise.all(
      (product.product_images || []).map(async (img: any) => ({
        ...img,
        image_url: await this.s3Service.signUrl(img.image_url),
      })),
    );

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      base_price: product.base_price,
      sale_price: product.sale_price,
      is_on_sale: product.is_on_sale,
      final_price: this.calculateFinalPrice(product),
      sku: product.sku,
      stock_quantity: product.stock_quantity,
      images: signed_images,
      image_url: signed_images[0]?.image_url || null,
      brand: product.brands,
      categories:
        product.product_categories?.map((pc: any) => pc.categories) || [],
      variants: product.product_variants || [],
      reviews: reviews.map((r: any) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        user_name:
          `${r.users?.first_name || ''} ${r.users?.last_name || ''}`.trim(),
      })),
      avg_rating: Math.round(avg_rating * 10) / 10,
      review_count: reviews.length,
    };
  }

  /**
   * Calculates the final price of a product including taxes and active offers.
   */
  private calculateFinalPrice(product: any): number {
    const basePrice = product.is_on_sale && product.sale_price
      ? Number(product.sale_price)
      : Number(product.base_price);

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

    const finalPrice = basePrice * (1 + totalTaxRate);
    return Math.round(finalPrice * 100) / 100;
  }
}

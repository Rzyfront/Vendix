import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  CreateVariantWithStockDto,
  ProductImageDto,
  ProductState,
} from './dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from '@common/utils/slug.util';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { InventoryIntegrationService } from '../inventory/shared/services/inventory-integration.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { ProductVariantService } from './services/product-variant.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper, S3OrgContext, S3StoreContext } from '@common/helpers/s3-path.helper';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryService: InventoryIntegrationService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly productVariantService: ProductVariantService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) { }

  async create(createProductDto: CreateProductDto) {
    try {
      // Obtener store_id del DTO o del contexto del token
      // Obtener store_id del contexto
      const context = RequestContextService.getContext();
      const store_id = context?.store_id;

      if (!store_id) {
        throw new ForbiddenException(
          'Store context required for this operation',
        );
      }

      // Verify user context for audit
      const user_id = context?.user_id;
      if (!user_id) {
        throw new ForbiddenException(
          'User context required for stock operations',
        );
      }

      // Generar slug si no se proporciona
      const slug = createProductDto.slug || generateSlug(createProductDto.name);

      // Verificar que el slug sea único dentro de la tienda
      const existingProduct = await this.prisma.products.findFirst({
        where: {
          slug: slug,
        },
      });

      if (existingProduct) {
        throw new ConflictException(
          'El slug del producto ya existe en esta tienda',
        );
      }

      // Verificar que el SKU sea único si se proporciona
      if (createProductDto.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: {
            sku: createProductDto.sku,
          },
        });

        if (existingSku) {
          throw new ConflictException(
            `El SKU '${createProductDto.sku}' ya está en uso en esta tienda. Use un SKU diferente o deje el campo vacío.`,
          );
        }
      }

      // Verificar que el brand_id exista y esté activo
      if (createProductDto.brand_id) {
        const brand = await this.prisma.brands.findFirst({
          where: {
            id: createProductDto.brand_id,
            state: { not: 'archived' }, // Excluir marcas archivadas
          },
        });

        if (!brand) {
          throw new BadRequestException(
            `Brand with ID ${createProductDto.brand_id} not found or inactive. ` +
            `Please check available brands in the system.`,
          );
        }
      } else {
        // Si brand_id es nulo pero la tabla lo requiere, poner un valor por defecto o error
      }

      const {
        store_id: dto_store_id,
        category_ids,
        tax_category_ids,
        image_urls,
        images,
        stock_quantity,
        stock_by_location,
        variants,
        ...productData
      } = createProductDto;

      const result = await this.prisma.$transaction(
        async (prisma) => {
          // Crear producto usando scoped client para asegurar isolation
          const product = await prisma.products.create({
            data: {
              ...productData,
              store_id: store_id, // Agregar el store_id del contexto
              slug: slug,
              stock_quantity: 0, // Se inicializará via stock_levels
              updated_at: new Date(),
            } as any,
          });

          if (category_ids && category_ids.length > 0) {
            await prisma.product_categories.createMany({
              data: category_ids.map((categoryId) => ({
                product_id: product.id,
                category_id: categoryId,
              })),
            });
          }

          // Crear variantes si se proporcionan
          if (variants && variants.length > 0) {
            for (const variantData of variants) {
              const { variant_image_url, ...variantFields } = variantData as CreateVariantWithStockDto;
              const createdVariant = await this.productVariantService.createVariant(
                product.id,
                {
                  ...variantFields,
                  stock_quantity: variantFields.stock_quantity || 0,
                },
                prisma,
              );

              // Process variant image if base64 provided
              if (variant_image_url && variant_image_url.startsWith('data:image')) {
                const { org, store: storeCtx } = await this.getStoreWithOrgContext(store_id);
                const basePath = this.s3PathHelper.buildProductPath(org, storeCtx);
                const uploadResult = await this.s3Service.uploadBase64(
                  variant_image_url,
                  `${basePath}/${slug}-variant-${createdVariant.id}-${Date.now()}`,
                  undefined,
                  { generateThumbnail: true },
                );
                const variantImage = await prisma.product_images.create({
                  data: {
                    product_id: product.id,
                    image_url: uploadResult.key,
                    is_main: false,
                  },
                });
                await prisma.product_variants.update({
                  where: { id: createdVariant.id },
                  data: { image_id: variantImage.id },
                });
              }
            }
          }

          // Asignar categorías de impuestos si se proporcionan
          if (tax_category_ids && tax_category_ids.length > 0) {
            // Obtener contexto para validación
            const current_context = RequestContextService.getContext();

            // Validar que las categorías de impuestos existan y estén dentro del scope
            const tax_categories = await prisma.tax_categories.findMany({
              where: {
                id: { in: tax_category_ids },
                ...(current_context?.is_super_admin
                  ? {}
                  : {
                    OR: [
                      { store_id: store_id }, // Categorías específicas - El interceptor garantiza que este store_id es del usuario
                      { store_id: null }, // Categorías globales
                    ],
                  }),
              },
            });

            if (tax_categories.length !== tax_category_ids.length) {
              const found_ids = tax_categories.map((tc) => tc.id);
              const missing_ids = tax_category_ids.filter(
                (id) => !found_ids.includes(id),
              );
              throw new BadRequestException(
                `Tax categories not found or out of scope: ${missing_ids.join(', ')}`,
              );
            }

            await prisma.product_tax_assignments.createMany({
              data: tax_categories.map((tax_category) => ({
                product_id: product.id,
                tax_category_id: tax_category.id,
              })),
            });
          }

          // Manejar imágenes (combinar image_urls legacy con images structured)
          const finalImages: any[] = [];

          // 1. Procesar image_urls (legacy) - sanitize to prevent storing signed URLs
          if (image_urls && image_urls.length > 0) {
            finalImages.push(
              ...image_urls.map((url, index) => ({
                product_id: product.id,
                image_url: extractS3KeyFromUrl(url) || url,
                is_main: index === 0,
              })),
            );
          }

          // 2. Procesar images (structured with possible base64)
          if (images && images.length > 0) {
            const { org, store: storeContext } = await this.getStoreWithOrgContext(store_id);
            const uploadedImages = await this.handleImageUploads(images, slug, org, storeContext);
            finalImages.push(
              ...uploadedImages.map((img) => ({
                ...img,
                product_id: product.id,
              })),
            );
          }

          if (finalImages.length > 0) {
            // Asegurar que solo haya un is_main
            const mainExists = finalImages.some((img) => img.is_main);
            if (!mainExists) finalImages[0].is_main = true;

            await prisma.product_images.createMany({
              data: finalImages,
            });
          }

          // Inicializar stock levels para múltiples ubicaciones
          if (stock_by_location && stock_by_location.length > 0) {
            // Usar las ubicaciones especificadas en el DTO
            for (const stockLocation of stock_by_location) {
              await this.stockLevelManager.updateStock(
                {
                  product_id: product.id,
                  location_id: stockLocation.location_id,
                  quantity_change: stockLocation.quantity,
                  movement_type: 'initial',
                  reason: `Initial stock on product creation${stockLocation.notes ? ': ' + stockLocation.notes : ''}`,
                  user_id: user_id,
                  create_movement: true,
                  validate_availability: false,
                },
                prisma,
              );
            }
          } else if (stock_quantity && stock_quantity > 0) {
            // Mantener compatibilidad con el campo stock_quantity (usa ubicación default)
            const defaultLocation =
              await this.inventoryLocationsService.getDefaultLocation(
                product.store_id,
              );

            await this.stockLevelManager.updateStock(
              {
                product_id: product.id,
                location_id: defaultLocation.id,
                quantity_change: stock_quantity,
                movement_type: 'initial',
                reason: 'Initial stock on product creation (legacy)',
                user_id: user_id,
                create_movement: true,
                validate_availability: false,
              },
              prisma,
            );
          }

          // Inicializar stock levels para todas las ubicaciones de la organización
          // Obtenemos el organization_id del contexto
          const orgContext = RequestContextService.getContext();
          if (orgContext?.organization_id) {
            await this.stockLevelManager.initializeStockLevelsForProduct(
              product.id,
              orgContext.organization_id,
              prisma,
            );
          }

          // Obtener el producto completo con todas las relaciones para retornar
          const completeProduct = await prisma.products.findUnique({
            where: { id: product.id },
            include: {
              stores: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  organization_id: true,
                },
              },
              brands: true,
              product_categories: {
                include: {
                  categories: true,
                },
              },
              product_tax_assignments: {
                include: {
                  tax_categories: true,
                },
              },
              product_images: {
                orderBy: { is_main: 'desc' },
              },
              product_variants: {
                include: {
                  product_images: true,
                },
              },
              reviews: {
                where: { state: 'approved' },
                include: {
                  users: {
                    select: {
                      id: true,
                      first_name: true,
                      last_name: true,
                    },
                  },
                },
                orderBy: { created_at: 'desc' },
                take: 10,
              },
              stock_levels: {
                select: {
                  quantity_available: true,
                  quantity_reserved: true,
                  reorder_point: true,
                  inventory_locations: {
                    select: {
                      id: true,
                      name: true,
                      type: true,
                    },
                  },
                },
              },
              _count: {
                select: {
                  product_variants: true,
                  product_images: true,
                  reviews: true,
                },
              },
            },
          });

          // Calcular stock totals dinámicamente
          const totalStockAvailable = completeProduct.stock_levels.reduce(
            (sum, stock) => sum + stock.quantity_available,
            0,
          );
          const totalStockReserved = completeProduct.stock_levels.reduce(
            (sum, stock) => sum + stock.quantity_reserved,
            0,
          );

          // Retornar producto con información de stock enriquecida
          const mainImage = completeProduct.product_images[0];
          let imageUrl = mainImage?.image_url;
          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = await this.s3Service.getPresignedUrl(imageUrl);
          }

          return {
            ...completeProduct,
            image_url: imageUrl,
            // Mantener compatibilidad con el campo existente pero basado en stock_levels
            stock_quantity: totalStockAvailable,
            // Nuevos campos agregados para mayor claridad
            total_stock_available: totalStockAvailable,
            total_stock_reserved: totalStockReserved,
            stock_by_location: completeProduct.stock_levels.map((stock) => ({
              location_id: stock.inventory_locations.id,
              location_name: stock.inventory_locations.name,
              location_type: stock.inventory_locations.type,
              available: stock.quantity_available,
              reserved: stock.quantity_reserved,
              reorder_point: stock.reorder_point,
            })),
          };
        },
        { timeout: 30000 },
      );

      return result;
    } catch (error) {

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El producto ya existe');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Tienda, categoría o marca no válida');
        }
      }
      throw error;
    }
  }

  async findAll(query: ProductQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      brand_id,
      include_inactive,
      pos_optimized,
      barcode,
      include_stock,
      include_variants,
      category_id,
    } = query;
    const skip = (page - 1) * limit;

    // Obtener contexto para aplicar scope automático
    const context = RequestContextService.getContext();
    // store_id check is handled by StorePrismaService

    const where: Prisma.productsWhereInput = {
      // Auto-scoped by StorePrismaService
      state: pos_optimized
        ? ProductState.ACTIVE
        : include_inactive
          ? undefined
          : { not: 'archived' }, // Excluir archivados por defecto
      ...(barcode && {
        // Búsqueda exacta por código de barras para POS
        OR: [{ sku: { equals: barcode, mode: 'insensitive' } }],
      }),
      ...(search &&
        !barcode && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(state && { state }),
      ...(brand_id && { brand_id }),
      ...(category_id && {
        product_categories: {
          some: { category_id },
        },
      }),
    };

    const [products, total] = await Promise.all([
      this.prisma.products.findMany({
        where,
        skip,
        take: limit,
        include: {
          stores: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          brands: {
            select: {
              id: true,
              name: true,
            },
          },
          product_categories: {
            include: {
              categories: {
                select: {
                  id: true,
                  name: true,
                },
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
          product_images: {
            where: { is_main: true },
            take: 1,
          },
          ...(include_stock && {
            stock_levels: {
              select: {
                quantity_available: true,
                quantity_reserved: true,
                inventory_locations: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                  },
                },
              },
            },
          }),
          ...((include_variants || pos_optimized) && {
            product_variants: {
              select: {
                id: true,
                sku: true,
                price_override: true,
                cost_price: true,
                stock_quantity: true,
                attributes: true,
                name: true,
                stock_levels: {
                  select: {
                    quantity_available: true,
                    quantity_reserved: true,
                    ...((!pos_optimized) && {
                      inventory_locations: {
                        select: {
                          id: true,
                          name: true,
                          type: true,
                        },
                      },
                    }),
                  },
                },
                product_images: {
                  select: { image_url: true },
                },
              },
            },
          }),
          _count: {
            select: {
              product_variants: true,
              product_images: true,
              reviews: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.products.count({ where }),
    ]);

    // Para POS optimizado, retornar productos directamente con imágenes firmadas
    if (pos_optimized) {
      const productsWithSignedImages = await Promise.all(
        products.map(async (product) => {
          const raw_image_url = product.product_images?.[0]?.image_url || null;
          const signed_image_url = await this.s3Service.signUrl(raw_image_url);

          // Map variant data for POS
          const product_variants = (product as any).product_variants?.map((variant: any) => {
            const variantStock = variant.stock_levels?.[0]?.quantity_available ?? variant.stock_quantity ?? 0;
            const variantImageUrl = variant.product_images?.image_url || null;

            return {
              id: variant.id,
              sku: variant.sku,
              price_override: variant.price_override ? Number(variant.price_override) : null,
              cost_price: variant.cost_price ? Number(variant.cost_price) : null,
              stock: variantStock,
              image_url: variantImageUrl,
              attributes: this.parseVariantAttributes(variant.attributes),
            };
          }) || [];

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
            cost_price: product.cost_price,
            stock_quantity: product.stock_quantity,
            state: product.state,
            track_inventory: product.track_inventory,
            image_url: signed_image_url || null,
            brand: product.brands,
            categories: product.product_categories?.map((pc: any) => pc.categories) || [],
            product_tax_assignments: product.product_tax_assignments,
            stock_levels: product.stock_levels,
            has_variants: product_variants.length > 0,
            product_variants,
          };
        }),
      );

      // Sign variant images
      for (const product of productsWithSignedImages) {
        if (product.product_variants) {
          for (const variant of product.product_variants) {
            if (variant.image_url) {
              variant.image_url = await this.s3Service.signUrl(variant.image_url);
            }
          }
        }
      }

      return {
        data: productsWithSignedImages,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Calcular stock totals dinámicamente para cada producto
    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const totalStockAvailable =
          product.stock_levels?.reduce(
            (sum, stock) => sum + stock.quantity_available,
            0,
          ) || 0;
        const totalStockReserved =
          product.stock_levels?.reduce(
            (sum, stock) => sum + stock.quantity_reserved,
            0,
          ) || 0;

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
          cost_price: product.cost_price,
          state: product.state,
          track_inventory: product.track_inventory,
          image_url: signed_image_url || null,
          brand: product.brands,
          categories: product.product_categories?.map((pc: any) => pc.categories) || [],
          product_tax_assignments: product.product_tax_assignments,
          // Mantener compatibilidad con el campo existente pero basado en stock_levels
          stock_quantity: totalStockAvailable,
          // Nuevos campos agregados para mayor claridad
          total_stock_available: totalStockAvailable,
          total_stock_reserved: totalStockReserved,
          stock_by_location:
            product.stock_levels?.map((stock) => ({
              location_id: stock.inventory_locations.id,
              location_name: stock.inventory_locations.name,
              location_type: stock.inventory_locations.type,
              available: stock.quantity_available,
              reserved: stock.quantity_reserved,
            })) || [],
          stock_levels: product.stock_levels,
          stores: product.stores,
        };
      }),
    );

    return {
      data: productsWithStock,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    // Obtener contexto para aplicar scope automático
    const context = RequestContextService.getContext();

    const product = await this.prisma.products.findFirst({
      where: {
        id,
        state: { not: ProductState.ARCHIVED }, // No mostrar productos archivados
        // Aplicar scope de store_id a menos que sea super admin
        ...(!context?.is_super_admin && {
          store_id: context?.store_id,
        }),
      },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization_id: true,
          },
        },
        brands: true,
        product_categories: {
          include: {
            categories: true,
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
        product_images: {
          orderBy: { is_main: 'desc' },
        },
        product_variants: {
          include: {
            product_images: true,
          },
        },
        reviews: {
          where: { state: 'approved' },
          include: {
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        stock_levels: {
          select: {
            quantity_available: true,
            quantity_reserved: true,
            reorder_point: true,
            inventory_locations: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
        _count: {
          select: {
            product_variants: true,
            product_images: true,
            reviews: true,
          },
        },
        inventory_batches: {
          include: {
            inventory_locations: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Calcular stock totals dinámicamente
    const totalStockAvailable = product.stock_levels.reduce(
      (sum, stock) => sum + stock.quantity_available,
      0,
    );
    const totalStockReserved = product.stock_levels.reduce(
      (sum, stock) => sum + stock.quantity_reserved,
      0,
    );

    // Sign all images
    await this.signProductImages(product);

    // Retornar producto con información de stock enriquecida
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
      cost_price: product.cost_price,
      state: product.state,
      track_inventory: product.track_inventory,
      image_url: await this.signProductImage(product),
      brand: product.brands,
      categories: product.product_categories?.map((pc: any) => pc.categories) || [],
      product_tax_assignments: product.product_tax_assignments,
      product_images: product.product_images,
      product_variants: product.product_variants,
      reviews: product.reviews,
      _count: product._count,
      inventory_batches: product.inventory_batches,
      // Mantener compatibilidad con el campo existente pero basado en stock_levels
      stock_quantity: totalStockAvailable,
      // Nuevos campos agregados para mayor claridad
      total_stock_available: totalStockAvailable,
      total_stock_reserved: totalStockReserved,
      stock_by_location: product.stock_levels.map((stock) => ({
        location_id: stock.inventory_locations.id,
        location_name: stock.inventory_locations.name,
        location_type: stock.inventory_locations.type,
        available: stock.quantity_available,
        reserved: stock.quantity_reserved,
        reorder_point: stock.reorder_point,
      })),
      stock_levels: product.stock_levels,
      stores: product.stores,
    };
  }

  async findBySlug(storeId: number, slug: string) {
    // storeId param is redundant if forced by context, but we can keep it if needed.
    // However, StorePrismaService filters by context.store_id.
    const product = await this.prisma.products.findFirst({
      where: {
        slug,
        state: ProductState.ACTIVE, // Solo productos activos
      },
      include: {
        stores: true,
        brands: true,
        product_images: true,
        product_variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    await this.signProductImages(product);

    return {
      ...product,
      image_url: await this.signProductImage(product),
    };
  }

  async update(id: number, updateProductDto: UpdateProductDto) {
    try {
      // Verificar que el producto existe y no está archivado
      const existingProduct = await this.prisma.products.findFirst({
        where: {
          id,
          state: { not: ProductState.ARCHIVED },
        },
      });

      if (!existingProduct) {
        throw new NotFoundException('Producto no encontrado');
      }

      // Si se actualiza el slug, verificar que sea único dentro de la tienda
      if (updateProductDto.slug) {
        const existingSlug = await this.prisma.products.findFirst({
          where: {
            slug: updateProductDto.slug,
            NOT: { id },
          },
        });

        if (existingSlug) {
          throw new ConflictException('El slug ya está en uso en esta tienda');
        }
      }

      // Si se actualiza el SKU, verificar que sea único dentro de la tienda
      if (updateProductDto.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: {
            store_id: existingProduct.store_id,
            sku: updateProductDto.sku,
            NOT: { id },
          },
        });

        if (existingSku) {
          throw new ConflictException(
            `El SKU '${updateProductDto.sku}' ya está en uso en esta tienda`,
          );
        }
      }

      // Obtener contexto al inicio
      const context = RequestContextService.getContext();
      const user_id = context?.user_id;

      if (
        !user_id &&
        (updateProductDto.stock_quantity !== undefined ||
          (updateProductDto.stock_by_location &&
            updateProductDto.stock_by_location.length > 0))
      ) {
        throw new ForbiddenException(
          'User context required for stock operations',
        );
      }

      const {
        category_ids,
        tax_category_ids,
        image_urls,
        images,
        stock_quantity,
        stock_by_location,
        variants,
        price, // Exclude as it's not in DB
        ...productData
      } = updateProductDto;

      console.log('Product update data:', productData);

      const result = await this.prisma.$transaction(
        async (prisma) => {
          // Actualizar producto
          const product = await prisma.products.update({
            where: { id },
            data: {
              ...productData,
              updated_at: new Date(),
            } as any,
          });

          // Actualizar categorías si se proporcionan
          if (category_ids !== undefined) {
            await prisma.product_categories.deleteMany({
              where: { product_id: id },
            });

            if (category_ids.length > 0) {
              await prisma.product_categories.createMany({
                data: category_ids.map((categoryId) => ({
                  product_id: id,
                  category_id: categoryId,
                })),
              });
            }
          }

          // Actualizar categorías de impuestos si se proporcionan
          if (tax_category_ids !== undefined) {
            await prisma.product_tax_assignments.deleteMany({
              where: { product_id: id },
            });

            if (tax_category_ids.length > 0) {
              await prisma.product_tax_assignments.createMany({
                data: tax_category_ids.map((tax_category_id) => ({
                  product_id: id,
                  tax_category_id: tax_category_id,
                })),
              });
            }
          }

          // Actualizar imágenes si se proporcionan
          if (image_urls !== undefined || images !== undefined) {
            // 0. Recolectar URLs viejas para limpiar S3 después
            const oldImages = await prisma.product_images.findMany({
              where: { product_id: id },
              select: { image_url: true },
            });
            const oldS3Keys = oldImages.map((img) => img.image_url).filter(Boolean);

            // 1. Limpiar image_id en variantes para evitar FK Restrict
            await prisma.product_variants.updateMany({
              where: { product_id: id, image_id: { not: null } },
              data: { image_id: null },
            });

            await prisma.product_images.deleteMany({
              where: { product_id: id },
            });

            const finalImages: any[] = [];

            // 2. Procesar image_urls (legacy) - sanitize to prevent storing signed URLs
            if (image_urls && image_urls.length > 0) {
              finalImages.push(
                ...image_urls.map((url, index) => ({
                  product_id: id,
                  image_url: extractS3KeyFromUrl(url) || url,
                  is_main: index === 0,
                })),
              );
            }

            // 3. Procesar images (structured with possible base64)
            if (images && images.length > 0) {
              const { org, store: storeContext } = await this.getStoreWithOrgContext(existingProduct.store_id);
              const uploadedImages = await this.handleImageUploads(
                images,
                product.slug,
                org,
                storeContext,
              );
              finalImages.push(
                ...uploadedImages.map((img) => ({
                  ...img,
                  product_id: id,
                })),
              );
            }

            if (finalImages.length > 0) {
              // Asegurar que solo haya un is_main
              const mainExists = finalImages.some((img) => img.is_main);
              if (!mainExists) finalImages[0].is_main = true;

              await prisma.product_images.createMany({
                data: finalImages,
              });
            }

            // 4. Determinar qué keys de S3 ya no se usan y eliminarlas
            const newS3Keys = new Set(finalImages.map((img) => img.image_url));
            const keysToDelete = oldS3Keys.filter((key) => !newS3Keys.has(key));

            // Eliminar de S3 fuera del camino crítico (no bloquea la transacción)
            if (keysToDelete.length > 0) {
              Promise.allSettled(
                keysToDelete.flatMap((key) => {
                  const parts = key.split('/');
                  const fileName = parts.pop();
                  const thumbKey = [...parts, `thumb_${fileName}`].join('/');
                  return [
                    this.s3Service.deleteFile(key),
                    this.s3Service.deleteFile(thumbKey).catch(() => {}),
                  ];
                }),
              ).catch((err) => console.warn('S3 cleanup error during product update:', err));
            }
          }

          // Sincronizar variantes si se proporcionan
          if (variants !== undefined) {
            // Recolectar IDs de variantes existentes en DB ANTES del upsert
            const allExistingVariants = await prisma.product_variants.findMany({
              where: { product_id: id },
              include: { product_images: { select: { image_url: true } } },
            });
            const existingVariantMap = new Map(
              allExistingVariants.map((v) => [v.id, v]),
            );

            // Detect simple → variant transition
            const isTransitionToVariants =
              allExistingVariants.length === 0 && variants.length > 0;

            // If transitioning, clear base stock and get location_ids for inheritance
            let inheritedLocationIds: number[] = [];
            if (isTransitionToVariants) {
              inheritedLocationIds =
                await this.stockLevelManager.clearBaseStock(
                  id,
                  user_id!,
                  prisma,
                );
            }

            // IDs de variantes que se mantienen (enviadas desde el frontend)
            const keptVariantIds = new Set<number>();

            for (const variantData of variants) {
              const { variant_image_url, id: variantDbId, ...variantFields } = variantData as CreateVariantWithStockDto & { id?: number };

              // Buscar variante existente: primero por ID, luego por SKU como fallback
              let existingVariant = variantDbId
                ? await prisma.product_variants.findFirst({
                    where: { id: variantDbId, product_id: id },
                  })
                : null;

              if (!existingVariant) {
                existingVariant = await prisma.product_variants.findFirst({
                  where: { product_id: id, sku: variantData.sku },
                });
              }

              let variantId: number;

              if (existingVariant) {
                // Actualizar variante existente
                await this.productVariantService.updateVariant(
                  existingVariant.id,
                  variantFields,
                  prisma,
                );
                variantId = existingVariant.id;
              } else {
                // Crear nueva variante
                const createdVariant = await this.productVariantService.createVariant(
                  id,
                  {
                    ...variantFields,
                    stock_quantity: variantFields.stock_quantity || 0,
                  },
                  prisma,
                );
                variantId = createdVariant.id;

                // If transitioning, inherit locations from base stock
                if (
                  isTransitionToVariants &&
                  inheritedLocationIds.length > 0
                ) {
                  await this.stockLevelManager.initializeVariantStockAtLocations(
                    id,
                    variantId,
                    inheritedLocationIds,
                    prisma,
                  );
                }
              }

              keptVariantIds.add(variantId);

              // Process variant image if new base64 provided
              if (variant_image_url && variant_image_url.startsWith('data:image')) {
                const { org, store: storeCtx } = await this.getStoreWithOrgContext(existingProduct.store_id);
                const basePath = this.s3PathHelper.buildProductPath(org, storeCtx);
                const uploadResult = await this.s3Service.uploadBase64(
                  variant_image_url,
                  `${basePath}/${product.slug}-variant-${variantId}-${Date.now()}`,
                  undefined,
                  { generateThumbnail: true },
                );
                const variantImage = await prisma.product_images.create({
                  data: {
                    product_id: id,
                    image_url: uploadResult.key,
                    is_main: false,
                  },
                });
                await prisma.product_variants.update({
                  where: { id: variantId },
                  data: { image_id: variantImage.id },
                });
              }
            }

            // Eliminar variantes que NO están en la lista enviada (por ID)
            for (const ev of allExistingVariants) {
              if (!keptVariantIds.has(ev.id)) {
                // Limpiar FK Restrict antes de borrar (order_items, inventory_adjustments)
                await prisma.order_items.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.inventory_adjustments.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });

                // Limpiar imagen de variante de S3
                if (ev.image_id && ev.product_images?.image_url) {
                  const key = ev.product_images.image_url;
                  const parts = key.split('/');
                  const fileName = parts.pop();
                  const thumbKey = [...parts, `thumb_${fileName}`].join('/');
                  this.s3Service.deleteFile(key).catch(() => {});
                  this.s3Service.deleteFile(thumbKey).catch(() => {});

                  // Limpiar image_id para poder borrar product_images
                  await prisma.product_variants.update({
                    where: { id: ev.id },
                    data: { image_id: null },
                  });
                  await prisma.product_images.delete({
                    where: { id: ev.image_id },
                  }).catch(() => {});
                }

                await prisma.product_variants.delete({
                  where: { id: ev.id },
                });
              }
            }
          }

          // Guard: skip base stock updates when product has variants
          const currentVariantCount = await prisma.product_variants.count({
            where: { product_id: id },
          });

          if (currentVariantCount === 0) {
            // Actualizar stock levels para múltiples ubicaciones
            if (stock_by_location !== undefined && stock_by_location.length > 0) {
              // Actualizar stock en las ubicaciones especificadas
              for (const stockLocation of stock_by_location) {
                // Obtener stock actual en esta ubicación
                const currentStockLevel = await prisma.stock_levels.findUnique({
                  where: {
                    product_id_location_id_product_variant_id: {
                      product_id: id,
                      location_id: stockLocation.location_id,
                      product_variant_id: null,
                    },
                  },
                });

                const currentQuantity =
                  currentStockLevel?.quantity_available || 0;
                const quantityChange = stockLocation.quantity - currentQuantity;

                if (quantityChange !== 0) {
                  await this.stockLevelManager.updateStock(
                    {
                      product_id: id,
                      location_id: stockLocation.location_id,
                      quantity_change: quantityChange,
                      movement_type: 'adjustment',
                      reason: `Stock adjusted from product edit${stockLocation.notes ? ': ' + stockLocation.notes : ''}`,
                      user_id: user_id!, // Non-null assertion safe because we checked above
                      create_movement: true,
                      validate_availability: false,
                    },
                    prisma,
                  );
                }
              }
            } else if (stock_quantity !== undefined) {
              // Mantener compatibilidad con el campo stock_quantity (usa ubicación default)
              const stockDifference =
                stock_quantity - existingProduct.stock_quantity;

              if (stockDifference !== 0) {
                const defaultLocation =
                  await this.inventoryLocationsService.getDefaultLocation(
                    product.store_id,
                  );

                await this.stockLevelManager.updateStock(
                  {
                    product_id: id,
                    location_id: defaultLocation.id,
                    quantity_change: stockDifference,
                    movement_type: 'adjustment',
                    reason: 'Stock quantity updated from product edit (legacy)',
                    user_id: user_id!, // Non-null assertion safe because we checked above
                    create_movement: true,
                    validate_availability: false,
                  },
                  prisma,
                );
              }
            }
          }

          return product;
        },
        { timeout: 30000 },
      );

      return await this.findOne(result.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Conflicto de datos únicos');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Categoría o marca no válida');
        }
      }
      throw error;
    }
  }

  // Borrado lógico para roles normales
  async deactivate(id: number) {
    const existingProduct = await this.prisma.products.findFirst({
      where: {
        id,
        state: { not: ProductState.ARCHIVED },
      },
    });

    if (!existingProduct) {
      throw new NotFoundException('Producto no encontrado');
    }

    return await this.prisma.products.update({
      where: { id },
      data: {
        state: ProductState.INACTIVE,
        updated_at: new Date(),
      },
    });
  }

  // Eliminación lógica - archivar producto
  async remove(id: number) {
    try {
      // Verificar que el producto existe
      await this.findOne(id);

      // Eliminación lógica: cambiar estado a archived
      return await this.prisma.products.update({
        where: { id },
        data: {
          state: 'archived',
          updated_at: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('Producto no encontrado');
        }
      }
      throw error;
    }
  }

  // Obtener productos por tienda (solo activos)
  async getProductsByStore(storeId: number) {
    const products = await this.prisma.products.findMany({
      where: {
        store_id: storeId,
        state: ProductState.ACTIVE,
      },
      include: {
        brands: true,
        product_images: {
          where: { is_main: true },
          take: 1,
        },
        stock_levels: {
          select: {
            quantity_available: true,
            quantity_reserved: true,
            inventory_locations: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
        _count: {
          select: {
            product_variants: true,
            reviews: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Calcular stock totals y firmar imágenes
    return await Promise.all(
      products.map(async (product) => {
        const totalStockAvailable = product.stock_levels.reduce(
          (sum, stock) => sum + stock.quantity_available,
          0,
        );
        const totalStockReserved = product.stock_levels.reduce(
          (sum, stock) => sum + stock.quantity_reserved,
          0,
        );

        return {
          ...product,
          image_url: await this.signProductImage(product, true),
          // Mantener compatibilidad con el campo existente pero basado en stock_levels
          stock_quantity: totalStockAvailable,
          // Nuevos campos agregados para mayor claridad
          total_stock_available: totalStockAvailable,
          total_stock_reserved: totalStockReserved,
          stock_by_location: product.stock_levels.map((stock) => ({
            location_id: stock.inventory_locations.id,
            location_name: stock.inventory_locations.name,
            location_type: stock.inventory_locations.type,
            available: stock.quantity_available,
            reserved: stock.quantity_reserved,
          })),
        };
      }),
    );
  }

  // Gestión de variantes

  // Gestión de imágenes
  async addImage(productId: number, imageDto: ProductImageDto) {
    // Verificar que el producto existe y está activo
    const product = await this.prisma.products.findFirst({
      where: {
        id: productId,
        state: ProductState.ACTIVE,
      },
    });

    if (!product) {
      throw new BadRequestException('Producto no encontrado o inactivo');
    }

    // Si es imagen principal, quitar el flag de las demás
    if (imageDto.is_main) {
      await this.prisma.product_images.updateMany({
        where: { product_id: productId },
        data: { is_main: false },
      });
    }

    return await this.prisma.product_images.create({
      data: {
        product_id: productId,
        ...imageDto,
      },
    });
  }

  async removeImage(imageId: number) {
    const existingImage = await this.prisma.product_images.findUnique({
      where: { id: imageId },
    });

    if (!existingImage) {
      throw new NotFoundException('Imagen no encontrada');
    }

    // Limpiar referencia en variantes que usen esta imagen
    await this.prisma.product_variants.updateMany({
      where: { image_id: imageId },
      data: { image_id: null },
    });

    // Eliminar de S3 (archivo + thumbnail)
    if (existingImage.image_url) {
      try {
        await this.s3Service.deleteFile(existingImage.image_url);
        // Intentar eliminar thumbnail (formato: thumb_{fileName})
        const parts = existingImage.image_url.split('/');
        const fileName = parts.pop();
        const thumbKey = [...parts, `thumb_${fileName}`].join('/');
        await this.s3Service.deleteFile(thumbKey).catch(() => {});
      } catch (error) {
        // Log pero no bloquear — la imagen DB se elimina igual
        console.warn(`Failed to delete S3 file for image ${imageId}:`, error);
      }
    }

    return await this.prisma.product_images.delete({
      where: { id: imageId },
    });
  }

  async getProductStats(storeId: number) {
    try {
      // Get all products for the store
      const products = await this.prisma.products.findMany({
        where: {
          store_id: storeId,
        },
        include: {
          product_images: true,
        },
      });

      // Calculate stats
      const total_products = products.length;
      const active_products = products.filter(
        (p) => p.state === 'active',
      ).length;
      const inactive_products = products.filter(
        (p) => p.state === 'inactive',
      ).length;
      const archived_products = products.filter(
        (p) => p.state === 'archived',
      ).length;

      // Stock calculations (simplified - using stock_quantity field)
      const low_stock_products = products.filter(
        (p) =>
          p.stock_quantity !== null &&
          p.stock_quantity !== undefined &&
          p.stock_quantity > 0 &&
          p.stock_quantity <= 10,
      ).length;

      const out_of_stock_products = products.filter(
        (p) =>
          p.stock_quantity !== null &&
          p.stock_quantity !== undefined &&
          p.stock_quantity === 0,
      ).length;

      // Products without images
      const products_without_images = products.filter(
        (p) => !p.product_images || p.product_images.length === 0,
      ).length;

      // Total value (sum of base_price * stock_quantity)
      const total_value = products.reduce((sum, product) => {
        const stock = product.stock_quantity || 0;
        return sum + product.base_price * stock;
      }, 0);

      // Count unique categories and brands
      const categories_count = await this.prisma.categories.count({
        where: {
          store_id: storeId,
        },
      });

      // Count brands that have products in this store
      const brands_count = await this.prisma.brands.count({
        where: {
          products: {
            some: {
              store_id: storeId,
            },
          },
        },
      });

      return {
        total_products,
        active_products,
        inactive_products,
        archived_products,
        low_stock_products,
        out_of_stock_products,
        products_without_images,
        total_value,
        categories_count,
        brands_count,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error calculating product stats: ${error.message}`,
      );
    }
  }

  async createVariant(
    productId: number,
    createVariantDto: CreateProductVariantDto,
  ) {
    return this.productVariantService.createVariant(
      productId,
      createVariantDto,
    );
  }

  async updateVariant(
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
  ) {
    return this.productVariantService.updateVariant(
      variantId,
      updateVariantDto,
    );
  }

  async removeVariant(variantId: number) {
    return this.productVariantService.removeVariant(variantId);
  }

  private async handleImageUploads(
    images: ProductImageDto[],
    productSlug: string,
    org: S3OrgContext,
    store: S3StoreContext,
  ): Promise<any[]> {
    const processedImages: any[] = [];
    const basePath = this.s3PathHelper.buildProductPath(org, store);

    for (const [index, image] of images.entries()) {
      let imageUrl = image.image_url;
      if (imageUrl.startsWith('data:image')) {
        // Upload base64 image - result.key is already a clean S3 key
        const result = await this.s3Service.uploadBase64(
          imageUrl,
          `${basePath}/${productSlug}-${Date.now()}-${index}`,
          undefined,
          { generateThumbnail: true },
        );
        imageUrl = result.key;
      } else {
        // CRITICAL: Sanitize existing URLs to extract S3 key
        // This prevents storing signed URLs that expire after 24 hours
        const sanitizedKey = extractS3KeyFromUrl(imageUrl);
        imageUrl = sanitizedKey || imageUrl;
      }
      processedImages.push({
        image_url: imageUrl,
        is_main: image.is_main || false,
        alt_text: image.alt_text,
        sort_order: image.sort_order || index,
      });
    }
    return processedImages;
  }

  private parseVariantAttributes(attributes: any): Array<{ attribute_name: string; attribute_value: string }> {
    if (!attributes || typeof attributes !== 'object') return [];
    return Object.entries(attributes).map(([key, value]) => ({
      attribute_name: key,
      attribute_value: String(value),
    }));
  }

  private async signProductImage(
    product: any,
    useThumbnail = false,
  ): Promise<string | undefined> {
    const mainImage =
      product.product_images?.find((img) => img.is_main) ||
      product.product_images?.[0];
    return this.s3Service.signUrl(mainImage?.image_url, useThumbnail);
  }

  private async signProductImages(product: any): Promise<void> {
    if (product.product_images) {
      for (const img of product.product_images) {
        img.image_url = await this.s3Service.signUrl(img.image_url);
      }
    }

    if (product.product_variants) {
      for (const variant of product.product_variants) {
        if (variant.product_images) {
          variant.product_images.image_url = await this.s3Service.signUrl(
            variant.product_images.image_url,
          );
        }
      }
    }
  }

  /**
   * Helper to get store with organization context for S3 path building
   */
  private async getStoreWithOrgContext(
    storeId: number,
  ): Promise<{ org: S3OrgContext; store: S3StoreContext }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: { id: true, slug: true },
        },
      },
    });

    if (!store || !store.organizations) {
      throw new BadRequestException('Store or organization not found');
    }

    return {
      org: store.organizations,
      store: { id: store.id, slug: store.slug },
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

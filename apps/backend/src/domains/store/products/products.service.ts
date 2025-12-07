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

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryService: InventoryIntegrationService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly productVariantService: ProductVariantService,
  ) { }

  async create(createProductDto: CreateProductDto) {
    try {
      // Obtener store_id del DTO o del contexto del token
      // Obtener store_id del contexto
      const context = RequestContextService.getContext();
      const store_id = context?.store_id;

      if (!store_id) {
        throw new ForbiddenException('Store context required for this operation');
      }

      // Generar slug si no se proporciona
      const slug = createProductDto.slug || generateSlug(createProductDto.name);

      // Verificar que el slug sea único dentro de la tienda
      const existingProduct = await this.prisma.products.findFirst({
        where: {
          store_id: store_id,
          slug: slug,
          state: { not: ProductState.ARCHIVED },
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
            store_id: store_id,
            sku: createProductDto.sku,
            state: { not: ProductState.ARCHIVED },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
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
          // Log específico para debugging
          console.error(
            `Brand ID ${createProductDto.brand_id} not found. Available brands:`,
            await this.prisma.brands.findMany({
              select: { id: true, name: true, state: true },
            }),
          );

          throw new BadRequestException(
            `Brand with ID ${createProductDto.brand_id} not found or inactive. ` +
            `Please check available brands in the system.`,
          );
        }
      } else {
        // Si brand_id es nulo pero la tabla lo requiere, poner un valor por defecto o error
        console.warn(
          'Creating product without brand_id. This might cause FK violation.',
        );
      }

      // Verificar que el category_id exista y pertenezca a la tienda
      if (createProductDto.category_id) {
        const category = await this.prisma.categories.findFirst({
          where: {
            id: createProductDto.category_id,
            OR: [
              { store_id: store_id }, // Categoría específica de la tienda
              { store_id: null }, // Categoría global
            ],
            state: { not: 'archived' },
          },
        });

        if (!category) {
          throw new BadRequestException(
            `Category with ID ${createProductDto.category_id} not found, inactive, or out of store scope`,
          );
        }
      }

      const {
        store_id: dto_store_id,
        category_ids,
        tax_category_ids,
        image_urls,
        stock_quantity,
        stock_by_location,
        ...productData
      } = createProductDto;

      const result = await this.prisma.$transaction(async (prisma) => {
        // Crear producto usando scoped client para asegurar isolation
        const product = await prisma.products.create({
          data: {
            ...productData,
            store_id: store_id, // Agregar el store_id del contexto
            slug: slug,
            stock_quantity: 0, // Se inicializará via stock_levels
            updated_at: new Date(),
          },
        });

        // Asignar categorías si se proporcionan
        if (category_ids && category_ids.length > 0) {
          await prisma.product_categories.createMany({
            data: category_ids.map((categoryId) => ({
              product_id: product.id,
              category_id: categoryId,
            })),
          });
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
                    { store_id: store_id }, // Categorías específicas de la tienda
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

        // Crear imágenes si se proporcionan
        if (image_urls && image_urls.length > 0) {
          await prisma.product_images.createMany({
            data: image_urls.map((url, index) => ({
              product_id: product.id,
              image_url: url,
              is_main: index === 0, // Primera imagen como principal
            })),
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
                user_id: 1, // Use default user ID as fallback
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
              user_id: 1, // Use default user ID as fallback
              create_movement: true,
              validate_availability: false,
            },
            prisma,
          );
        }

        // Inicializar stock levels para todas las ubicaciones de la organización
        // Obtenemos el organization_id del contexto
        const context = RequestContextService.getContext();
        if (context?.organization_id) {
          await this.stockLevelManager.initializeStockLevelsForProduct(
            product.id,
            context.organization_id,
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
        return {
          ...completeProduct,
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
      });
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
      category_id,
      brand_id,
      include_inactive,
      pos_optimized,
      barcode,
      include_stock,
      include_variants,
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
          ...(include_variants && {
            product_variants: {
              include: {
                product_images: true,
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

    // Para POS optimizado, retornar productos directamente sin cálculos complejos
    if (pos_optimized) {
      return {
        data: products,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Calcular stock totals dinámicamente para cada producto
    const productsWithStock = products.map((product) => {
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

      return {
        ...product,
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
      };
    });

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

    // Retornar producto con información de stock enriquecida
    return {
      ...product,
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

    return product;
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
            store_id: existingProduct.store_id,
            slug: updateProductDto.slug,
            state: { not: ProductState.ARCHIVED },
            NOT: { id },
          },
        });

        if (existingSlug) {
          throw new ConflictException('El slug ya está en uso en esta tienda');
        }
      }

      // Si se actualiza el SKU, verificar que sea único
      if (updateProductDto.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: {
            sku: updateProductDto.sku,
            state: { not: ProductState.ARCHIVED },
            NOT: { id },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      const {
        category_ids,
        tax_category_ids,
        image_urls,
        stock_quantity,
        stock_by_location,
        ...productData
      } = updateProductDto;

      const result = await this.prisma.$transaction(async (prisma) => {
        // Actualizar producto
        const product = await prisma.products.update({
          where: { id },
          data: {
            ...productData,
            updated_at: new Date(),
          },
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
        if (image_urls !== undefined) {
          await prisma.product_images.deleteMany({
            where: { product_id: id },
          });

          if (image_urls.length > 0) {
            await prisma.product_images.createMany({
              data: image_urls.map((url, index) => ({
                product_id: id,
                image_url: url,
                is_main: index === 0,
              })),
            });
          }
        }

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

            const currentQuantity = currentStockLevel?.quantity_available || 0;
            const quantityChange = stockLocation.quantity - currentQuantity;

            if (quantityChange !== 0) {
              await this.stockLevelManager.updateStock(
                {
                  product_id: id,
                  location_id: stockLocation.location_id,
                  quantity_change: quantityChange,
                  movement_type: 'adjustment',
                  reason: `Stock adjusted from product edit${stockLocation.notes ? ': ' + stockLocation.notes : ''}`,
                  user_id: 1, // Use default user ID as fallback
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
                user_id: 1, // Use default user ID as fallback
                create_movement: true,
                validate_availability: false,
              },
              prisma,
            );
          }
        }

        return product;
      });

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

    // Calcular stock totals dinámicamente
    return products.map((product) => {
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
    });
  }

  // Gestión de variantes
  async createVariant(
    product_id: number,
    createVariantDto: CreateProductVariantDto,
  ) {
    try {
      // Verificar que el producto existe y está activo
      const product = await this.prisma.products.findFirst({
        where: {
          id: product_id,
          state: ProductState.ACTIVE,
        },
      });

      if (!product) {
        throw new BadRequestException('Producto no encontrado o inactivo');
      }

      // Verificar que el SKU sea único
      const existingSku = await this.prisma.product_variants.findUnique({
        where: { sku: createVariantDto.sku },
      });

      if (existingSku) {
        throw new ConflictException('El SKU de la variante ya está en uso');
      }

      return await this.prisma.$transaction(async (prisma) => {
        // Crear variante usando scoped client
        const variant = await prisma.product_variants.create({
          data: {
            product_id: product.id, // Se infiere del contexto
            sku: createVariantDto.sku,
            name: createVariantDto.name,
            price_override:
              createVariantDto.price_override || createVariantDto.price,
            stock_quantity: 0, // Se inicializará via stock_levels
            created_at: new Date(),
            updated_at: new Date(),
          },
        });

        // Inicializar stock levels para la variante si se proporciona stock
        if (
          createVariantDto.stock_quantity &&
          createVariantDto.stock_quantity > 0
        ) {
          const defaultLocation =
            await this.inventoryLocationsService.getDefaultLocation(
              product.store_id,
            );

          await this.stockLevelManager.updateStock(
            {
              product_id: product.id,
              variant_id: variant.id,
              location_id: defaultLocation.id,
              quantity_change: createVariantDto.stock_quantity || 0,
              movement_type: 'initial',
              reason: 'Initial stock on variant creation',
              user_id: 1, // Use default user ID as fallback
              create_movement: true,
              validate_availability: false,
            },
            prisma,
          );
        }

        return variant;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El SKU de la variante ya existe');
        }
      }
      throw error;
    }
  }

  async updateVariant(
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
  ) {
    try {
      const existingVariant = await this.prisma.product_variants.findUnique({
        where: { id: variantId },
        include: {
          products: {
            select: {
              id: true,
              store_id: true,
            },
          },
        },
      });

      if (!existingVariant) {
        throw new NotFoundException('Variante no encontrada');
      }

      if (updateVariantDto.sku) {
        const existingSku = await this.prisma.product_variants.findFirst({
          where: {
            sku: updateVariantDto.sku,
            NOT: { id: variantId },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      const { stock_quantity, ...variantData } = updateVariantDto;

      return await this.prisma.$transaction(async (prisma) => {
        // Actualizar variante
        const variant = await prisma.product_variants.update({
          where: { id: variantId },
          data: {
            ...variantData,
            updated_at: new Date(),
          },
        });

        // Si cambió el stock, actualizar stock levels
        if (stock_quantity !== undefined) {
          const stockDifference =
            stock_quantity - existingVariant.stock_quantity;

          if (stockDifference !== 0) {
            const defaultLocation =
              await this.inventoryLocationsService.getDefaultLocation(
                existingVariant.products.store_id,
              );

            await this.stockLevelManager.updateStock(
              {
                product_id: existingVariant.product_id,
                variant_id: variantId,
                location_id: defaultLocation.id,
                quantity_change: stockDifference,
                movement_type: 'adjustment',
                reason: 'Stock quantity updated from variant edit',
                user_id: 1, // Use default user ID as fallback
                create_movement: true,
                validate_availability: false,
              },
              prisma,
            );
          }
        }

        return variant;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Conflicto de datos únicos');
        }
      }
      throw error;
    }
  }

  async removeVariant(variantId: number) {
    const existingVariant = await this.prisma.product_variants.findUnique({
      where: { id: variantId },
    });

    if (!existingVariant) {
      throw new NotFoundException('Variante no encontrada');
    }

    return await this.prisma.$transaction(async (prisma) => {
      // Verificar que no haya stock en ninguna ubicación
      const stockLevels = await prisma.stock_levels.findMany({
        where: {
          product_id: existingVariant.product_id,
          product_variant_id: variantId,
        },
      });

      const hasStock = stockLevels.some(
        (sl) => sl.quantity_on_hand > 0 || sl.quantity_reserved > 0,
      );

      if (hasStock) {
        throw new BadRequestException(
          'Cannot delete variant with existing stock',
        );
      }

      // Eliminación lógica: archivar variante (si tuviera estado)
      // Por ahora, eliminamos físicamente las variantes ya que no tienen estado
      return await prisma.product_variants.delete({
        where: { id: variantId },
      });
    });
  }

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

    // Las imágenes no tienen estado, pero podríamos agregar un campo deleted_at
    // Por ahora, eliminamos físicamente
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
}

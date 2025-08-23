import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto, ProductQueryDto, CreateProductVariantDto, UpdateProductVariantDto, ProductImageDto, ProductState } from './dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from '../../common/utils/slug.util';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto) {
    try {
      // Verificar que la tienda existe y está activa
      const store = await this.prisma.stores.findFirst({
        where: { 
          id: createProductDto.store_id,
          is_active: true 
        }
      });

      if (!store) {
        throw new BadRequestException('Tienda no encontrada o inactiva');
      }

      // Generar slug si no se proporciona
      const slug = createProductDto.slug || generateSlug(createProductDto.name);

      // Verificar que el slug sea único dentro de la tienda
      const existingProduct = await this.prisma.products.findFirst({
        where: {
          store_id: createProductDto.store_id,
          slug: slug,
          state: { not: ProductState.ARCHIVED }
        }
      });

      if (existingProduct) {
        throw new ConflictException('El slug del producto ya existe en esta tienda');
      }

      // Verificar que el SKU sea único si se proporciona
      if (createProductDto.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: { 
            sku: createProductDto.sku,
            state: { not: ProductState.ARCHIVED }
          }
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      const { category_ids, tax_category_ids, image_urls, ...productData } = createProductDto;

      const result = await this.prisma.$transaction(async (prisma) => {
        // Crear producto
        const product = await prisma.products.create({
          data: {
            ...productData,
            slug: slug,
            updated_at: new Date(),
          }
        });

        // Asignar categorías si se proporcionan
        if (category_ids && category_ids.length > 0) {
          await prisma.product_categories.createMany({
            data: category_ids.map(categoryId => ({
              product_id: product.id,
              category_id: categoryId,
            }))
          });
        }

        // Asignar categorías de impuestos si se proporcionan
        if (tax_category_ids && tax_category_ids.length > 0) {
          await prisma.product_tax_assignments.createMany({
            data: tax_category_ids.map(taxCategoryId => ({
              product_id: product.id,
              tax_category_id: taxCategoryId,
            }))
          });
        }

        // Crear imágenes si se proporcionan
        if (image_urls && image_urls.length > 0) {
          await prisma.product_images.createMany({
            data: image_urls.map((url, index) => ({
              product_id: product.id,
              image_url: url,
              is_main: index === 0, // Primera imagen como principal
            }))
          });
        }

        return product;
      });

      return await this.findOne(result.id);
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
    const { page = 1, limit = 10, search, state, store_id, category_id, brand_id, include_inactive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.productsWhereInput = {
      // Solo productos activos por defecto (borrado lógico)
      state: include_inactive ? undefined : ProductState.ACTIVE,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ]
      }),
      ...(state && { state }),
      ...(store_id && { store_id }),
      ...(brand_id && { brand_id }),
      ...(category_id && {
        product_categories: {
          some: { category_id }
        }
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
            }
          },
          brands: {
            select: {
              id: true,
              name: true,
            }
          },
          product_categories: {
            include: {
              categories: {
                select: {
                  id: true,
                  name: true,
                }
              }
            }
          },
          product_images: {
            where: { is_main: true },
            take: 1,
          },
          _count: {
            select: {
              product_variants: true,
              product_images: true,
              reviews: true,
            }
          }
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.products.count({ where }),
    ]);

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const product = await this.prisma.products.findFirst({
      where: { 
        id,
        state: { not: ProductState.ARCHIVED } // No mostrar productos archivados
      },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization_id: true,
          }
        },
        brands: true,
        product_categories: {
          include: {
            categories: true,
          }
        },
        product_tax_assignments: {
          include: {
            tax_categories: true,
          }
        },
        product_images: {
          orderBy: { is_main: 'desc' },
        },
        product_variants: {
          include: {
            product_images: true,
          }
        },
        reviews: {
          where: { state: 'approved' },
          include: {
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            product_variants: true,
            product_images: true,
            reviews: true,
          }
        }
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }

  async findBySlug(storeId: number, slug: string) {
    const product = await this.prisma.products.findFirst({
      where: { 
        store_id: storeId,
        slug,
        state: ProductState.ACTIVE // Solo productos activos
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
          state: { not: ProductState.ARCHIVED }
        }
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
          }
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
          }
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      const { category_ids, tax_category_ids, image_urls, ...productData } = updateProductDto;

      const result = await this.prisma.$transaction(async (prisma) => {
        // Actualizar producto
        const product = await prisma.products.update({
          where: { id },
          data: {
            ...productData,
            updated_at: new Date(),
          }
        });

        // Actualizar categorías si se proporcionan
        if (category_ids !== undefined) {
          await prisma.product_categories.deleteMany({
            where: { product_id: id }
          });

          if (category_ids.length > 0) {
            await prisma.product_categories.createMany({
              data: category_ids.map(categoryId => ({
                product_id: id,
                category_id: categoryId,
              }))
            });
          }
        }

        // Actualizar categorías de impuestos si se proporcionan
        if (tax_category_ids !== undefined) {
          await prisma.product_tax_assignments.deleteMany({
            where: { product_id: id }
          });

          if (tax_category_ids.length > 0) {
            await prisma.product_tax_assignments.createMany({
              data: tax_category_ids.map(taxCategoryId => ({
                product_id: id,
                tax_category_id: taxCategoryId,
              }))
            });
          }
        }

        // Actualizar imágenes si se proporcionan
        if (image_urls !== undefined) {
          await prisma.product_images.deleteMany({
            where: { product_id: id }
          });

          if (image_urls.length > 0) {
            await prisma.product_images.createMany({
              data: image_urls.map((url, index) => ({
                product_id: id,
                image_url: url,
                is_main: index === 0,
              }))
            });
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
        state: { not: ProductState.ARCHIVED }
      }
    });

    if (!existingProduct) {
      throw new NotFoundException('Producto no encontrado');
    }

    return await this.prisma.products.update({
      where: { id },
      data: {
        state: ProductState.INACTIVE,
        updated_at: new Date(),
      }
    });
  }

  // Borrado físico solo para roles superiores
  async remove(id: number) {
    try {
      // Verificar que el producto existe
      await this.findOne(id);

      // Verificar si tiene órdenes relacionadas
      const relatedOrders = await this.prisma.order_items.count({
        where: { product_id: id }
      });

      if (relatedOrders > 0) {
        throw new BadRequestException(
          'No se puede eliminar el producto porque tiene órdenes relacionadas. Use borrado lógico.'
        );
      }

      return await this.prisma.products.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'No se puede eliminar el producto porque tiene datos relacionados'
          );
        }
      }
      throw error;
    }
  }

  // Obtener productos por tienda (solo activos)
  async getProductsByStore(storeId: number) {
    return await this.prisma.products.findMany({
      where: { 
        store_id: storeId,
        state: ProductState.ACTIVE
      },
      include: {
        brands: true,
        product_images: {
          where: { is_main: true },
          take: 1,
        },
        _count: {
          select: {
            product_variants: true,
            reviews: true,
          }
        }
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // Gestión de variantes
  async createVariant(createVariantDto: CreateProductVariantDto) {
    try {
      // Verificar que el producto existe y está activo
      const product = await this.prisma.products.findFirst({
        where: { 
          id: createVariantDto.product_id,
          state: ProductState.ACTIVE
        }
      });

      if (!product) {
        throw new BadRequestException('Producto no encontrado o inactivo');
      }

      // Verificar que el SKU sea único
      const existingSku = await this.prisma.product_variants.findUnique({
        where: { sku: createVariantDto.sku }
      });

      if (existingSku) {
        throw new ConflictException('El SKU de la variante ya está en uso');
      }

      return await this.prisma.product_variants.create({
        data: {
          ...createVariantDto,
          updated_at: new Date(),
        },
        include: {
          products: true,
          product_images: true,
        }
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

  async updateVariant(variantId: number, updateVariantDto: UpdateProductVariantDto) {
    try {
      const existingVariant = await this.prisma.product_variants.findUnique({
        where: { id: variantId }
      });

      if (!existingVariant) {
        throw new NotFoundException('Variante no encontrada');
      }

      if (updateVariantDto.sku) {
        const existingSku = await this.prisma.product_variants.findFirst({
          where: {
            sku: updateVariantDto.sku,
            NOT: { id: variantId },
          }
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      return await this.prisma.product_variants.update({
        where: { id: variantId },
        data: {
          ...updateVariantDto,
          updated_at: new Date(),
        },
        include: {
          products: true,
          product_images: true,
        }
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
      where: { id: variantId }
    });

    if (!existingVariant) {
      throw new NotFoundException('Variante no encontrada');
    }

    return await this.prisma.product_variants.delete({
      where: { id: variantId }
    });
  }

  // Gestión de imágenes
  async addImage(productId: number, imageDto: ProductImageDto) {
    // Verificar que el producto existe y está activo
    const product = await this.prisma.products.findFirst({
      where: { 
        id: productId,
        state: ProductState.ACTIVE
      }
    });

    if (!product) {
      throw new BadRequestException('Producto no encontrado o inactivo');
    }

    // Si es imagen principal, quitar el flag de las demás
    if (imageDto.is_main) {
      await this.prisma.product_images.updateMany({
        where: { product_id: productId },
        data: { is_main: false }
      });
    }

    return await this.prisma.product_images.create({
      data: {
        product_id: productId,
        ...imageDto,
      }
    });
  }

  async removeImage(imageId: number) {
    const existingImage = await this.prisma.product_images.findUnique({
      where: { id: imageId }
    });

    if (!existingImage) {
      throw new NotFoundException('Imagen no encontrada');
    }

    return await this.prisma.product_images.delete({
      where: { id: imageId }
    });
  }
}

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditAction, AuditResource } from '../audit';
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
import { generateSlug } from '../../common/utils/slug.util';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService, // ✅ Inyección del servicio de auditoría
  ) {}

  async create(createProductDto: CreateProductDto, userId: number) {
    try {
      // Verificar que la tienda existe y está activa
      const store = await this.prisma.stores.findFirst({
        where: {
          id: createProductDto.store_id,
          is_active: true,
        },
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
            sku: createProductDto.sku,
            state: { not: ProductState.ARCHIVED },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      const { category_ids, tax_category_ids, image_urls, ...productData } =
        createProductDto;

      const result = await this.prisma.$transaction(async (prisma) => {
        // Crear producto
        const product = await prisma.products.create({
          data: {
            ...productData,
            slug: slug,
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
          await prisma.product_tax_assignments.createMany({
            data: tax_category_ids.map((taxCategoryId) => ({
              product_id: product.id,
              tax_category_id: taxCategoryId,
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

        return product;
      });

      // ✅ Registrar auditoría - Creación de producto
      await this.auditService.logCreate(
        userId,
        AuditResource.PRODUCTS,
        result.id,
        {
          name: result.name,
          sku: result.sku,
          store_id: result.store_id,
          base_price: result.base_price,
          category_ids,
          tax_category_ids,
          image_count: image_urls?.length || 0,
        }
      );

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

  async update(id: number, updateProductDto: UpdateProductDto, userId: number) {
    try {
      // ✅ Obtener valores anteriores para auditoría
      const existingProduct = await this.prisma.products.findUnique({
        where: { id },
        include: {
          product_categories: {
            include: { categories: true }
          },
          product_tax_assignments: {
            include: { tax_categories: true }
          },
          product_images: true,
        }
      });

      if (!existingProduct) {
        throw new NotFoundException('Producto no encontrado');
      }

      // Generar nuevo slug si el nombre cambió
      const slug = updateProductDto.slug ||
        (updateProductDto.name ? generateSlug(updateProductDto.name) : existingProduct.slug);

      // Verificar unicidad del slug si cambió
      if (slug !== existingProduct.slug) {
        const existingSlug = await this.prisma.products.findFirst({
          where: {
            store_id: existingProduct.store_id,
            slug: slug,
            state: { not: ProductState.ARCHIVED },
            id: { not: id },
          },
        });

        if (existingSlug) {
          throw new ConflictException(
            'El slug del producto ya existe en esta tienda',
          );
        }
      }

      // Verificar unicidad del SKU si cambió
      if (updateProductDto.sku && updateProductDto.sku !== existingProduct.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: {
            sku: updateProductDto.sku,
            state: { not: ProductState.ARCHIVED },
            id: { not: id },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      const { category_ids, tax_category_ids, image_urls, ...productData } =
        updateProductDto;

      const result = await this.prisma.$transaction(async (prisma) => {
        // Actualizar producto
        const product = await prisma.products.update({
          where: { id },
          data: {
            ...productData,
            slug: slug,
            updated_at: new Date(),
          },
        });

        // Actualizar categorías si se proporcionan
        if (category_ids !== undefined) {
          // Eliminar categorías existentes
          await prisma.product_categories.deleteMany({
            where: { product_id: id },
          });

          // Crear nuevas categorías
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
          // Eliminar asignaciones existentes
          await prisma.product_tax_assignments.deleteMany({
            where: { product_id: id },
          });

          // Crear nuevas asignaciones
          if (tax_category_ids.length > 0) {
            await prisma.product_tax_assignments.createMany({
              data: tax_category_ids.map((taxCategoryId) => ({
                product_id: id,
                tax_category_id: taxCategoryId,
              })),
            });
          }
        }

        // Actualizar imágenes si se proporcionan
        if (image_urls !== undefined) {
          // Eliminar imágenes existentes
          await prisma.product_images.deleteMany({
            where: { product_id: id },
          });

          // Crear nuevas imágenes
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

        return product;
      });

      // ✅ Registrar auditoría - Actualización de producto
      const updatedProduct = await this.findOne(result.id);
      await this.auditService.logUpdate(
        userId,
        AuditResource.PRODUCTS,
        id,
        {
          name: existingProduct.name,
          sku: existingProduct.sku,
          base_price: existingProduct.base_price,
          category_ids: existingProduct.product_categories.map(pc => pc.category_id),
          tax_category_ids: existingProduct.product_tax_assignments.map(pta => pta.tax_category_id),
          image_count: existingProduct.product_images.length,
        },
        {
          name: updatedProduct.name,
          sku: updatedProduct.sku,
          base_price: updatedProduct.base_price,
          category_ids,
          tax_category_ids,
          image_count: image_urls?.length || 0,
        },
        {
          updated_fields: Object.keys(updateProductDto),
          store_id: existingProduct.store_id,
        }
      );

      return updatedProduct;
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

  async remove(id: number, userId: number) {
    try {
      // ✅ Obtener producto antes de eliminar para auditoría
      const product = await this.prisma.products.findUnique({
        where: { id },
        include: {
          product_categories: {
            include: { categories: true }
          },
          product_tax_assignments: {
            include: { tax_categories: true }
          },
          product_images: true,
        }
      });

      if (!product) {
        throw new NotFoundException('Producto no encontrado');
      }

      // Marcar como archivado (borrado lógico)
      const result = await this.prisma.products.update({
        where: { id },
        data: {
          state: ProductState.ARCHIVED,
          updated_at: new Date(),
        },
      });

      // ✅ Registrar auditoría - Eliminación de producto
      await this.auditService.logDelete(
        userId,
        AuditResource.PRODUCTS,
        id,
        {
          name: product.name,
          sku: product.sku,
          store_id: product.store_id,
          base_price: product.base_price,
          category_ids: product.product_categories.map(pc => pc.category_id),
          tax_category_ids: product.product_tax_assignments.map(pta => pta.tax_category_id),
          image_count: product.product_images.length,
        },
        { reason: 'archived_by_user' }
      );

      return result;
    } catch (error) {
      throw error;
    }
  }

  // ... resto de métodos sin cambios para este ejemplo

  async findOne(id: number) {
    const product = await this.prisma.products.findUnique({
      where: { id },
      include: {
        stores: true,
        brands: true,
        product_images: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }
}

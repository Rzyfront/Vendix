import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductState,
} from '../dto';
import { RequestContextService } from '@common/context/request-context.service';
import { Prisma } from '@prisma/client';
import { LocationsService } from '../../inventory/locations/locations.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { S3Service } from '@common/services/s3.service';

@Injectable()
export class ProductVariantService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly s3Service: S3Service,
  ) {}

  async findUniqueVariantBySlug(storeId: number, slug: string) {
    const variant = await this.prisma.product_variants.findFirst({
      where: {
        products: {
          store_id: storeId,
          slug: slug,
          state: 'active',
        },
      },
      include: {
        products: {
          include: {
            stores: true,
            brands: true,
            product_images: true,
            product_categories: {
              include: {
                categories: true,
              },
            },
          },
        },
        product_images: true,
      },
    });

    if (!variant) {
      throw new NotFoundException('Variante de producto no encontrada');
    }

    return variant;
  }
  async createVariant(
    product_id: number,
    createVariantDto: CreateProductVariantDto,
    tx?: Prisma.TransactionClient,
  ) {
    const context = RequestContextService.getContext();
    try {
      // Verify user context for audit
      const user_id = context?.user_id;
      if (
        !user_id &&
        createVariantDto.stock_quantity &&
        createVariantDto.stock_quantity > 0
      ) {
        throw new ForbiddenException(
          'User context required for stock operations',
        );
      }

      // Verificar que el producto existe y está activo
      const prisma = tx || this.prisma;
      const product = await prisma.products.findFirst({
        where: {
          id: product_id,
          state: ProductState.ACTIVE,
        },
      });

      if (!product) {
        throw new BadRequestException('Producto no encontrado o inactivo');
      }

      // Verificar que el SKU sea único dentro del producto (skip para SKU vacío)
      if (createVariantDto.sku && createVariantDto.sku.trim() !== '') {
        const existingSku = await prisma.product_variants.findFirst({
          where: {
            sku: createVariantDto.sku,
            product_id: product_id,
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU de la variante ya está en uso');
        }
      }

      if (tx) {
        return this.executeCreateVariant(
          tx,
          product,
          createVariantDto,
          user_id,
        );
      }

      return await this.prisma.$transaction(async (p) => {
        return this.executeCreateVariant(p, product, createVariantDto, user_id);
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

  private async executeCreateVariant(
    prisma: Prisma.TransactionClient,
    product: any,
    createVariantDto: CreateProductVariantDto,
    user_id?: number,
  ) {
    // Crear variante usando scoped client
    const variant = await prisma.product_variants.create({
      data: {
        product_id: product.id,
        sku: createVariantDto.sku,
        name: createVariantDto.name,
        attributes: createVariantDto.attributes,
        price_override:
          createVariantDto.price_override || createVariantDto.price,
        cost_price: createVariantDto.cost_price,
        profit_margin: createVariantDto.profit_margin,
        is_on_sale: createVariantDto.is_on_sale,
        sale_price: createVariantDto.sale_price,
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
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
          user_id: user_id!, // Non-null assertion safe because we checked above
          create_movement: true,
          validate_availability: false,
        },
        prisma,
      );
    }

    return variant;
  }

  async updateVariant(
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
    tx?: Prisma.TransactionClient,
  ) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id && updateVariantDto.stock_quantity !== undefined) {
      throw new ForbiddenException(
        'User context required for stock operations',
      );
    }

    try {
      const prisma = tx || this.prisma;
      const existingVariant = await prisma.product_variants.findUnique({
        where: { id: variantId },
        include: {
          products: true,
        },
      });

      if (!existingVariant) {
        throw new NotFoundException('Variante no encontrada');
      }

      if (updateVariantDto.sku && updateVariantDto.sku.trim() !== '') {
        const existingSku = await prisma.product_variants.findFirst({
          where: {
            sku: updateVariantDto.sku,
            product_id: existingVariant.product_id,
            NOT: { id: variantId },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      if (tx) {
        return this.executeUpdateVariant(
          tx,
          variantId,
          updateVariantDto,
          existingVariant,
          user_id,
        );
      }

      return await this.prisma.$transaction(async (p) => {
        return this.executeUpdateVariant(
          p,
          variantId,
          updateVariantDto,
          existingVariant,
          user_id,
        );
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

  private async executeUpdateVariant(
    prisma: Prisma.TransactionClient,
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
    existingVariant: any,
    user_id?: number,
  ) {
    const { stock_quantity, attributes, ...variantData } = updateVariantDto;

    // Actualizar variante
    const variant = await prisma.product_variants.update({
      where: { id: variantId },
      data: {
        ...variantData,
        price_override: variantData.price_override || updateVariantDto.price,
        attributes: attributes !== undefined ? attributes : undefined,
        updated_at: new Date(),
      } as any,
    });

    // Si cambió el stock, actualizar stock levels
    if (stock_quantity !== undefined) {
      const stockDifference = stock_quantity - existingVariant.stock_quantity;

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
            user_id: user_id!, // Non-null assertion safe because we checked above
            create_movement: true,
            validate_availability: false,
          },
          prisma,
        );
      }
    }

    return variant;
  }

  async removeVariant(variantId: number) {
    const existingVariant = await this.prisma.product_variants.findUnique({
      where: { id: variantId },
      include: { product_images: { select: { image_url: true } } },
    });

    if (!existingVariant) {
      throw new NotFoundException('Variante no encontrada');
    }

    // Use withoutScope() to bypass tenant scoping — FK cleanup needs
    // unrestricted access to cross-domain tables like inventory_transactions.
    const unscopedPrisma = this.prisma.withoutScope() as any;

    return await unscopedPrisma.$transaction(async (prisma: any) => {
      // Limpiar FK constraints que bloquean la eliminación
      await prisma.order_items.updateMany({
        where: { product_variant_id: variantId },
        data: { product_variant_id: null },
      });
      await prisma.inventory_adjustments.updateMany({
        where: { product_variant_id: variantId },
        data: { product_variant_id: null },
      });
      await prisma.inventory_transactions.updateMany({
        where: { product_variant_id: variantId },
        data: { product_variant_id: null },
      });
      await prisma.stock_levels.deleteMany({
        where: { product_variant_id: variantId },
      });

      // Limpiar imagen de variante (DB + S3)
      if (existingVariant.image_id) {
        if (existingVariant.product_images?.image_url) {
          const key = existingVariant.product_images.image_url;
          const parts = key.split('/');
          const fileName = parts.pop();
          const thumbKey = [...parts, `thumb_${fileName}`].join('/');
          this.s3Service.deleteFile(key).catch(() => {});
          this.s3Service.deleteFile(thumbKey).catch(() => {});
        }

        await prisma.product_variants.update({
          where: { id: variantId },
          data: { image_id: null },
        });
        await prisma.product_images.delete({
          where: { id: existingVariant.image_id },
        }).catch(() => {});
      }

      return await prisma.product_variants.delete({
        where: { id: variantId },
      });
    });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ProductVariantService {
  constructor(private readonly prisma: PrismaService) {}

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
}

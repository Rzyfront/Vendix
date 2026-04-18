import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import { S3Service } from '@common/services/s3.service';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class BrandsService {
  constructor(
    private prisma: StorePrismaService,
    private s3Service: S3Service,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async create(createBrandDto: CreateBrandDto, user: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    try {
      const sanitizedLogoUrl = extractS3KeyFromUrl(createBrandDto.logo_url);
      const slug = this.generateSlug(createBrandDto.name);

      const brand = await this.prisma.brands.create({
        data: {
          name: createBrandDto.name,
          slug,
          description: createBrandDto.description,
          logo_url: sanitizedLogoUrl,
          store_id,
        },
      });

      return {
        ...brand,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
      };
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Brand name already exists in this store');
      }
      throw error;
    }
  }

  async findAll(query: BrandQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [brands, total] = await Promise.all([
      this.prisma.brands.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.brands.count({ where }),
    ]);

    const signedBrands = await Promise.all(
      brands.map(async (brand) => ({
        ...brand,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
      })),
    );

    return {
      data: signedBrands,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findByStore(storeId: number, query: BrandQueryDto) {
    // Scope is applied automatically by StorePrismaService
    return this.findAll(query);
  }

  async findOne(id: number, options?: { includeInactive?: boolean }) {
    const brand = await this.prisma.brands.findFirst({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!brand) {
      throw new VendixHttpException(ErrorCodes.BRAND_FIND_001);
    }

    return {
      ...brand,
      logo_url: await this.s3Service.signUrl(brand.logo_url),
    };
  }

  async update(id: number, updateBrandDto: UpdateBrandDto, user: any) {
    const brand = await this.findOne(id);

    const updateData: any = {};

    if (updateBrandDto.name) {
      updateData.name = updateBrandDto.name;
      updateData.slug = this.generateSlug(updateBrandDto.name);
    }

    if (updateBrandDto.description !== undefined) {
      updateData.description = updateBrandDto.description;
    }

    if (updateBrandDto.logo_url !== undefined) {
      updateData.logo_url = extractS3KeyFromUrl(updateBrandDto.logo_url);
    }

    try {
      const updated = await this.prisma.brands.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: { products: true },
          },
        },
      });

      return {
        ...updated,
        logo_url: await this.s3Service.signUrl(updated.logo_url),
      };
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Brand name already exists in this store');
      }
      throw error;
    }
  }

  async remove(id: number, user: any) {
    const brand = await this.findOne(id);

    const productCount = await this.prisma.products.count({
      where: { brand_id: id },
    });

    if (productCount > 0) {
      throw new BadRequestException(
        'Cannot delete brand with assigned products',
      );
    }

    await this.prisma.brands.update({
      where: { id },
      data: {
        state: 'archived',
        updated_at: new Date(),
      },
    });
  }

  private async validateUniqueName(name: string, excludeId?: number) {
    const where: any = { name };
    if (excludeId) {
      where.id = { not: excludeId };
    }

    const existing = await this.prisma.brands.findFirst({ where });
    if (existing) {
      throw new ConflictException('Brand name already exists in this store');
    }
  }
}

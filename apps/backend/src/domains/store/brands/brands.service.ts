import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import { S3Service } from '@common/services/s3.service';
import { ImageContext } from '@common/config/image-presets';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class BrandsService {
  constructor(
    private prisma: StorePrismaService,
    private s3Service: S3Service,
    private s3PathHelper: S3PathHelper,
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
      const slug = createBrandDto.slug?.trim()
        ? this.generateSlug(createBrandDto.slug)
        : this.generateSlug(createBrandDto.name);

      const brandData: any = {
        name: createBrandDto.name,
        slug,
        description: createBrandDto.description,
        logo_url: sanitizedLogoUrl,
        store_id,
        state: createBrandDto.state ?? 'active',
      };

      if (createBrandDto.is_featured !== undefined) {
        brandData.is_featured = createBrandDto.is_featured;
      }

      const brand = await this.prisma.brands.create({
        data: brandData,
      });

      return {
        ...brand,
        logo_url: await this.s3Service.signUrl(brand.logo_url),
      };
    } catch (error) {
      if (error instanceof VendixHttpException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.BRAND_NAME_EXISTS_001);
      }
      throw error;
    }
  }

  async findAll(query: BrandQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      state,
      is_featured,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (state) where.state = state;
    else where.state = { not: 'archived' }; // Excluir archivados por defecto

    if (is_featured !== undefined) {
      where.is_featured = is_featured;
    }

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

    if (updateBrandDto.slug !== undefined && updateBrandDto.slug.trim()) {
      updateData.slug = this.generateSlug(updateBrandDto.slug);
    }

    if (updateBrandDto.description !== undefined) {
      updateData.description = updateBrandDto.description;
    }

    if (updateBrandDto.logo_url !== undefined) {
      updateData.logo_url = extractS3KeyFromUrl(updateBrandDto.logo_url);
    }

    if (updateBrandDto.state !== undefined) {
      updateData.state = updateBrandDto.state;
    }

    if (updateBrandDto.is_featured !== undefined) {
      updateData.is_featured = updateBrandDto.is_featured;
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
      if (error instanceof VendixHttpException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.BRAND_NAME_EXISTS_001);
      }
      throw error;
    }
  }

  async remove(id: number, user: any, options: { force?: boolean } = {}) {
    const brand = await this.findOne(id);

    const productCount = await this.prisma.products.count({
      where: { brand_id: id },
    });

    if (productCount > 0 && !options.force) {
      throw new VendixHttpException(
        ErrorCodes.BRAND_DELETE_HAS_PRODUCTS,
        undefined,
        { product_count: productCount },
      );
    }

    if (productCount > 0 && options.force) {
      await this.prisma.products.updateMany({
        where: { brand_id: id },
        data: { brand_id: null },
      });
    }

    await this.prisma.brands.update({
      where: { id },
      data: {
        state: 'archived',
        updated_at: new Date(),
      },
    });
  }

  async uploadBrandLogo(file: Buffer, filename: string) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: { id: true, slug: true },
        },
      },
    });

    if (!store || !store.organizations) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const timestamp = Date.now();
    const cleanFilename = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const basePath = this.s3PathHelper.buildBrandPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/${timestamp}-${cleanFilename}`;

    try {
      const result = await this.s3Service.uploadImage(file, key, {
        generateThumbnail: true,
        context: ImageContext.LOGO,
      });
      const signedUrl = await this.s3Service.getPresignedUrl(result.key);

      return {
        key: result.key,
        url: signedUrl,
        thumbKey: result.thumbKey,
      };
    } catch (error) {
      if (error instanceof VendixHttpException) {
        throw error;
      }
      throw new VendixHttpException(ErrorCodes.MEDIA_UPLOAD_FAILED_001);
    }
  }

  private async validateUniqueName(name: string, excludeId?: number) {
    const where: any = { name };
    if (excludeId) {
      where.id = { not: excludeId };
    }

    const existing = await this.prisma.brands.findFirst({ where });
    if (existing) {
      throw new VendixHttpException(ErrorCodes.BRAND_NAME_EXISTS_001);
    }
  }
}

import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  AssignProductToCategoryDto,
} from './dto';
import slugify from 'slugify';
import { S3Service } from '@common/services/s3.service';
import { ImageContext } from '@common/config/image-presets';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: StorePrismaService,
    private accessValidation: AccessValidationService,
    private s3Service: S3Service,
    private s3PathHelper: S3PathHelper,
  ) {}

  async create(createCategoryDto: CreateCategoryDto, user: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const slug = slugify(createCategoryDto.name, { lower: true, strict: true });

    // Ensure slug is unique in this store context
    await this.validateUniqueSlug(slug, store_id);

    // CRITICAL: Sanitize image_url to extract S3 key before storing
    // This prevents storing signed URLs that expire after 24 hours
    const sanitizedImageUrl = extractS3KeyFromUrl(createCategoryDto.image_url);

    const categoryData: any = {
      name: createCategoryDto.name,
      slug: slug,
      description: createCategoryDto.description,
      store_id: store_id, // Manual injection required for create
      image_url: sanitizedImageUrl,
      state: 'active',
    };

    if (createCategoryDto.is_featured !== undefined) {
      categoryData.is_featured = createCategoryDto.is_featured;
    }

    let category;
    try {
      category = await this.prisma.categories.create({
        data: categoryData,
        include: { stores: true },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.CAT_NAME_EXISTS_001);
      }
      throw error;
    }

    return {
      ...category,
      image_url: await this.s3Service.signUrl(category.image_url),
    };
  }

  async findAll(query: CategoryQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'name',
      sort_order = 'asc',
      state,
      is_featured,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (state) where.state = state;
    else where.state = { not: 'archived' }; // Excluir archivados por defecto

    if (is_featured !== undefined) {
      where.is_featured = is_featured;
    }

    if (search)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];

    // ✅ BYPASS MANUAL ELIMINADO - ahora usa scoping automático de PrismaService
    // El filtro store_id se aplica automáticamente según el contexto del usuario
    // Los usuarios solo pueden ver categorías de su store actual

    const [categories, total] = await Promise.all([
      this.prisma.categories.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: { stores: true },
      }),
      this.prisma.categories.count({ where }),
    ]);

    const signedCategories = await Promise.all(
      categories.map(async (category) => ({
        ...category,
        image_url: await this.s3Service.signUrl(category.image_url, true),
      })),
    );

    return {
      data: signedCategories,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, options: { includeInactive?: boolean } = {}) {
    const where: any = { id };
    if (!options.includeInactive) where.state = 'active';

    const category = await this.prisma.categories.findFirst({
      where,
      include: { stores: true },
    });
    if (!category) throw new VendixHttpException(ErrorCodes.CAT_FIND_001);

    return {
      ...category,
      image_url: await this.s3Service.signUrl(category.image_url),
    };
  }

  async update(id: number, updateCategoryDto: UpdateCategoryDto, user: any) {
    const category = await this.findOne(id);
    if (category.store_id)
      await this.accessValidation.validateStoreAccess(category.store_id, user);

    // Solo usar los campos que existen en el schema de Prisma
    const updateData: any = {};
    if (updateCategoryDto.name) {
      updateData.name = updateCategoryDto.name;
      if (category.store_id) {
        const slug = slugify(updateCategoryDto.name, {
          lower: true,
          strict: true,
        });
        await this.validateUniqueSlug(slug, category.store_id, id);
        updateData.slug = slug;
      }
    }
    if (updateCategoryDto.description !== undefined) {
      updateData.description = updateCategoryDto.description;
    }
    if (updateCategoryDto.image_url !== undefined) {
      // CRITICAL: Sanitize image_url to extract S3 key before storing
      updateData.image_url = extractS3KeyFromUrl(updateCategoryDto.image_url);
    }
    if (updateCategoryDto.state !== undefined) {
      updateData.state = updateCategoryDto.state;
    }
    if (updateCategoryDto.is_featured !== undefined) {
      updateData.is_featured = updateCategoryDto.is_featured;
    }
    // store_id se gestiona automáticamente por el contexto de Prisma
    // if (updateCategoryDto.store_id !== undefined) {
    //   updateData.store_id = updateCategoryDto.store_id;
    // }

    let updated;
    try {
      updated = await this.prisma.categories.update({
        where: { id },
        data: updateData,
        include: { stores: true },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.CAT_NAME_EXISTS_001);
      }
      throw error;
    }

    return {
      ...updated,
      image_url: await this.s3Service.signUrl(updated.image_url),
    };
  }

  async remove(id: number, user: any, options: { force?: boolean } = {}) {
    const category = await this.findOne(id, { includeInactive: true });

    const productCount = await this.prisma.product_categories.count({
      where: { category_id: id },
    });

    if (productCount > 0 && !options.force) {
      throw new VendixHttpException(
        ErrorCodes.CAT_DELETE_HAS_PRODUCTS,
        undefined,
        { product_count: productCount },
      );
    }

    if (productCount > 0 && options.force) {
      await this.prisma.product_categories.deleteMany({
        where: { category_id: id },
      });
    }

    await this.prisma.categories.update({
      where: { id },
      data: {
        state: 'archived',
      },
    });
  }

  async uploadCategoryImage(file: Buffer, filename: string) {
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
    const basePath = this.s3PathHelper.buildCategoryPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/${timestamp}-${cleanFilename}`;

    try {
      const result = await this.s3Service.uploadImage(file, key, {
        generateThumbnail: true,
        context: ImageContext.CATEGORY,
      });
      const signedUrl = await this.s3Service.getPresignedUrl(result.key);

      return {
        key: result.key,
        url: signedUrl,
        thumbKey: result.thumbKey,
      };
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      throw new VendixHttpException(ErrorCodes.MEDIA_UPLOAD_FAILED_001);
    }
  }

  private async validateUniqueSlug(
    slug: string,
    storeId: number,
    excludeId?: number,
  ) {
    const where: any = { slug };
    if (excludeId) where.id = { not: excludeId };
    const existing = await this.prisma.categories.findFirst({ where });
    if (existing) throw new VendixHttpException(ErrorCodes.CAT_NAME_EXISTS_001);
  }
}

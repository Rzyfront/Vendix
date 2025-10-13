import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  AssignProductToCategoryDto,
} from './dto';
import slugify from 'slugify';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto, user: any) {
    await this.validateStoreAccess(createCategoryDto.store_id, user);
    const slug = slugify(createCategoryDto.name, { lower: true, strict: true });
    await this.validateUniqueSlug(slug, createCategoryDto.store_id);

    return this.prisma.categories.create({
      data: {
        ...createCategoryDto,
        slug,
        state: 'active',
      },
      include: { stores: true },
    });
  }

  async findAll(query: CategoryQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      store_id,
      sort_by = 'name',
      sort_order = 'asc',
      include_inactive = false,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (!include_inactive) where.state = 'active';
    if (search)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    if (store_id) where.store_id = store_id;

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

    return {
      data: categories,
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
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: number, updateCategoryDto: UpdateCategoryDto, user: any) {
    const category = await this.findOne(id);
    if (category.store_id)
      await this.validateStoreAccess(category.store_id, user);

    const updateData: any = { ...updateCategoryDto };
    if (updateCategoryDto.name && category.store_id) {
      const slug = slugify(updateCategoryDto.name, {
        lower: true,
        strict: true,
      });
      await this.validateUniqueSlug(slug, category.store_id, id);
      updateData.slug = slug;
    }

    return this.prisma.categories.update({
      where: { id },
      data: updateData,
      include: { stores: true },
    });
  }

  async remove(id: number, user: any) {
    const category = await this.findOne(id, { includeInactive: true });
    if (category.store_id)
      await this.validateStoreAccess(category.store_id, user);

    const productCount = await this.prisma.product_categories.count({
      where: { category_id: id },
    });
    if (productCount > 0)
      throw new BadRequestException(
        'Cannot delete category with assigned products',
      );

    await this.prisma.categories.delete({ where: { id } });
  }

  private async validateStoreAccess(storeId: number, user: any) {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException('Store not found');
    if (
      store.organization_id !== user.organizationId &&
      user.role !== 'super_admin'
    ) {
      throw new ForbiddenException('Access denied to this store');
    }
  }

  private async validateUniqueSlug(
    slug: string,
    storeId: number,
    excludeId?: number,
  ) {
    const where: any = { slug, store_id: storeId };
    if (excludeId) where.id = { not: excludeId };
    const existing = await this.prisma.categories.findFirst({ where });
    if (existing)
      throw new ConflictException('Category slug already exists in this store');
  }
}

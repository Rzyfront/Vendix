import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  AssignProductToCategoryDto,
} from './dto';
import slugify from 'slugify';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: StorePrismaService,
    private accessValidation: AccessValidationService,
  ) {}

  async create(createCategoryDto: CreateCategoryDto, user: any) {
    // store_id se infiere automáticamente del contexto del token
    // if (!createCategoryDto.store_id) {
    //   throw new BadRequestException('store_id is required');
    // }

    // await this.accessValidation.validateStoreAccess(
    //   createCategoryDto.store_id,
    //   user,
    // );
    const slug = slugify(createCategoryDto.name, { lower: true, strict: true });
    // El store_id se infiere automáticamente del contexto, no necesitamos validar slug único manualmente
    // await this.validateUniqueSlug(slug, createCategoryDto.store_id);

    // Solo usar los campos que existen en el schema de Prisma
    // store_id se inyecta automáticamente por el contexto de Prisma
    const categoryData: any = {
      name: createCategoryDto.name,
      slug: slug,
      description: createCategoryDto.description,
      // store_id: createCategoryDto.store_id, // Se inyecta automáticamente
      image_url: createCategoryDto.image_url,
      state: 'active', // Usar 'state' en lugar de 'status'
    };

    return this.prisma.categories.create({
      data: categoryData,
      include: { stores: true },
    });
  }

  async findAll(query: CategoryQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'name',
      sort_order = 'asc',
      state,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (state) where.state = state;
    else where.state = { not: 'archived' }; // Excluir archivados por defecto

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
      updateData.image_url = updateCategoryDto.image_url;
    }
    // store_id se gestiona automáticamente por el contexto de Prisma
    // if (updateCategoryDto.store_id !== undefined) {
    //   updateData.store_id = updateCategoryDto.store_id;
    // }

    return this.prisma.categories.update({
      where: { id },
      data: updateData,
      include: { stores: true },
    });
  }

  async remove(id: number, user: any) {
    const category = await this.findOne(id, { includeInactive: true });
    if (category.store_id)
      await this.accessValidation.validateStoreAccess(category.store_id, user);

    const productCount = await this.prisma.product_categories.count({
      where: { category_id: id },
    });
    if (productCount > 0)
      throw new BadRequestException(
        'Cannot delete category with assigned products',
      );

    // Eliminación lógica: cambiar estado a archived
    await this.prisma.categories.update({
      where: { id },
      data: {
        state: 'archived',
        updated_at: new Date(),
      },
    });
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

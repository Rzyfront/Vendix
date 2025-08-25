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
import { generateSlug } from '../../common/utils/slug.util';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto, user: any) {
    // Validate user has access to the store
    await this.validateStoreAccess(createCategoryDto.store_id, user);

    // Generate slug if not provided
    const slug = createCategoryDto.slug || generateSlug(createCategoryDto.name);

    // Check if slug already exists in the store
    await this.validateUniqueSlug(slug, createCategoryDto.store_id);

    try {
      const category = await this.prisma.categories.create({
        data: {
          name: createCategoryDto.name,
          slug,
          description: createCategoryDto.description,
          image_url: createCategoryDto.image_url,
          store_id: createCategoryDto.store_id,
          state: 'active',
        },
        include: {
          stores: {
            select: { id: true, name: true },
          },
        },
      });

      return category;
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Category slug already exists in this store',
        );
      }
      throw error;
    }
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

    if (!include_inactive) {
      where.state = 'active';
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (store_id) {
      where.store_id = store_id;
    }

    const [categories, total] = await Promise.all([
      this.prisma.categories.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.categories.count({ where }),
    ]);

    return {
      data: categories,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, options: { includeInactive?: boolean } = {}) {
    const where: any = { id };

    if (!options.includeInactive) {
      where.state = 'active';
    }

    const category = await this.prisma.categories.findFirst({
      where,
      include: {
        stores: {
          select: { id: true, name: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async findBySlug(
    slug: string,
    storeId: number,
    options: { includeInactive?: boolean } = {},
  ) {
    const where: any = { slug, store_id: storeId };

    if (!options.includeInactive) {
      where.state = 'active';
    }

    const category = await this.prisma.categories.findFirst({
      where,
      include: {
        stores: {
          select: { id: true, name: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async findByStore(storeId: number, query: CategoryQueryDto) {
    return this.findAll({ ...query, store_id: storeId });
  }
  async update(id: number, updateCategoryDto: UpdateCategoryDto, user: any) {
    const category = await this.findOne(id);

    // Validate user has access to the store
    if (category.store_id) {
      await this.validateStoreAccess(category.store_id, user);
    }

    // Build update data
    const updateData: any = {};

    if (updateCategoryDto.name) {
      updateData.name = updateCategoryDto.name;
    }

    if (updateCategoryDto.description !== undefined) {
      updateData.description = updateCategoryDto.description;
    }

    if (updateCategoryDto.image_url !== undefined) {
      updateData.image_url = updateCategoryDto.image_url;
    }

    if (updateCategoryDto.slug && category.store_id) {
      await this.validateUniqueSlug(
        updateCategoryDto.slug,
        category.store_id,
        id,
      );
      updateData.slug = updateCategoryDto.slug;
    }

    try {
      const updatedCategory = await this.prisma.categories.update({
        where: { id },
        data: updateData,
        include: {
          stores: {
            select: { id: true, name: true },
          },
        },
      });

      return updatedCategory;
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'Category slug already exists in this store',
        );
      }
      throw error;
    }
  }
  async activate(id: number, user: any) {
    const category = await this.findOne(id, { includeInactive: true });

    // Validate user has access to the store
    if (category.store_id) {
      await this.validateStoreAccess(category.store_id, user);
    }

    const updatedCategory = await this.prisma.categories.update({
      where: { id },
      data: {
        state: 'active',
      },
    });

    return updatedCategory;
  }

  async deactivate(id: number, user: any) {
    const category = await this.findOne(id);

    // Validate user has access to the store
    if (category.store_id) {
      await this.validateStoreAccess(category.store_id, user);
    }

    await this.prisma.categories.update({
      where: { id },
      data: {
        state: 'inactive',
      },
    });
  }

  async remove(id: number, user: any) {
    const category = await this.findOne(id, { includeInactive: true });

    // Validate user has access to the store
    if (category.store_id) {
      await this.validateStoreAccess(category.store_id, user);
    }

    // Check if category has products
    const productCount = await this.prisma.product_categories.count({
      where: { category_id: id },
    });

    if (productCount > 0) {
      throw new BadRequestException(
        'Cannot delete category with assigned products',
      );
    }

    await this.prisma.categories.delete({
      where: { id },
    });
  }
  async assignProduct(
    categoryId: number,
    assignProductDto: AssignProductToCategoryDto,
    user: any,
  ) {
    const category = await this.findOne(categoryId);

    // Validate user has access to the store
    if (category.store_id) {
      await this.validateStoreAccess(category.store_id, user);
    }

    // Validate product exists and belongs to the same store
    const product = await this.prisma.products.findFirst({
      where: {
        id: assignProductDto.product_id,
        store_id: category.store_id || undefined,
        state: 'active',
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or not in the same store');
    }

    // Check if assignment already exists
    const existingAssignment = await this.prisma.product_categories.findUnique({
      where: {
        product_id_category_id: {
          product_id: assignProductDto.product_id,
          category_id: categoryId,
        },
      },
    });

    if (existingAssignment) {
      throw new ConflictException(
        'Product is already assigned to this category',
      );
    }

    const assignment = await this.prisma.product_categories.create({
      data: {
        product_id: assignProductDto.product_id,
        category_id: categoryId,
      },
      include: {
        products: {
          select: { id: true, name: true, sku: true },
        },
        categories: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    return assignment;
  }

  async removeProduct(categoryId: number, productId: number, user: any) {
    const category = await this.findOne(categoryId);

    // Validate user has access to the store
    if (category.store_id) {
      await this.validateStoreAccess(category.store_id, user);
    }

    const assignment = await this.prisma.product_categories.findUnique({
      where: {
        product_id_category_id: {
          product_id: productId,
          category_id: categoryId,
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Product assignment not found');
    }

    await this.prisma.product_categories.delete({
      where: {
        product_id_category_id: {
          product_id: productId,
          category_id: categoryId,
        },
      },
    });
  }
  async getCategoryTree(storeId: number, includeInactive: boolean = false) {
    await this.validateStoreAccess(storeId, { id: 1, role: 'system_admin' }); // Simplified validation

    const where: any = { store_id: storeId };

    if (!includeInactive) {
      where.state = 'active';
    }

    const categories = await this.prisma.categories.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        stores: {
          select: { id: true, name: true },
        },
        _count: {
          select: {
            product_categories: true,
          },
        },
      },
    });

    // Build a simple tree structure (assuming flat structure for now)
    return {
      data: categories.map((category) => ({
        ...category,
        children: [], // Categories don't have parent_id in the schema, so flat structure
        product_count: category._count.product_categories,
      })),
      meta: {
        total: categories.length,
        store_id: storeId,
      },
    };
  }

  private async validateStoreAccess(storeId: number, user: any) {
    // Check if user has access to this store
    const storeAccess = await this.prisma.store_staff.findFirst({
      where: {
        store_id: storeId,
        user_id: user.id,
        is_active: true,
      },
    });

    if (!storeAccess) {
      throw new ForbiddenException('Access denied to this store');
    }
  }

  private async validateUniqueSlug(
    slug: string,
    storeId: number,
    excludeId?: number,
  ) {
    const where: any = { slug, store_id: storeId };
    if (excludeId) {
      where.id = { not: excludeId };
    }

    const existing = await this.prisma.categories.findFirst({ where });
    if (existing) {
      throw new ConflictException('Category slug already exists in this store');
    }
  }
}

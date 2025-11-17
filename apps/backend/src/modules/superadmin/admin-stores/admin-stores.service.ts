import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  AdminStoreQueryDto,
  StoreType,
} from 'src/modules/stores/dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';

@Injectable()
export class AdminStoresService {
  constructor(private prisma: PrismaService) {}

  async create(createStoreDto: CreateStoreDto) {
    const slug = slugify(createStoreDto.name, {
      lower: true,
      strict: true,
    });

    const existingStore = await this.prisma.stores.findFirst({
      where: {
        OR: [{ slug }, { name: createStoreDto.name }],
        organization_id: createStoreDto.organization_id,
      },
    });

    if (existingStore) {
      throw new ConflictException(
        'Store with this name or slug already exists in this organization',
      );
    }

    return this.prisma.stores.create({
      data: {
        ...createStoreDto,
        slug,
        updated_at: new Date(),
      },
      include: {
        organizations: true,
        addresses: true,
        store_users: true,
      },
    });
  }

  async findAll(query: AdminStoreQueryDto) {
    const { page = 1, limit = 10, search, organization_id, store_type } = query;
    const skip = (page - 1) * Number(limit);

    const where: Prisma.storesWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (organization_id) {
      where.organization_id = organization_id;
    }

    if (store_type) {
      where.store_type = store_type;
    }

    const [data, total] = await Promise.all([
      this.prisma.stores.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          organizations: {
            select: { id: true, name: true, slug: true },
          },
          _count: {
            select: {
              store_users: true,
              products: true,
              orders: true,
            },
          },
        },
      }),
      this.prisma.stores.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const store = await this.prisma.stores.findUnique({
      where: { id },
      include: {
        organizations: true,
        addresses: true,
        store_users: {
          include: {
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                state: true,
              },
            },
          },
        },
        _count: {
          select: {
            store_users: true,
            products: true,
            orders: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return store;
  }

  async update(id: number, updateStoreDto: UpdateStoreDto) {
    const existingStore = await this.prisma.stores.findUnique({
      where: { id },
    });

    if (!existingStore) {
      throw new NotFoundException('Store not found');
    }

    let slug = existingStore.slug;
    if (updateStoreDto.name && updateStoreDto.name !== existingStore.name) {
      slug = slugify(updateStoreDto.name, {
        lower: true,
        strict: true,
      });

      const slugExists = await this.prisma.stores.findFirst({
        where: {
          slug,
          id: { not: id },
          organization_id: existingStore.organization_id,
        },
      });

      if (slugExists) {
        throw new ConflictException(
          'Store with this slug already exists in this organization',
        );
      }
    }

    return this.prisma.stores.update({
      where: { id },
      data: {
        ...updateStoreDto,
        slug,
        updated_at: new Date(),
      },
      include: {
        organizations: true,
        addresses: true,
        store_users: true,
      },
    });
  }

  async remove(id: number) {
    const existingStore = await this.prisma.stores.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            store_users: true,
            products: true,
            orders: true,
          },
        },
      },
    });

    if (!existingStore) {
      throw new NotFoundException('Store not found');
    }

    if (
      existingStore._count.store_users > 0 ||
      existingStore._count.products > 0 ||
      existingStore._count.orders > 0
    ) {
      throw new ConflictException(
        'Cannot delete store with existing users, products, or orders',
      );
    }

    return this.prisma.stores.delete({
      where: { id },
    });
  }

  async getDashboardStats() {
    const [
      totalStores,
      activeStores,
      storesByType,
      storesByState,
      recentStores,
    ] = await Promise.all([
      this.prisma.stores.count(),
      this.prisma.stores.count({ where: { is_active: true } }),
      this.prisma.stores.groupBy({
        by: ['store_type'],
        _count: true,
      }),
      this.prisma.stores.groupBy({
        by: ['is_active'],
        _count: true,
      }),
      this.prisma.stores.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          organizations: {
            select: { name: true },
          },
          _count: {
            select: {
              store_users: true,
              products: true,
              orders: true,
            },
          },
        },
      }),
    ]);

    return {
      totalStores,
      activeStores,
      storesByType: storesByType.reduce(
        (acc, item) => {
          acc[item.store_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      storesByState: storesByState.reduce(
        (acc, item) => {
          acc[item.is_active.toString()] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recentStores,
    };
  }
}

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
  UpdateStoreSettingsDto,
} from './dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  async create(createStoreDto: CreateStoreDto) {
    const organization = await this.prisma.organizations.findUnique({
      where: { id: createStoreDto.organization_id },
    });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const slug = slugify(createStoreDto.name, { lower: true, strict: true });
    const existingStore = await this.prisma.stores.findFirst({
      where: { organization_id: createStoreDto.organization_id, slug },
    });
    if (existingStore) {
      throw new ConflictException('Store slug already exists in this organization');
    }

    return this.prisma.stores.create({
      data: {
        ...createStoreDto,
        slug,
        updated_at: new Date(),
      },
      include: {
        organizations: { select: { id: true, name: true, slug: true } },
        addresses: true,
        store_settings: true,
        _count: { select: { products: true, orders: true, store_users: true } },
      },
    });
  }

  async findAll(query: StoreQueryDto) {
    const { page = 1, limit = 10, search, store_type, is_active, organization_id } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.storesWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { store_code: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(store_type && { store_type }),
      ...(is_active !== undefined && { is_active }),
      ...(organization_id && { organization_id }),
    };

    const [stores, total] = await Promise.all([
      this.prisma.stores.findMany({
        where,
        skip,
        take: limit,
        include: {
          organizations: { select: { id: true, name: true, slug: true } },
          addresses: { where: { is_primary: true } },
          _count: { select: { products: true, orders: true, store_users: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.stores.count({ where }),
    ]);

    return {
      data: stores,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const store = await this.prisma.stores.findUnique({
      where: { id },
      include: {
        organizations: true,
        addresses: true,
        store_settings: true,
        store_users: { include: { user: true } },
        _count: { select: { products: true, orders: true, categories: true, store_users: true } },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  async update(id: number, updateStoreDto: UpdateStoreDto) {
    await this.findOne(id);
    return this.prisma.stores.update({
      where: { id },
      data: { ...updateStoreDto, updated_at: new Date() },
      include: { organizations: true, addresses: true, store_settings: true },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    const activeOrders = await this.prisma.orders.count({
      where: { store_id: id, state: { in: ['created', 'pending_payment', 'processing', 'shipped'] } },
    });
    if (activeOrders > 0) {
      throw new BadRequestException('Cannot delete store with active orders');
    }
    return this.prisma.stores.delete({ where: { id } });
  }

  async updateStoreSettings(storeId: number, settingsDto: UpdateStoreSettingsDto) {
    await this.findOne(storeId);
    return this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      update: { settings: settingsDto.settings, updated_at: new Date() },
      create: { store_id: storeId, settings: settingsDto.settings },
    });
  }
}
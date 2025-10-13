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
  StoreDashboardDto,
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
      throw new ConflictException(
        'Store slug already exists in this organization',
      );
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
    const {
      page = 1,
      limit = 10,
      search,
      store_type,
      is_active,
      organization_id,
    } = query;
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
          _count: {
            select: { products: true, orders: true, store_users: true },
          },
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
        _count: {
          select: {
            products: true,
            orders: true,
            categories: true,
            store_users: true,
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
      where: {
        store_id: id,
        state: { in: ['created', 'pending_payment', 'processing', 'shipped'] },
      },
    });
    if (activeOrders > 0) {
      throw new BadRequestException('Cannot delete store with active orders');
    }

    // Eliminar registros relacionados que podrían causar violación de FK
    await this.prisma.login_attempts.deleteMany({
      where: { store_id: id },
    });

    return this.prisma.stores.delete({ where: { id } });
  }

  async updateStoreSettings(
    storeId: number,
    settingsDto: UpdateStoreSettingsDto,
  ) {
    await this.findOne(storeId);
    return this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      update: { settings: settingsDto.settings, updated_at: new Date() },
      create: { store_id: storeId, settings: settingsDto.settings },
    });
  }

  async getDashboard(id: number, query: StoreDashboardDto) {
    const { start_date, end_date } = query;

    // Default last 30 days
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = end_date || new Date();

    // Base metrics
    const [
      totalOrdersCount,
      totalRevenue,
      productsLowStockCount,
      activeCustomersCount,
      recentOrders,
      topProducts,
      salesByPeriod
    ] = await Promise.all([
      // Total orders count in period
      this.prisma.orders.count({
        where: {
          store_id: id,
          created_at: { gte: startDate },
          state: { not: 'cancelled' }
        }
      }),

      // Total revenue
      this.prisma.orders.aggregate({
        where: {
          store_id: id,
          created_at: { gte: startDate },
          state: 'finished'
        },
        _sum: { grand_total: true }
      }),

      // Products with low stock (less than 10 units)
      this.prisma.products.count({
        where: {
          store_id: id,
          state: 'active',
          stock_quantity: { lt: 10, gte: 0 }
        }
      }),

      // Active customers (unique customers who made orders)
      this.prisma.orders.findMany({
        where: {
          store_id: id,
          created_at: { gte: startDate },
          state: { not: 'cancelled' }
        },
        select: { customer_id: true },
        distinct: ['customer_id']
      }).then(orders => orders.length),

      // Recent orders (last 10)
      this.prisma.orders.findMany({
        where: { store_id: id },
        include: {
          addresses_orders_billing_address_idToaddresses: {
            select: { id: true, city: true, country_code: true }
          }
        },
        orderBy: { created_at: 'desc' },
        take: 10
      }),

      // Top selling products
      this.prisma.order_items.groupBy({
        by: ['product_id', 'product_name'],
        where: {
          orders: {
            store_id: id,
            created_at: { gte: startDate },
            state: { not: 'cancelled' }
          }
        },
        _sum: {
          quantity: true,
          total_price: true
        },
        orderBy: {
          _sum: {
            quantity: 'desc'
          }
        },
        take: 10
      }),

      // Sales by day for chart (last 7 days)
      this.prisma.orders.findMany({
        where: {
          store_id: id,
          created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          state: 'finished'
        },
        select: {
          created_at: true,
          grand_total: true
        },
        orderBy: { created_at: 'asc' }
      })
    ]);

    // Process sales by period for chart
    const salesChart = salesByPeriod.reduce((acc, order) => {
      const date = order.created_at.toISOString().split('T')[0];
      if (!acc[date]) acc[date] = 0;
      acc[date] += Number(order.grand_total || 0);
      return acc;
    }, {} as Record<string, number>);

    return {
      store_id: id,
      metrics: {
        total_orders: totalOrdersCount,
        total_revenue: totalRevenue._sum.grand_total || 0,
        low_stock_products: productsLowStockCount,
        active_customers: activeCustomersCount,
        revenue_today: 0, // Placeholder for more complex calculation
        revenue_this_week: Object.values(salesChart).reduce((sum: number, val: number) => sum + val, 0),
        average_order_value: totalOrdersCount > 0 ? (totalRevenue._sum.grand_total || 0) / totalOrdersCount : 0
      },
      recent_orders: recentOrders.map(order => ({
        id: order.id,
        order_number: order.order_number,
        grand_total: order.grand_total,
        state: order.state,
        created_at: order.created_at,
        customer_location: order.addresses_orders_billing_address_idToaddresses?.country_code || 'Unknown'
      })),
      top_products: topProducts.slice(0, 5).map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        total_sold: item.quantity,
        total_revenue: item._sum.total_price || 0
      })),
      sales_chart: Object.entries(salesChart).map(([date, total]) => ({ date, total }))
    };
  }
}

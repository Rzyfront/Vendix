import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
  UpdateStoreSettingsDto,
  StoreDashboardDto,
} from './dto';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';

@Injectable()
export class StoresService {
  constructor(
    private prisma: StorePrismaService,
    private s3Service: S3Service,
  ) { }

  async create(createStoreDto: CreateStoreDto) {
    // Obtener organization_id del contexto
    const organization_id = RequestContextService.getOrganizationId();

    if (!organization_id) {
      throw new BadRequestException('Organization context is required');
    }

    const slug = slugify(createStoreDto.name, { lower: true, strict: true });
    const existingStore = await this.prisma.stores.findFirst({
      where: {
        slug,
        organization_id: organization_id,
      },
    });
    if (existingStore) {
      throw new ConflictException(
        'Store slug already exists in this organization',
      );
    }

    // Extract settings and organization_id from DTO and remove from main store data
    const { settings, organization_id: _, ...storeData } = createStoreDto;

    const store = await this.prisma.stores.create({
      data: {
        ...storeData,
        slug,
        updated_at: new Date(),
        organizations: {
          connect: { id: organization_id },
        },
      },
      include: {
        organizations: { select: { id: true, name: true, slug: true } },
        addresses: true,
        store_settings: true,
        _count: { select: { products: true, orders: true, store_users: true } },
      },
    });

    const signedStore = {
      ...store,
      logo_url: await this.s3Service.signUrl((store as any).logo_url),
    };

    // Create store settings if provided
    if (settings && Object.keys(settings).length > 0) {
      await this.prisma.store_settings.create({
        data: {
          store_id: store.id,
          settings,
        },
      });

      // Refetch to include settings
      const refetched = await this.prisma.stores.findUnique({
        where: { id: store.id },
        include: {
          organizations: { select: { id: true, name: true, slug: true } },
          addresses: true,
          store_settings: true,
          _count: {
            select: { products: true, orders: true, store_users: true },
          },
        },
      });

      return {
        ...refetched,
        logo_url: await this.s3Service.signUrl((refetched as any)?.logo_url),
      };
    }

    return signedStore;
  }

  async findAll(query: StoreQueryDto) {
    const { page = 1, limit = 10, search, store_type, is_active } = query;
    const skip = (page - 1) * limit;

    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;

    const where: Prisma.storesWhereInput = {
      ...(organization_id && !context?.is_super_admin && { organization_id }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { store_code: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(store_type && { store_type }),
      ...(is_active !== undefined && { is_active }),
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

    const signedStores = await Promise.all(stores.map(async (store) => ({
      ...store,
      logo_url: await this.s3Service.signUrl((store as any).logo_url, true),
    })));

    return {
      data: signedStores,
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
    return {
      ...store,
      logo_url: await this.s3Service.signUrl((store as any).logo_url),
    };
  }

  async update(id: number, updateStoreDto: UpdateStoreDto) {
    await this.findOne(id);

    // Extract settings from DTO and remove from main store data
    const { settings, ...storeData } = updateStoreDto;

    // Update store settings if provided
    if (settings) {
      await this.prisma.store_settings.upsert({
        where: { store_id: id },
        update: { settings },
        create: { store_id: id, settings },
      });
    }

    const updated = await this.prisma.stores.update({
      where: { id },
      data: { ...storeData, updated_at: new Date() },
      include: { organizations: true, addresses: true, store_settings: true },
    });

    return {
      ...updated,
      logo_url: await this.s3Service.signUrl((updated as any).logo_url),
    };
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
    const startDate =
      start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = end_date || new Date();

    // Base metrics
    const [
      totalOrdersCount,
      totalRevenue,
      productsLowStockCount,
      activeCustomersCount,
      recentOrders,
      topProducts,
      salesByPeriod,
    ] = await Promise.all([
      // Total orders count in period
      this.prisma.orders.count({
        where: {
          store_id: id,
          created_at: { gte: startDate },
          state: { not: 'cancelled' },
        },
      }),

      // Total revenue
      this.prisma.orders.aggregate({
        where: {
          store_id: id,
          created_at: { gte: startDate },
          state: 'finished',
        },
        _sum: { grand_total: true },
      }),

      // Products with low stock (less than 10 units)
      this.prisma.products.count({
        where: {
          store_id: id,
          state: 'active',
          stock_quantity: { lt: 10, gte: 0 },
        },
      }),

      // Active customers (unique customers who made orders)
      this.prisma.orders
        .findMany({
          where: {
            store_id: id,
            created_at: { gte: startDate },
            state: { not: 'cancelled' },
          },
          select: { customer_id: true },
          distinct: ['customer_id'],
        })
        .then((orders) => orders.length),

      // Recent orders (last 10)
      this.prisma.orders.findMany({
        where: { store_id: id },
        include: {
          addresses_orders_billing_address_idToaddresses: {
            select: { id: true, city: true, country_code: true },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),

      // Top selling products
      this.prisma.sales_order_items
        .findMany({
          where: {
            sales_orders: {
              store_id: id,
              created_at: { gte: startDate },
              state: { not: 'cancelled' },
            },
          },
          include: {
            products: {
              select: { name: true },
            },
          },
          orderBy: {
            quantity: 'desc',
          },
          take: 10,
        })
        .then((items) => {
          const grouped = items.reduce(
            (acc, item) => {
              const key = item.product_id;
              if (!acc[key]) {
                acc[key] = {
                  product_id: item.product_id,
                  product_name: item.products?.name || 'Unknown',
                  quantity: 0,
                  total_price: 0,
                };
              }
              acc[key].quantity += item.quantity;
              acc[key].total_price += Number(item.total_price || 0);
              return acc;
            },
            {} as Record<
              number,
              {
                product_id: number;
                product_name: string;
                quantity: number;
                total_price: number;
              }
            >,
          );
          return Object.values(grouped).sort(
            (a: any, b: any) => b.quantity - a.quantity,
          );
        }),

      // Sales by day for chart (last 7 days)
      this.prisma.orders.findMany({
        where: {
          store_id: id,
          created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          state: 'finished',
        },
        select: {
          created_at: true,
          grand_total: true,
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    // Process sales by period for chart
    const salesChart = salesByPeriod.reduce(
      (acc, order) => {
        const date = order.created_at.toISOString().split('T')[0];
        if (!acc[date]) acc[date] = 0;
        acc[date] += Number(order.grand_total || 0);
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      store_id: id,
      metrics: {
        total_orders: totalOrdersCount,
        total_revenue: totalRevenue._sum.grand_total || 0,
        low_stock_products: productsLowStockCount,
        active_customers: activeCustomersCount,
        revenue_today: 0, // Placeholder for more complex calculation
        revenue_this_week: Object.values(salesChart).reduce(
          (sum: number, val: number) => sum + val,
          0,
        ),
        average_order_value:
          totalOrdersCount > 0
            ? (totalRevenue._sum.grand_total || 0) / totalOrdersCount
            : 0,
      },
      recent_orders: recentOrders.map((order) => ({
        id: order.id,
        order_number: order.order_number,
        grand_total: order.grand_total,
        state: order.state,
        created_at: order.created_at,
        customer_location:
          order.addresses_orders_billing_address_idToaddresses?.country_code ||
          'Unknown',
      })),
      top_products: topProducts.slice(0, 5).map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        total_sold: item.quantity,
        total_revenue: item._sum.total_price || 0,
      })),
      sales_chart: Object.entries(salesChart).map(([date, total]) => ({
        date,
        total,
      })),
    };
  }

  async getGlobalDashboard() {
    // Get all stores counts by status
    const [
      totalStores,
      activeStores,
      inactiveStores,
      suspendedStores,
      draftStores,
      totalRevenue,
      totalOrders,
      totalProducts,
    ] = await Promise.all([
      // Total stores count
      this.prisma.stores.count(),

      // Active stores count
      this.prisma.stores.count({
        where: { is_active: true },
      }),

      // Inactive stores count
      this.prisma.stores.count({
        where: { is_active: false },
      }),

      // Suspended stores (assuming suspended means inactive with specific conditions)
      this.prisma.stores.count({
        where: {
          is_active: false,
          // Add additional conditions if needed for suspended status
        },
      }),

      // Draft stores (assuming draft means recently created but not active)
      this.prisma.stores.count({
        where: {
          is_active: false,
          created_at: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),

      // Total revenue from all finished orders
      this.prisma.orders.aggregate({
        where: {
          state: 'finished',
        },
        _sum: { grand_total: true },
      }),

      // Total orders count (excluding cancelled)
      this.prisma.orders.count({
        where: {
          state: { not: 'cancelled' },
        },
      }),

      // Total products count (active products)
      this.prisma.products.count({
        where: {
          state: 'active',
        },
      }),
    ]);

    return {
      total_stores: totalStores,
      active_stores: activeStores,
      inactive_stores: inactiveStores,
      suspended_stores: suspendedStores,
      draft_stores: draftStores,
      total_revenue: totalRevenue._sum.grand_total || 0,
      total_orders: totalOrders,
      total_products: totalProducts,
    };
  }
}

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
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
import { DomainGeneratorHelper, DomainContext } from '../../../common/helpers/domain-generator.helper';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import { getDefaultStoreSettings } from '../../store/settings/defaults/default-store-settings';
import { StoreSettings } from '../../store/settings/interfaces/store-settings.interface';

@Injectable()
export class StoresService {
  constructor(
    private prisma: OrganizationPrismaService,
    private domainGeneratorHelper: DomainGeneratorHelper,
    private brandingGeneratorHelper: BrandingGeneratorHelper,
  ) { }

  // ... (lines 27-465 remain unchanged, I will use MultiReplace to target specific blocks)


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
      },
    });
    if (existingStore) {
      throw new ConflictException(
        'Store slug already exists in this organization',
      );
    }

    // Extract settings from DTO and remove from main store data
    const { settings, ...storeData } = createStoreDto;

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

    // Create store domain (STORE_ADMIN context: {slug}-store.vendix.com)
    await this.createStoreDomain(store.id, store.slug);

    // Create store settings if provided
    if (settings && Object.keys(settings).length > 0) {
      await this.prisma.store_settings.create({
        data: {
          store_id: store.id,
          settings,
        },
      });

      // Refetch to include settings
      return this.prisma.stores.findUnique({
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
    }

    return store;
  }

  async findAll(query: StoreQueryDto) {
    const { page = 1, limit = 10, search, store_type, is_active } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.storesWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { store_code: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(store_type && { store_type }),
      // Default to only active stores if is_active is not specified
      ...(is_active !== undefined ? { is_active } : { is_active: true }),
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

    return this.prisma.stores.update({
      where: { id },
      data: { ...storeData, updated_at: new Date() },
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

    // Soft delete: Deactivate the store instead of physically deleting it
    // This preserves all relationships and data integrity
    return this.prisma.stores.update({
      where: { id },
      data: {
        is_active: false,
        updated_at: new Date(),
      },
      include: { organizations: true, addresses: true, store_settings: true },
    });
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

  async getStoreSettings(storeId: number) {
    // Obtener datos de la tienda desde la tabla stores
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        logo_url: true,
        store_type: true,
        timezone: true,
        organization_id: true,
      }
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    let storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
    });

    // Get domain config for the app section
    const domainConfig = await this.getDomainConfig(storeId);
    const branding = domainConfig?.branding || {};

    // Mapear colores del dominio a la estructura de AppSettings
    const primaryColor = branding.primary_color || '#7ED7A5';
    const secondaryColor = branding.secondary_color || branding.surface_color || '#2F6F4E';
    const accentColor = branding.accent_color || '#FFFFFF';
    const theme = branding.theme === 'light' ? 'default' : branding.theme || 'default';

    if (!storeSettings || !storeSettings.settings) {
      return {
        ...getDefaultStoreSettings(),
        general: {
          ...getDefaultStoreSettings().general,
          name: store?.name,
          logo_url: store?.logo_url,
          store_type: store?.store_type as any,
          timezone: store?.timezone || getDefaultStoreSettings().general.timezone,
        },
        app: {
          name: branding.name || store?.name || 'Vendix',
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          accent_color: accentColor,
          theme: theme,
          logo_url: (branding.logo_url || store?.logo_url),
          favicon_url: branding.favicon_url,
        }
      };
    }

    // Merge existing settings with store data and app config from domain
    const settings = storeSettings.settings as any as StoreSettings;
    return {
      ...settings,
      general: {
        ...settings.general,
        name: store?.name,
        logo_url: store?.logo_url,
        store_type: store?.store_type as any,
        timezone: store?.timezone || settings.general?.timezone,
      },
      app: {
        name: branding.name || store?.name || 'Vendix',
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        accent_color: accentColor,
        theme: theme,
        logo_url: (branding.logo_url || store?.logo_url),
        favicon_url: branding.favicon_url,
      }
    };
  }

  async resetStoreSettings(storeId: number) {
    await this.findOne(storeId);

    // Delete existing settings
    await this.prisma.store_settings.delete({
      where: { store_id: storeId },
    }).catch(() => {
      // Ignore if settings don't exist
    });

    // Return default settings with store data and branding
    return this.getStoreSettings(storeId);
  }

  /**
   * Gets the domain configuration for a store.
   * Prioritizes the primary domain, falls back to any domain associated with the store.
   *
   * @param storeId - Store ID
   * @returns Domain config object or empty object if no domain found
   */
  private async getDomainConfig(storeId: number): Promise<any> {
    // Try to find primary domain first
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        store_id: storeId,
        is_primary: true,
      },
      select: { config: true }
    });

    // If no primary domain, try to find any domain associated with the store
    if (!domain) {
      const anyDomain = await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId },
        select: { config: true }
      });
      return anyDomain?.config || {};
    }

    return domain?.config || {};
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
      this.prisma.order_items.groupBy({
        by: ['product_id', 'product_name'],
        where: {
          orders: {
            store_id: id,
            created_at: { gte: startDate },
            state: { not: 'cancelled' },
          },
        },
        _sum: {
          quantity: true,
          total_price: true,
        },
        orderBy: {
          _sum: {
            quantity: 'desc',
          },
        },
        take: 10,
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
        if (order.created_at) {
          const date = order.created_at.toISOString().split('T')[0];
          if (!acc[date]) acc[date] = 0;
          acc[date] += Number(order.grand_total || 0);
        }
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
            ? Number(totalRevenue._sum.grand_total || 0) / totalOrdersCount
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
        total_sold: item._sum.quantity || 0,
        total_revenue: item._sum.total_price || 0,
      })),
      sales_chart: Object.entries(salesChart).map(([date, total]) => ({
        date,
        total,
      })),
    };
  }

  async getGlobalDashboard() {
    // Get all stores counts by status (only active stores count for metrics)
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
      // Total stores count - only active stores
      this.prisma.stores.count({
        where: { is_active: true },
      }),

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

      // Total revenue from all finished orders (only from active stores)
      this.prisma.orders.aggregate({
        where: {
          state: 'finished',
          stores: { is_active: true },
        },
        _sum: { grand_total: true },
      }),

      // Total orders count (excluding cancelled, only from active stores)
      this.prisma.orders.count({
        where: {
          state: { not: 'cancelled' },
          stores: { is_active: true },
        },
      }),

      // Total products count (active products from active stores)
      this.prisma.products.count({
        where: {
          state: 'active',
          stores: { is_active: true },
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

  /**
   * Create a domain for a store
   * Generates hostname: {slug}-store.vendix.com
   */
  private async createStoreDomain(
    storeId: number,
    storeSlug: string,
  ): Promise<void> {
    // Get all existing hostnames to check for uniqueness
    const existingDomains = await this.prisma.domain_settings.findMany({
      select: { hostname: true, config: true },
    });
    const existingHostnames: Set<string> = new Set(existingDomains.map((d) => d.hostname as string));

    // Generate unique hostname for store
    const hostname = this.domainGeneratorHelper.generateUnique(
      storeSlug,
      DomainContext.STORE,
      existingHostnames,
    );

    // Get branding config from organization domain if exists
    const orgDomain = existingDomains.find(d => d.config && typeof d.config === 'object' && 'branding' in (d.config as any));
    const orgBranding = (orgDomain?.config as any)?.branding || null;

    // Generate standardized branding
    const branding = this.brandingGeneratorHelper.generateBranding({
      name: orgBranding?.name || 'Vendix Store', // Default name if not found
      primaryColor: orgBranding?.primary_color,
      secondaryColor: orgBranding?.secondary_color,
      theme: orgBranding?.theme || 'light',
      logoUrl: orgBranding?.logo_url,
      faviconUrl: orgBranding?.favicon_url,
    });

    // Create domain settings for the store with standardized branding
    await this.prisma.domain_settings.create({
      data: {
        hostname,
        store_id: storeId,
        domain_type: 'store',
        is_primary: true,
        ownership: 'vendix_subdomain',
        status: 'active',
        ssl_status: 'none',
        config: {
          app: 'STORE_LANDING',
          branding: branding,
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  /**
   * Create an e-commerce domain for a store
   * Generates hostname: {slug}-shop.vendix.com
   */
  async createEcommerceDomain(
    storeId: number,
    storeSlug: string,
  ): Promise<string> {
    // Get all existing hostnames to check for uniqueness
    const existingDomains = await this.prisma.domain_settings.findMany({
      select: { hostname: true },
    });
    const existingHostnames: Set<string> = new Set(existingDomains.map((d) => d.hostname as string));

    // Generate unique hostname for e-commerce
    const hostname = this.domainGeneratorHelper.generateUnique(
      storeSlug,
      DomainContext.ECOMMERCE,
      existingHostnames,
    );

    // Get store to get the name for branding
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { name: true, organization_id: true }
    });

    // Get branding from org domain to maintain consistency
    // We need to fetch it again or pass it, but effectively fetching from all domains is expensive if we just want one.
    // However, we already fetched `existingDomains` locally (only hostname).
    // Let's fetch the org branding explicitly for better accuracy.
    const orgDomain = await this.prisma.domain_settings.findFirst({
      where: {
        organization_id: store?.organization_id,
        ownership: 'vendix_subdomain',
        domain_type: 'organization'
      }
    });

    const orgBranding = (orgDomain?.config as any)?.branding || null;

    // Generate standardized branding for ecommerce
    const branding = this.brandingGeneratorHelper.generateBranding({
      name: store?.name || 'Vendix Shop',
      primaryColor: orgBranding?.primary_color,
      secondaryColor: orgBranding?.secondary_color,
      theme: orgBranding?.theme || 'light',
      logoUrl: orgBranding?.logo_url,
      faviconUrl: orgBranding?.favicon_url,
    });

    // Create domain settings for e-commerce
    await this.prisma.domain_settings.create({
      data: {
        hostname,
        store_id: storeId,
        domain_type: 'ecommerce',
        is_primary: false, // E-commerce domains are not primary (store domain is primary)
        ownership: 'vendix_subdomain',
        status: 'active',
        ssl_status: 'none',
        config: {
          app: 'STORE_ECOMMERCE',
          branding: branding,
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return hostname;
  }
}

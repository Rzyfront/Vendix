import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async getDashboardStats() {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Start of current week (Monday)
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startOfWeek.setHours(0, 0, 0, 0);

    // Get current stats and last month stats for growth calculation
    const [
      // Current counts
      totalOrganizations,
      totalUsers,
      activeStores,

      // Last month counts (for growth)
      lastMonthOrganizations,
      lastMonthUsers,
      lastMonthStores,

      // Top organizations by stores/users/revenue
      topOrganizationsData,

      // Recent activities
      recentOrganizations,
      recentUsers,
      recentStores,
    ] = await Promise.all([
      // Total organizations
      this.prisma.organizations.count(),

      // Total users
      this.prisma.users.count(),

      // Active stores
      this.prisma.stores.count({ where: { is_active: true } }),

      // Last month organizations (for growth)
      this.prisma.organizations.count({
        where: {
          created_at: { gte: lastMonthStart, lte: lastMonthEnd },
        },
      }),

      // Last month users (for growth)
      this.prisma.users.count({
        where: {
          created_at: { gte: lastMonthStart, lte: lastMonthEnd },
        },
      }),

      // Last month stores (for growth)
      this.prisma.stores.count({
        where: {
          created_at: { gte: lastMonthStart, lte: lastMonthEnd },
        },
      }),

      // Top organizations with stores/users count
      this.prisma.organizations.findMany({
        include: {
          _count: {
            select: { stores: true, users: true },
          },
        },
        orderBy: { stores: { _count: 'desc' } },
        take: 5,
      }),

      // Recent organizations created
      this.prisma.organizations.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: { id: true, name: true, created_at: true },
      }),

      // Recent users registered
      this.prisma.users.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: { id: true, first_name: true, last_name: true, email: true, created_at: true },
      }),

      // Recent stores created
      this.prisma.stores.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: { id: true, name: true, created_at: true },
      }),
    ]);

    // Calculate growth percentages
    const calculateGrowth = (current: number, lastMonth: number): number => {
      if (lastMonth === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - lastMonth) / lastMonth) * 100);
    };

    // Current month counts for growth calculation
    const currentMonthOrganizations = await this.prisma.organizations.count({
      where: { created_at: { gte: currentMonthStart } },
    });

    const currentMonthUsers = await this.prisma.users.count({
      where: { created_at: { gte: currentMonthStart } },
    });

    const currentMonthStores = await this.prisma.stores.count({
      where: { created_at: { gte: currentMonthStart } },
    });

    const organizationGrowth = calculateGrowth(currentMonthOrganizations, lastMonthOrganizations);
    const userGrowth = calculateGrowth(currentMonthUsers, lastMonthUsers);
    const storeGrowth = calculateGrowth(currentMonthStores, lastMonthStores);

    const platformGrowth = Math.round((organizationGrowth + userGrowth + storeGrowth) / 3);

    // Weekly data - get data for each day of the current week
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyData = await Promise.all(
      weekDays.map(async (day, index) => {
        const dayDate = new Date(startOfWeek);
        dayDate.setDate(startOfWeek.getDate() + index);
        dayDate.setHours(0, 0, 0, 0);

        const nextDayDate = new Date(dayDate);
        nextDayDate.setDate(dayDate.getDate() + 1);

        const [dayOrgs, dayUsers, dayStores] = await Promise.all([
          this.prisma.organizations.count({
            where: {
              created_at: { gte: dayDate, lt: nextDayDate },
            },
          }),
          this.prisma.users.count({
            where: {
              created_at: { gte: dayDate, lt: nextDayDate },
            },
          }),
          this.prisma.stores.count({
            where: {
              created_at: { gte: dayDate, lt: nextDayDate },
            },
          }),
        ]);

        return {
          week: day,
          organizations: dayOrgs,
          users: dayUsers,
          stores: dayStores,
        };
      }),
    );

    // Recent activities - combine and sort by timestamp
    const recentActivities = [
      ...recentOrganizations.map((org: any) => ({
        id: String(org.id),
        type: 'organization',
        action: 'create',
        description: 'Nueva organización creada',
        timestamp: org.created_at,
        entityName: org.name,
      })),
      ...recentUsers.map((user: any) => ({
        id: String(user.id),
        type: 'user',
        action: 'register',
        description: 'Nuevo usuario registrado',
        timestamp: user.created_at,
        entityName: `${user.first_name} ${user.last_name}`.trim() || user.email,
      })),
      ...recentStores.map((store: any) => ({
        id: String(store.id),
        type: 'store',
        action: 'create',
        description: 'Nueva tienda abierta',
        timestamp: store.created_at,
        entityName: store.name,
      })),
    ]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5);

    // Top organizations with revenue calculation
    const topOrganizations = await Promise.all(
      topOrganizationsData.map(async (org: any) => {
        // Calculate revenue from finished orders
        const revenueResult = await this.prisma.orders.aggregate({
          where: {
            stores: { organization_id: org.id },
            state: 'finished',
            created_at: { gte: currentMonthStart },
          },
          _sum: { grand_total: true },
        });

        // Calculate store growth (new stores this month vs last month)
        const currentMonthStoresCount = await this.prisma.stores.count({
          where: {
            organization_id: org.id,
            created_at: { gte: currentMonthStart },
          },
        });

        const lastMonthStoresCount = await this.prisma.stores.count({
          where: {
            organization_id: org.id,
            created_at: { gte: lastMonthStart, lte: lastMonthEnd },
          },
        });

        const growth = calculateGrowth(currentMonthStoresCount, lastMonthStoresCount);

        return {
          id: String(org.id),
          name: org.name,
          stores: org._count.stores,
          users: org._count.users,
          revenue: Number(revenueResult._sum.grand_total || 0),
          growth,
        };
      }),
    );

    return {
      totalOrganizations,
      totalUsers,
      activeStores,
      platformGrowth,
      organizationGrowth,
      userGrowth,
      storeGrowth,
      weeklyData,
      recentActivities,
      topOrganizations,
    };
  }
}

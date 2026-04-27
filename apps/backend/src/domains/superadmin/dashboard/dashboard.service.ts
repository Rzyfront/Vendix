import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async getDashboardStats() {
    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

    const dayOfWeek = now.getUTCDay();
    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    startOfWeek.setUTCHours(0, 0, 0, 0);

    const [
      totalOrganizations,
      totalUsers,
      activeStores,

      lastMonthOrganizations,
      lastMonthUsers,
      lastMonthStores,

      topOrganizationsData,

      recentOrganizations,
      recentUsers,
      recentStores,

      currentMonthOrganizations,
      currentMonthUsers,
      currentMonthStores,

      currentMonthRevenueAgg,
      lastMonthRevenueAgg,

      mrrAgg,

      totalSubscriptions,
      activeSubscriptions,
      graceSoftSubs,
      graceHardSubs,
      suspendedSubs,
      blockedSubs,

      cancelledThisMonth,
      expiredThisMonth,
      activeAtMonthStart,

      pendingInvoices,
      overdueInvoices,

      recentSubscriptionEvents,
      recentPayments,
    ] = await Promise.all([
      this.prisma.organizations.count(),
      this.prisma.users.count(),
      this.prisma.stores.count({ where: { is_active: true } }),

      this.prisma.organizations.count({
        where: { created_at: { gte: lastMonthStart, lte: lastMonthEnd } },
      }),
      this.prisma.users.count({
        where: { created_at: { gte: lastMonthStart, lte: lastMonthEnd } },
      }),
      this.prisma.stores.count({
        where: { created_at: { gte: lastMonthStart, lte: lastMonthEnd } },
      }),

      this.prisma.organizations.findMany({
        include: { _count: { select: { stores: true, users: true } } },
        orderBy: { stores: { _count: 'desc' } },
        take: 5,
      }),

      this.prisma.organizations.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: { id: true, name: true, created_at: true },
      }),
      this.prisma.users.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: { id: true, first_name: true, last_name: true, email: true, created_at: true },
      }),
      this.prisma.stores.findMany({
        orderBy: { created_at: 'desc' },
        take: 2,
        select: { id: true, name: true, created_at: true },
      }),

      this.prisma.organizations.count({
        where: { created_at: { gte: currentMonthStart } },
      }),
      this.prisma.users.count({
        where: { created_at: { gte: currentMonthStart } },
      }),
      this.prisma.stores.count({
        where: { created_at: { gte: currentMonthStart } },
      }),

      this.prisma.subscription_invoices.aggregate({
        where: {
          state: { in: ['paid', 'partially_paid'] },
          created_at: { gte: currentMonthStart },
        },
        _sum: { total: true },
      }),
      this.prisma.subscription_invoices.aggregate({
        where: {
          state: { in: ['paid', 'partially_paid'] },
          created_at: { gte: lastMonthStart, lte: lastMonthEnd },
        },
        _sum: { total: true },
      }),

      this.prisma.store_subscriptions.aggregate({
        where: { state: { in: ['active', 'trial', 'grace_soft'] } },
        _sum: { effective_price: true },
      }),

      this.prisma.store_subscriptions.count(),
      this.prisma.store_subscriptions.count({
        where: { state: { in: ['active', 'trial'] } },
      }),
      this.prisma.store_subscriptions.count({ where: { state: 'grace_soft' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'grace_hard' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'suspended' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'blocked' } }),

      this.prisma.store_subscriptions.count({
        where: {
          state: 'cancelled',
          updated_at: { gte: currentMonthStart },
        },
      }),
      this.prisma.store_subscriptions.count({
        where: {
          state: 'expired',
          updated_at: { gte: currentMonthStart },
        },
      }),
      this.prisma.store_subscriptions.count({
        where: {
          state: { in: ['active', 'trial', 'grace_soft', 'grace_hard'] },
          created_at: { lt: currentMonthStart },
        },
      }),

      this.prisma.subscription_invoices.count({
        where: { state: 'issued' },
      }),
      this.prisma.subscription_invoices.count({
        where: { state: 'overdue' },
      }),

      this.prisma.subscription_events.findMany({
        where: {
          type: { in: ['created', 'activated', 'payment_succeeded', 'state_transition'] },
          created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { created_at: 'desc' },
        take: 3,
        include: {
          store_subscription: {
            include: {
              store: {
                select: { name: true, organization_id: true },
              },
            },
          },
        },
      }),
      this.prisma.subscription_payments.findMany({
        where: {
          state: 'succeeded',
          paid_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { paid_at: 'desc' },
        take: 3,
        include: {
          invoice: {
            include: {
              store_subscription: {
                include: {
                  store: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const calculateGrowth = (current: number, lastMonth: number): number => {
      if (lastMonth === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - lastMonth) / lastMonth) * 100);
    };

    const organizationGrowth = calculateGrowth(currentMonthOrganizations, lastMonthOrganizations);
    const userGrowth = calculateGrowth(currentMonthUsers, lastMonthUsers);
    const storeGrowth = calculateGrowth(currentMonthStores, lastMonthStores);
    const platformGrowth = Math.round((organizationGrowth + userGrowth + storeGrowth) / 3);

    const currentMonthRevenue = Number(currentMonthRevenueAgg._sum.total || 0);
    const lastMonthRevenue = Number(lastMonthRevenueAgg._sum.total || 0);
    const revenueGrowth = calculateGrowth(currentMonthRevenue, lastMonthRevenue);

    const mrr = Number(mrrAgg._sum.effective_price ?? new Prisma.Decimal(0));

    const graceSubscriptions = graceSoftSubs + graceHardSubs;
    const suspendedSubscriptions = suspendedSubs + blockedSubs;

    const churnRate =
      activeAtMonthStart > 0
        ? Math.round(((cancelledThisMonth + expiredThisMonth) / activeAtMonthStart) * 10000) / 100
        : 0;

    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyData = await Promise.all(
      weekDays.map(async (day, index) => {
        const dayDate = new Date(startOfWeek);
        dayDate.setUTCDate(startOfWeek.getUTCDate() + index);
        dayDate.setUTCHours(0, 0, 0, 0);
        const nextDayDate = new Date(dayDate);
        nextDayDate.setUTCDate(dayDate.getUTCDate() + 1);

        const [dayOrgs, dayUsers, dayStores] = await Promise.all([
          this.prisma.organizations.count({
            where: { created_at: { gte: dayDate, lt: nextDayDate } },
          }),
          this.prisma.users.count({
            where: { created_at: { gte: dayDate, lt: nextDayDate } },
          }),
          this.prisma.stores.count({
            where: { created_at: { gte: dayDate, lt: nextDayDate } },
          }),
        ]);

        return { week: day, organizations: dayOrgs, users: dayUsers, stores: dayStores };
      }),
    );

    const monthlyTrend = await this.getMonthlyTrend(now);

    const recentActivities = [
      ...recentOrganizations.map((org: any) => ({
        id: `org-${org.id}`,
        type: 'organization',
        action: 'create',
        description: 'Nueva organización creada',
        timestamp: org.created_at,
        entityName: org.name,
      })),
      ...recentUsers.map((user: any) => ({
        id: `user-${user.id}`,
        type: 'user',
        action: 'register',
        description: 'Nuevo usuario registrado',
        timestamp: user.created_at,
        entityName: `${user.first_name} ${user.last_name}`.trim() || user.email,
      })),
      ...recentStores.map((store: any) => ({
        id: `store-${store.id}`,
        type: 'store',
        action: 'create',
        description: 'Nueva tienda abierta',
        timestamp: store.created_at,
        entityName: store.name,
      })),
      ...recentSubscriptionEvents.map((evt: any) => ({
        id: `sub-evt-${evt.id}`,
        type: 'subscription',
        action: evt.type,
        description: this.getSubscriptionEventDescription(evt.type),
        timestamp: evt.created_at,
        entityName: evt.store_subscription?.store?.name || 'Tienda',
      })),
      ...recentPayments.map((pay: any) => ({
        id: `pay-${pay.id}`,
        type: 'payment',
        action: 'payment_succeeded',
        description: 'Pago de suscripción recibido',
        timestamp: pay.paid_at,
        entityName:
          pay.invoice?.store_subscription?.store?.name || 'Tienda',
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);

    const topOrganizations = await Promise.all(
      topOrganizationsData.map(async (org: any) => {
        const orgStoreIds = await this.prisma.stores.findMany({
          where: { organization_id: org.id },
          select: { id: true },
        });
        const storeIds = orgStoreIds.map((s: any) => s.id);

        let revenue = 0;
        if (storeIds.length > 0) {
          const revenueResult = await this.prisma.subscription_invoices.aggregate({
            where: {
              store_id: { in: storeIds },
              state: { in: ['paid', 'partially_paid'] },
              created_at: { gte: currentMonthStart },
            },
            _sum: { total: true },
          });
          revenue = Number(revenueResult._sum.total || 0);
        }

        const currentMonthStoresCount = await this.prisma.stores.count({
          where: { organization_id: org.id, created_at: { gte: currentMonthStart } },
        });
        const lastMonthStoresCount = await this.prisma.stores.count({
          where: {
            organization_id: org.id,
            created_at: { gte: lastMonthStart, lte: lastMonthEnd },
          },
        });

        const growth = calculateGrowth(currentMonthStoresCount, lastMonthStoresCount);

        let subscriptionState: string | null = null;
        if (storeIds.length > 0) {
          const latestSub = await this.prisma.store_subscriptions.findFirst({
            where: { store_id: { in: storeIds } },
            orderBy: { updated_at: 'desc' },
            select: { state: true },
          });
          subscriptionState = latestSub?.state || null;
        }

        return {
          id: String(org.id),
          name: org.name,
          stores: org._count.stores,
          users: org._count.users,
          revenue,
          growth,
          isPartner: org.is_partner || false,
          subscriptionState,
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

      currentMonthRevenue,
      lastMonthRevenue,
      revenueGrowth,
      mrr,

      totalSubscriptions,
      activeSubscriptions,
      graceSubscriptions,
      suspendedSubscriptions,
      pendingInvoices,
      overdueInvoices,
      churnRate,

      weeklyData,
      monthlyTrend,
      recentActivities,
      topOrganizations,
    };
  }

  private async getMonthlyTrend(now: Date) {
    const months: { month: string; revenue: number; newOrganizations: number; newUsers: number; newStores: number; newSubscriptions: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59));

      const monthLabel = monthStart.toLocaleString('en-US', { month: 'short' });

      const [revenueAgg, orgs, users, stores, subs] = await Promise.all([
        this.prisma.subscription_invoices.aggregate({
          where: {
            state: { in: ['paid', 'partially_paid'] },
            created_at: { gte: monthStart, lte: monthEnd },
          },
          _sum: { total: true },
        }),
        this.prisma.organizations.count({
          where: { created_at: { gte: monthStart, lte: monthEnd } },
        }),
        this.prisma.users.count({
          where: { created_at: { gte: monthStart, lte: monthEnd } },
        }),
        this.prisma.stores.count({
          where: { created_at: { gte: monthStart, lte: monthEnd } },
        }),
        this.prisma.store_subscriptions.count({
          where: { created_at: { gte: monthStart, lte: monthEnd } },
        }),
      ]);

      months.push({
        month: monthLabel,
        revenue: Number(revenueAgg._sum.total || 0),
        newOrganizations: orgs,
        newUsers: users,
        newStores: stores,
        newSubscriptions: subs,
      });
    }

    return months;
  }

  private getSubscriptionEventDescription(type: string): string {
    const descriptions: Record<string, string> = {
      created: 'Nueva suscripción creada',
      activated: 'Suscripción activada',
      payment_succeeded: 'Pago de suscripción exitoso',
      state_transition: 'Cambio de estado de suscripción',
      plan_changed: 'Cambio de plan',
      renewed: 'Suscripción renovada',
      trial_started: 'Trial iniciado',
      cancelled: 'Suscripción cancelada',
    };
    return descriptions[type] || 'Evento de suscripción';
  }
}

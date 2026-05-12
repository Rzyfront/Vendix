import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

interface ResolveScopeParams {
  store_id_filter?: number | null;
}

/**
 * Sales reports consolidados para ORG_ADMIN.
 *
 * Default: agrega ventas de todas las tiendas de la organización en contexto.
 * Cuando se pasa `?store_id=X` (validado contra la org), el reporte se reduce
 * a esa tienda — breakdown solicitado por el ORG_ADMIN.
 *
 * Las queries usan `OrganizationPrismaService.getScopedWhere` para construir
 * el `where` correcto según `operating_scope` (consolidado vs filtrado por
 * tienda) y `getStoreIdsForOrg` para expandir a todas las tiendas activas.
 */
@Injectable()
export class OrgSalesReportsService {
  private readonly logger = new Logger(OrgSalesReportsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  /**
   * Resuelve los `store_ids` que aplican al reporte según el operating_scope
   * y el filtro opcional. Devuelve también el `scope` resuelto y la org.
   */
  private async resolveStoreIds(
    params: ResolveScopeParams,
  ): Promise<{
    organization_id: number;
    store_ids: number[];
    is_breakdown: boolean;
  }> {
    const organization_id = this.requireOrgId();
    const scope = await this.operatingScope.requireOperatingScope(
      organization_id,
    );

    if (params.store_id_filter != null) {
      // Validar pertenencia + delegar al helper Prisma para asertar.
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter: params.store_id_filter,
      });
      return {
        organization_id,
        store_ids: [params.store_id_filter],
        is_breakdown: true,
      };
    }

    if (scope === 'STORE') {
      // En STORE scope, el filtro es obligatorio. Replicamos el contrato del
      // helper para emitir el mismo error (BadRequestException) si falta.
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter: null,
      });
    }

    const store_ids = await this.orgPrisma.getStoreIdsForOrg(organization_id);
    return { organization_id, store_ids, is_breakdown: false };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reports
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Resumen de ventas: totales por estado + totales agregados de la org.
   * Si `store_id` se pasa, devuelve solo esa tienda.
   */
  async getSalesSummary(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
  }) {
    const { store_ids } = await this.resolveStoreIds({
      store_id_filter: params.store_id ?? null,
    });

    if (store_ids.length === 0) {
      return {
        totals: {
          orders_count: 0,
          gross_revenue: 0,
          net_revenue: 0,
          tax_amount: 0,
          discount_amount: 0,
        },
        by_state: [],
      };
    }

    const where: Prisma.ordersWhereInput = {
      store_id: { in: store_ids },
      state: { notIn: ['cancelled', 'refunded'] },
      ...this.buildDateRange(params.date_from, params.date_to),
    };

    const [byState, aggregate] = await Promise.all([
      this.prisma.orders.groupBy({
        by: ['state'],
        where,
        _count: { _all: true },
        _sum: {
          grand_total: true,
          subtotal_amount: true,
          tax_amount: true,
          discount_amount: true,
        },
      }),
      this.prisma.orders.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          grand_total: true,
          subtotal_amount: true,
          tax_amount: true,
          discount_amount: true,
        },
      }),
    ]);

    return {
      totals: {
        orders_count: aggregate._count._all,
        gross_revenue: this.toNumber(aggregate._sum.grand_total),
        net_revenue: this.toNumber(aggregate._sum.subtotal_amount),
        tax_amount: this.toNumber(aggregate._sum.tax_amount),
        discount_amount: this.toNumber(aggregate._sum.discount_amount),
      },
      by_state: byState.map((row) => ({
        state: row.state,
        orders_count: row._count._all,
        gross_revenue: this.toNumber(row._sum.grand_total),
        net_revenue: this.toNumber(row._sum.subtotal_amount),
        tax_amount: this.toNumber(row._sum.tax_amount),
        discount_amount: this.toNumber(row._sum.discount_amount),
      })),
    };
  }

  /**
   * Desglose de ventas por tienda. Útil para ver el aporte de cada canal/tienda
   * dentro de una organización consolidada. Si `store_id` se pasa, devuelve un
   * único renglón con esa tienda.
   */
  async getSalesByStore(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
  }) {
    const { store_ids } = await this.resolveStoreIds({
      store_id_filter: params.store_id ?? null,
    });

    if (store_ids.length === 0) {
      return [];
    }

    const where: Prisma.ordersWhereInput = {
      store_id: { in: store_ids },
      state: { notIn: ['cancelled', 'refunded'] },
      ...this.buildDateRange(params.date_from, params.date_to),
    };

    const grouped = await this.prisma.orders.groupBy({
      by: ['store_id'],
      where,
      _count: { _all: true },
      _sum: {
        grand_total: true,
        subtotal_amount: true,
        tax_amount: true,
        discount_amount: true,
      },
    });

    const stores = await this.prisma.stores.findMany({
      where: { id: { in: store_ids } },
      select: { id: true, name: true, slug: true },
    });
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    return grouped
      .map((row) => {
        const store = storeMap.get(row.store_id);
        return {
          store_id: row.store_id,
          store_name: store?.name ?? '—',
          store_slug: store?.slug ?? null,
          orders_count: row._count._all,
          gross_revenue: this.toNumber(row._sum.grand_total),
          net_revenue: this.toNumber(row._sum.subtotal_amount),
          tax_amount: this.toNumber(row._sum.tax_amount),
          discount_amount: this.toNumber(row._sum.discount_amount),
        };
      })
      .sort((a, b) => b.gross_revenue - a.gross_revenue);
  }

  /**
   * Ventas por canal (POS, ecommerce, etc.) consolidadas por la org.
   */
  async getSalesByChannel(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
  }) {
    const { store_ids } = await this.resolveStoreIds({
      store_id_filter: params.store_id ?? null,
    });

    if (store_ids.length === 0) {
      return [];
    }

    const where: Prisma.ordersWhereInput = {
      store_id: { in: store_ids },
      state: { notIn: ['cancelled', 'refunded'] },
      ...this.buildDateRange(params.date_from, params.date_to),
    };

    const grouped = await this.prisma.orders.groupBy({
      by: ['channel'],
      where,
      _count: { _all: true },
      _sum: { grand_total: true, subtotal_amount: true },
    });

    return grouped.map((row) => ({
      channel: row.channel,
      orders_count: row._count._all,
      gross_revenue: this.toNumber(row._sum.grand_total),
      net_revenue: this.toNumber(row._sum.subtotal_amount),
    }));
  }

  /**
   * Top productos vendidos (por unidades) cruzando `order_items` con `orders`
   * filtradas por la org.
   */
  async getTopProducts(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
    limit?: number;
  }) {
    const { store_ids } = await this.resolveStoreIds({
      store_id_filter: params.store_id ?? null,
    });

    if (store_ids.length === 0) {
      return [];
    }

    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    const orderWhere: Prisma.ordersWhereInput = {
      store_id: { in: store_ids },
      state: { notIn: ['cancelled', 'refunded'] },
      ...this.buildDateRange(params.date_from, params.date_to),
    };

    const grouped = await this.prisma.order_items.groupBy({
      by: ['product_id', 'product_name'],
      where: { orders: orderWhere },
      _sum: { quantity: true, total_price: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });

    return grouped.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      units_sold: row._sum?.quantity ?? 0,
      revenue: this.toNumber(row._sum?.total_price),
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private buildDateRange(
    date_from?: string,
    date_to?: string,
  ): Prisma.ordersWhereInput {
    if (!date_from && !date_to) return {};
    const range: Prisma.DateTimeNullableFilter = {};
    if (date_from) range.gte = new Date(date_from);
    if (date_to) range.lte = new Date(date_to);
    return { created_at: range };
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined): number {
    if (value == null) return 0;
    if (value instanceof Prisma.Decimal) {
      return Number(value.toFixed(2));
    }
    return Number(value);
  }
}

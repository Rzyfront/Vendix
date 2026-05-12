import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

import { SubscriptionResolverService } from '../../../store/subscriptions/services/subscription-resolver.service';
import { SubscriptionAccessService } from '../../../store/subscriptions/services/subscription-access.service';
import {
  FEATURE_QUOTA_CONFIG,
  AI_FEATURE_KEYS,
} from '../../../store/subscriptions/types/access.types';

/**
 * Org-level subscription orchestration. Centralises:
 *   - Validation that a `store_id` belongs to the current ORG context.
 *   - Read-only consolidations (overview stats, cross-store invoice listings,
 *     per-store subscription summaries) backed by the canonical
 *     `store_subscriptions` / `subscription_invoices` tables.
 *   - The org→store impersonation helper used by the controller to delegate
 *     mutating flows (checkout preview/commit) to the existing store-side
 *     services without duplicating their logic.
 *
 * Read flows lean on `OrganizationPrismaService.getStoreIdsForOrg(orgId)` so
 * they always honour the multi-tenant boundary; mutating flows pin the
 * store_id into `RequestContext` for the duration of the delegated call.
 */
@Injectable()
export class OrgSubscriptionsService {
  private readonly logger = new Logger(OrgSubscriptionsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly resolver: SubscriptionResolverService,
    private readonly access: SubscriptionAccessService,
  ) {}

  /**
   * Resolve and validate the organization in context. Throws when the JWT
   * carries no `organization_id` (should not happen behind the
   * DomainScopeGuard but defensive anyway).
   */
  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  /**
   * Asserts the given `store_id` belongs to the current org. Returns the
   * resolved store row (with organization eager-loaded for downstream needs)
   * to avoid a second roundtrip in callers.
   */
  async assertStoreInOrg(storeId: number) {
    const orgId = this.requireOrgId();
    if (!storeId || !Number.isFinite(storeId)) {
      throw new BadRequestException('storeId is required');
    }
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId, organization_id: orgId },
      select: { id: true, organization_id: true, name: true, slug: true },
    });
    if (!store) {
      throw new ForbiddenException(
        'Store does not belong to the current organization',
      );
    }
    return store;
  }

  /**
   * Run a callback while pinning a target `store_id` into the request
   * context. Used to delegate ORG mutations (checkout preview/commit) to the
   * existing store-side services without rewiring their RequestContext
   * dependency.
   */
  async runWithStoreContext<T>(
    storeId: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    await this.assertStoreInOrg(storeId);
    const ctx = RequestContextService.getContext();
    if (!ctx) {
      throw new ForbiddenException('Request context not available');
    }
    const previousStoreId = ctx.store_id;
    try {
      RequestContextService.setDomainContext(storeId, ctx.organization_id);
      return await callback();
    } finally {
      // Restore previous store_id (typically undefined for ORG_ADMIN).
      ctx.store_id = previousStoreId;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read flows (consolidated)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Lightweight per-org overview: store/subscription counts, sum of effective
   * prices for live subscriptions, and accrued partner commissions for orgs
   * marked `is_partner=true`.
   */
  async getOverviewStats() {
    const orgId = this.requireOrgId();
    const storeIds = await this.orgPrisma.getStoreIdsForOrg(orgId);

    if (storeIds.length === 0) {
      return {
        active_stores: 0,
        active_subscriptions: 0,
        monthly_revenue: 0,
        partner_commissions: 0,
        currency: 'COP',
      };
    }

    const [activeStores, allSubs, partnerCommissions] = await Promise.all([
      this.prisma.stores.count({
        where: { organization_id: orgId, is_active: true },
      }),
      this.prisma.store_subscriptions.findMany({
        where: { store_id: { in: storeIds } },
        select: { state: true, effective_price: true, currency: true },
      }),
      this.prisma.partner_commissions.aggregate({
        where: { partner_organization_id: orgId, state: 'accrued' },
        _sum: { amount: true },
      }),
    ]);

    const liveStates = new Set([
      'active',
      'trial',
      'past_due',
      'grace_soft',
      'grace_hard',
      'pending_payment',
    ]);
    const activeSubscriptions = allSubs.filter((s) =>
      liveStates.has(s.state as string),
    );

    const monthlyRevenue = activeSubscriptions.reduce(
      (acc, s) => acc.add(new Prisma.Decimal(s.effective_price ?? 0)),
      new Prisma.Decimal(0),
    );

    const currency = activeSubscriptions[0]?.currency ?? 'COP';

    return {
      active_stores: activeStores,
      active_subscriptions: activeSubscriptions.length,
      monthly_revenue: Number(monthlyRevenue.toFixed(2)),
      partner_commissions: Number(
        (partnerCommissions._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      ),
      currency,
    };
  }

  /**
   * Returns one row per store under the org, joined with its
   * `store_subscription` (or `null` when the store has not subscribed yet).
   * Mirrors the shape consumed by the org overview table.
   */
  async listStoreSubscriptions() {
    const orgId = this.requireOrgId();
    const stores = await this.prisma.stores.findMany({
      where: { organization_id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        subscription: {
          include: {
            plan: true,
            partner_override: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return stores
      .filter((s) => s.subscription)
      .map((s) => this.mapToOrgStoreSubscription(s));
  }

  /**
   * Detail of one store's subscription. Resolves the live features snapshot
   * via `SubscriptionResolverService` so the org admin sees what the gate
   * would actually allow.
   */
  async getStoreSubscriptionDetail(storeId: number) {
    await this.assertStoreInOrg(storeId);
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        slug: true,
        subscription: {
          include: {
            plan: true,
            paid_plan: true,
            pending_plan: true,
            partner_override: { include: { base_plan: true } },
          },
        },
      },
    });

    if (!store?.subscription) {
      return null;
    }

    const resolved = await this.resolver.resolveSubscription(storeId);

    return {
      ...this.mapToOrgStoreSubscription(store),
      raw: store.subscription,
      resolved_features: resolved.features,
    };
  }

  /**
   * Paginated invoices across every store of the organization. Optional
   * `store_id` filter narrows to a single store (validated to belong to the
   * org).
   */
  async listInvoices(params: {
    page: number;
    limit: number;
    sort_by: string;
    sort_order: 'asc' | 'desc';
    store_id?: number;
  }) {
    const orgId = this.requireOrgId();
    const storeIds = await this.orgPrisma.getStoreIdsForOrg(orgId);

    if (storeIds.length === 0) {
      return { data: [], total: 0 };
    }

    let scopedStoreIds: number[] = storeIds;
    if (params.store_id != null) {
      await this.assertStoreInOrg(params.store_id);
      scopedStoreIds = [params.store_id];
    }

    const skip = (params.page - 1) * params.limit;
    const orderBy = { [params.sort_by]: params.sort_order } as any;

    const where: Prisma.subscription_invoicesWhereInput = {
      store_id: { in: scopedStoreIds },
    };

    const [data, total] = await Promise.all([
      this.prisma.subscription_invoices.findMany({
        where,
        skip,
        take: params.limit,
        orderBy,
      }),
      this.prisma.subscription_invoices.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Single invoice scoped to the org (any of its stores). Returns the full
   * include shape used by the customer-facing detail view.
   */
  async getInvoice(invoiceId: number) {
    const orgId = this.requireOrgId();
    const storeIds = await this.orgPrisma.getStoreIdsForOrg(orgId);
    const invoice = await this.prisma.subscription_invoices.findFirst({
      where: {
        id: invoiceId,
        store_id: { in: storeIds },
      },
      include: {
        store_subscription: {
          include: {
            plan: true,
            store: { include: { organizations: true } },
          },
        },
        commission: true,
      },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Invoice not found',
      );
    }

    return invoice;
  }

  /**
   * Resolve invoice ownership for the PDF flow. Returns the `store_id` so
   * the caller can pass it into `SubscriptionInvoicePdfService.generatePdf`
   * which re-validates the binding defensively.
   */
  async resolveInvoiceStoreId(invoiceId: number): Promise<number> {
    const orgId = this.requireOrgId();
    const storeIds = await this.orgPrisma.getStoreIdsForOrg(orgId);
    const invoice = await this.prisma.subscription_invoices.findFirst({
      where: {
        id: invoiceId,
        store_id: { in: storeIds },
      },
      select: { store_id: true },
    });
    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Invoice not found',
      );
    }
    return invoice.store_id;
  }

  /**
   * Per-store AI usage snapshot for the ORG_ADMIN usage-tracker widget.
   * Mirrors the store-side `/store/subscriptions/usage` endpoint but the
   * `store_id` is provided by the ORG_ADMIN explicitly and validated against
   * the organization in context.
   *
   * The Redis quota counters are scoped by `store_id`, so we pin the target
   * store into RequestContext via `runWithStoreContext` before resolving
   * subscription features and reading the period-keyed quota counters.
   */
  async getStoreUsage(storeId: number): Promise<{
    features: Record<
      string,
      { used: number; cap: number | null; period: 'daily' | 'monthly' }
    >;
  }> {
    return this.runWithStoreContext(storeId, async () => {
      const resolved = await this.resolver.resolveSubscription(storeId);

      if (!resolved.found) {
        return { features: {} };
      }

      const features: Record<
        string,
        { used: number; cap: number | null; period: 'daily' | 'monthly' }
      > = {};

      for (const feature of AI_FEATURE_KEYS) {
        const quotaCfg = FEATURE_QUOTA_CONFIG[feature];
        const featureConfig = resolved.features[feature];

        if (!quotaCfg || !featureConfig) continue;

        const cap = featureConfig[quotaCfg.capField];
        const period = quotaCfg.period;

        const periodKey = this.getPeriodKey(period);
        const key = `ai:quota:${storeId}:${feature}:${periodKey}`;
        let used = 0;

        try {
          used = await this.access.getQuotaUsed(key);
        } catch {
          used = 0;
        }

        features[feature] = {
          used,
          cap: typeof cap === 'number' && cap > 0 ? cap : null,
          period,
        };
      }

      return { features };
    });
  }

  private getPeriodKey(period: 'daily' | 'monthly'): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    if (period === 'monthly') return `${y}${m}`;
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private mapToOrgStoreSubscription(store: any): any {
    const sub = store.subscription;
    if (!sub) {
      return {
        id: null,
        store_id: store.id,
        store_name: store.name,
        store_slug: store.slug,
        plan_name: '',
        plan_id: null,
        state: 'none',
        effective_price: 0,
        currency: 'COP',
        next_billing_at: null,
        trial_ends_at: null,
        current_period_start: null,
        current_period_end: null,
        created_at: null,
        updated_at: null,
      };
    }

    let split_breakdown: Record<string, unknown> | undefined;
    if (sub.partner_override) {
      const marginPct = new Prisma.Decimal(sub.partner_override.margin_pct ?? 0);
      const basePrice = new Prisma.Decimal(sub.vendix_base_price ?? 0);
      const partnerShare = new Prisma.Decimal(sub.partner_margin_amount ?? 0);
      split_breakdown = {
        vendix_share: Number(basePrice.toFixed(2)),
        partner_share: Number(partnerShare.toFixed(2)),
        margin_pct: marginPct.toFixed(2),
        partner_org_id: sub.partner_override.organization_id,
      };
    }

    return {
      id: String(sub.id),
      store_id: store.id,
      store_name: store.name,
      store_slug: store.slug,
      plan_name: sub.plan?.name ?? '',
      plan_id: sub.plan_id != null ? String(sub.plan_id) : null,
      state: sub.state,
      effective_price: Number(
        new Prisma.Decimal(sub.effective_price ?? 0).toFixed(2),
      ),
      currency: sub.currency ?? 'COP',
      next_billing_at: sub.next_billing_at,
      trial_ends_at: sub.trial_ends_at,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
      ...(split_breakdown ? { split_breakdown } : {}),
    };
  }
}

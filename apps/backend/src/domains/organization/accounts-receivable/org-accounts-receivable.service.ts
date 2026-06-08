import { BadRequestException, Injectable } from '@nestjs/common';

import { AccountsReceivableService as StoreAccountsReceivableService } from '../../store/accounts-receivable/accounts-receivable.service';
import { ArAgingService } from '../../store/accounts-receivable/services/ar-aging.service';
import { ArCollectionService } from '../../store/accounts-receivable/services/ar-collection.service';
import { PaymentAgreementService } from '../../store/accounts-receivable/services/payment-agreement.service';
import { ArQueryDto } from '../../store/accounts-receivable/dto/ar-query.dto';
import { RegisterArPaymentDto } from '../../store/accounts-receivable/dto/register-ar-payment.dto';
import { CreatePaymentAgreementDto } from '../../store/accounts-receivable/dto/create-payment-agreement.dto';

import { OrgAccountingScopeService } from '../accounting/org-accounting-scope.service';

/**
 * Org-native accounts-receivable (cartera CxC) service. Mirrors the store-side
 * cartera (`/api/store/accounts-receivable`) so the ORG_ADMIN frontend can read
 * and operate on receivables under its own domain without duplicating any
 * business logic.
 *
 * `accounts_receivable` is an OPERATIONAL record (scoped by `store_id` +
 * `organization_id`; it has NO `accounting_entity_id`). Scope is therefore
 * resolved through the operating-/fiscal-scope helper exactly like the wave-1
 * org siblings (withholding / exogenous / ica):
 *
 * - STORE fiscal scope, or an explicit `?store_id` → pin that store into the
 *   request context (`runWithStoreContext`) and delegate to the store service.
 * - ORGANIZATION fiscal scope with no `store_id` → consolidate across every
 *   active store of the org: iterate `getStoreIdsForOrg()`, run the store
 *   method per store, then aggregate (list rows concat; dashboard/aging SUM the
 *   numeric buckets/totals; upcoming/overdue concat with a `store_id` tag).
 *
 * Writes (payment / agreement / write-off) MUST target a concrete store: a
 * consolidated write with no `store_id` is ambiguous and is rejected with a
 * `BadRequestException`.
 */
@Injectable()
export class OrgAccountsReceivableService {
  constructor(
    private readonly orgScope: OrgAccountingScopeService,
    private readonly arService: StoreAccountsReceivableService,
    private readonly agingService: ArAgingService,
    private readonly collectionService: ArCollectionService,
    private readonly agreementService: PaymentAgreementService,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  /**
   * Paginated list. STORE / explicit store → delegate. Consolidated ORG →
   * concat rows of every active store and re-page in memory (each per-store
   * page is small; the totals reflect the consolidated dataset).
   */
  async list(query: ArQueryDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.arService.findAll(query),
      );
    }

    // Consolidated ORGANIZATION read: pull every active store unpaginated,
    // merge, then page over the merged set so totals are organization-wide.
    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const per_store = await Promise.all(
      store_ids.map((id) =>
        this.orgScope.runWithStoreContext(id, () =>
          // Request a large page per store so we can re-page consolidated.
          this.arService.findAll({ ...query, page: 1, limit: 1000 }),
        ),
      ),
    );

    const merged = per_store.flatMap((r) => r.data);
    const total = merged.length;
    const start = (page - 1) * limit;
    const data = merged.slice(start, start + limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── AGING REPORT ──────────────────────────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → run per store and
   * SUM the aging buckets + total + record_count; merge `top_customers` and
   * re-rank to the global top 10.
   */
  async getAging(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      const report = await this.orgScope.runWithStoreContext(
        scope.store_id!,
        () => this.agingService.getAgingReport(),
      );
      return {
        scope: 'STORE' as const,
        store_id: scope.store_id!,
        ...report,
      };
    }

    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const per_store = await Promise.all(
      store_ids.map(async (id) => ({
        store_id: id,
        report: await this.orgScope.runWithStoreContext(id, () =>
          this.agingService.getAgingReport(),
        ),
      })),
    );

    const buckets = {
      current: 0,
      days_1_30: 0,
      days_31_60: 0,
      days_61_90: 0,
      days_91_120: 0,
      days_120_plus: 0,
    };
    let total = 0;
    let record_count = 0;
    const customer_totals: Record<
      number,
      { customer_id: number; customer_name: string; total: number }
    > = {};

    for (const { report } of per_store) {
      buckets.current += report.buckets.current;
      buckets.days_1_30 += report.buckets.days_1_30;
      buckets.days_31_60 += report.buckets.days_31_60;
      buckets.days_61_90 += report.buckets.days_61_90;
      buckets.days_91_120 += report.buckets.days_91_120;
      buckets.days_120_plus += report.buckets.days_120_plus;
      total += report.total;
      record_count += report.record_count;
      for (const c of report.top_customers) {
        const existing = customer_totals[c.customer_id];
        if (existing) {
          existing.total += c.total;
        } else {
          customer_totals[c.customer_id] = { ...c };
        }
      }
    }

    return {
      scope: 'ORGANIZATION' as const,
      organization_id: scope.organization_id,
      buckets: this.roundBuckets(buckets),
      total: this.round(total),
      record_count,
      top_customers: Object.values(customer_totals)
        .map((c) => ({ ...c, total: this.round(c.total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      stores: store_ids,
    };
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → run per store and
   * SUM each KPI (amounts + counts) plus `collected_this_month`.
   */
  async getDashboard(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      const dashboard = await this.orgScope.runWithStoreContext(
        scope.store_id!,
        () => this.arService.getDashboard(),
      );
      return {
        scope: 'STORE' as const,
        store_id: scope.store_id!,
        ...dashboard,
      };
    }

    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const per_store = await Promise.all(
      store_ids.map((id) =>
        this.orgScope.runWithStoreContext(id, () =>
          this.arService.getDashboard(),
        ),
      ),
    );

    const total_pending = { amount: 0, count: 0 };
    const total_overdue = { amount: 0, count: 0 };
    const due_soon = { amount: 0, count: 0 };
    let collected_this_month = 0;

    for (const d of per_store) {
      total_pending.amount += d.total_pending.amount;
      total_pending.count += d.total_pending.count;
      total_overdue.amount += d.total_overdue.amount;
      total_overdue.count += d.total_overdue.count;
      due_soon.amount += d.due_soon.amount;
      due_soon.count += d.due_soon.count;
      collected_this_month += d.collected_this_month;
    }

    return {
      scope: 'ORGANIZATION' as const,
      organization_id: scope.organization_id,
      total_pending: {
        amount: this.round(total_pending.amount),
        count: total_pending.count,
      },
      total_overdue: {
        amount: this.round(total_overdue.amount),
        count: total_overdue.count,
      },
      due_soon: {
        amount: this.round(due_soon.amount),
        count: due_soon.count,
      },
      collected_this_month: this.round(collected_this_month),
      stores: store_ids,
    };
  }

  // ─── COLLECTION: UPCOMING DUE ─────────────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → concat the upcoming
   * rows of every active store, each tagged with its `store_id`, sorted by
   * `due_date`.
   */
  async getUpcoming(store_id_filter?: number, days?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.collectionService.getUpcomingDue(days),
      );
    }

    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const per_store = await Promise.all(
      store_ids.map((id) =>
        this.orgScope.runWithStoreContext(id, () =>
          this.collectionService.getUpcomingDue(days),
        ),
      ),
    );

    return per_store
      .flat()
      .sort(
        (a, b) =>
          new Date(a.due_date).getTime() - new Date(b.due_date).getTime(),
      );
  }

  // ─── COLLECTION: OVERDUE BY CUSTOMER ──────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → concat each store's
   * per-customer overdue groups (tagged with `store_id`), sorted by total
   * overdue. We do NOT merge the same customer across stores: a customer is
   * tracked per store, matching how `accounts_receivable` rows are owned.
   */
  async getOverdueByCustomer(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.collectionService.getOverdueByCustomer(),
      );
    }

    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const per_store = await Promise.all(
      store_ids.map(async (id) => {
        const groups = await this.orgScope.runWithStoreContext(id, () =>
          this.collectionService.getOverdueByCustomer(),
        );
        return groups.map((g) => ({ ...g, store_id: id }));
      }),
    );

    return per_store
      .flat()
      .sort((a, b) => b.total_overdue - a.total_overdue);
  }

  // ─── DETAIL ────────────────────────────────────────────────
  /**
   * Detail lookup. In consolidated ORG mode the `accounts_receivable` row is
   * store-owned, so we must locate it across stores: try each active store
   * (scoped) until the row is found.
   */
  async findOne(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.arService.findOne(id),
      );
    }

    const store_ids = await this.orgScope.getStoreIdsForOrg();
    for (const sid of store_ids) {
      try {
        return await this.orgScope.runWithStoreContext(sid, () =>
          this.arService.findOne(id),
        );
      } catch {
        // Not in this store (NotFound) — keep scanning the org's stores.
      }
    }

    throw new BadRequestException(
      `Cuenta por cobrar #${id} no encontrada en la organización`,
    );
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  async registerPayment(
    id: number,
    dto: RegisterArPaymentDto,
    user_id: number,
    store_id_filter?: number,
  ) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.arService.registerPayment(id, dto, user_id),
    );
  }

  // ─── CREATE PAYMENT AGREEMENT ──────────────────────────────
  async createAgreement(
    id: number,
    dto: CreatePaymentAgreementDto,
    user_id: number,
    store_id_filter?: number,
  ) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.agreementService.create(id, dto, user_id),
    );
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  async writeOff(id: number, user_id: number, store_id_filter?: number) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.arService.writeOff(id, user_id),
    );
  }

  /**
   * Resolve the concrete `store_id` a write must target. A receivable is
   * store-owned, so registering a payment / agreement / write-off in
   * consolidated ORGANIZATION mode without a `store_id` is ambiguous and is
   * rejected. When fiscal_scope=STORE (or the org has a single store) the
   * scope resolver fills `store_id` automatically.
   */
  private async requireStoreForWrite(
    store_id_filter?: number,
  ): Promise<number> {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });
    if (scope.store_id == null) {
      throw new BadRequestException(
        'store_id is required to register a payment/agreement/write-off at organization scope',
      );
    }
    return scope.store_id;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundBuckets<T extends Record<string, number>>(buckets: T): T {
    const out = {} as Record<string, number>;
    for (const [key, value] of Object.entries(buckets)) {
      out[key] = this.round(value);
    }
    return out as T;
  }
}

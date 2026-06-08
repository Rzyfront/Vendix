import { BadRequestException, Injectable } from '@nestjs/common';

import { AccountsPayableService as StoreAccountsPayableService } from '../../store/accounts-payable/accounts-payable.service';
import { ApAgingService } from '../../store/accounts-payable/services/ap-aging.service';
import { ApSchedulingService } from '../../store/accounts-payable/services/ap-scheduling.service';
import { ApBankExportService } from '../../store/accounts-payable/services/ap-bank-export.service';
import { ApQueryDto } from '../../store/accounts-payable/dto/ap-query.dto';
import { RegisterApPaymentDto } from '../../store/accounts-payable/dto/register-ap-payment.dto';
import { ScheduleApPaymentDto } from '../../store/accounts-payable/dto/schedule-ap-payment.dto';

import { OrgAccountingScopeService } from '../accounting/org-accounting-scope.service';

/**
 * Org-native accounts-payable (cartera CxP) service. Mirrors the store-side
 * cartera (`/api/store/accounts-payable`) so the ORG_ADMIN frontend can read
 * and operate on payables under its own domain without duplicating any
 * business logic.
 *
 * `accounts_payable` is an OPERATIONAL record (`organization_id` + nullable
 * `store_id`; it has NO `accounting_entity_id`). Scope is resolved through the
 * fiscal-scope helper exactly like the wave-1 org siblings (withholding /
 * exogenous / ica):
 *
 * - STORE fiscal scope, or an explicit `?store_id` → pin that store into the
 *   request context (`runWithStoreContext`) and delegate to the store service.
 * - ORGANIZATION fiscal scope with no `store_id` → consolidated org-wide read.
 *
 * IMPORTANT SCOPING NOTE — differs from the `accounts_receivable` org sibling:
 *   In `StorePrismaService`, `accounts_receivable` is a STORE-scoped model
 *   (filtered by `store_id`), so its org consolidation iterates every store and
 *   concats. `accounts_payable`, by contrast, is registered in the
 *   ORGANIZATION-scoped list (filtered by `organization_id` only — see
 *   `org_scoped_models` in `store-prisma.service.ts`). The store service
 *   therefore ALREADY returns the full org-wide payables dataset for any store
 *   context. Iterating per store + concatenating (the AR pattern) would
 *   DOUBLE-COUNT every payable (N stores × the same org-wide set). So for
 *   consolidated ORGANIZATION reads we delegate to the store service exactly
 *   ONCE, pinning a single pivot store purely to satisfy the request-context
 *   requirement — no aggregation/iteration is needed because the data layer
 *   already consolidates. (Money-rounding helpers are unused for the same
 *   reason; nothing is summed here.)
 *
 * Writes (payment / schedule / cancel / write-off) MUST target a concrete
 * store: a consolidated write with no `store_id` is ambiguous and is rejected
 * with a `BadRequestException`. The bank batch-export likewise requires a
 * concrete store — a bank file must target one store's payables.
 */
@Injectable()
export class OrgAccountsPayableService {
  constructor(
    private readonly orgScope: OrgAccountingScopeService,
    private readonly apService: StoreAccountsPayableService,
    private readonly agingService: ApAgingService,
    private readonly schedulingService: ApSchedulingService,
    private readonly bankExportService: ApBankExportService,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  /**
   * Paginated list. STORE / explicit store → delegate. Consolidated ORG →
   * delegate ONCE via a pivot store: `accounts_payable` is org-scoped at the
   * data layer, so the store service already returns the full org-wide set.
   */
  async list(query: ApQueryDto, store_id_filter?: number) {
    const store_id = await this.resolveReadStoreContext(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.apService.findAll(query),
    );
  }

  // ─── AGING REPORT ──────────────────────────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → delegate ONCE; the
   * aging report already aggregates the full org-wide payables.
   */
  async getAging(store_id_filter?: number) {
    const store_id = await this.resolveReadStoreContext(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.agingService.getAgingReport(),
    );
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → delegate ONCE; the
   * dashboard already aggregates the full org-wide payables.
   */
  async getDashboard(store_id_filter?: number) {
    const store_id = await this.resolveReadStoreContext(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.apService.getDashboard(),
    );
  }

  // ─── UPCOMING SCHEDULES ────────────────────────────────────
  /**
   * STORE / explicit store → delegate. Consolidated ORG → delegate ONCE; the
   * upcoming schedules read already spans the full org-wide payables.
   */
  async getUpcoming(store_id_filter?: number, days?: number) {
    const store_id = await this.resolveReadStoreContext(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.schedulingService.getUpcomingSchedules(days ?? 7),
    );
  }

  // ─── DETAIL ────────────────────────────────────────────────
  /**
   * Detail lookup. `accounts_payable` is org-scoped, so a single pivot store
   * context already exposes any payable owned by the organization — no
   * cross-store scan is required.
   */
  async findOne(id: number, store_id_filter?: number) {
    const store_id = await this.resolveReadStoreContext(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.apService.findOne(id),
    );
  }

  // ─── BATCH EXPORT ──────────────────────────────────────────
  /**
   * Generate a bank batch-export file. A bank file must target ONE store's
   * payables, so this is treated as a write-class operation: a `store_id` is
   * required even though the export only reads. In consolidated ORGANIZATION
   * mode without a `store_id` it is rejected.
   */
  async batchExport(
    body: { supplier_ids?: number[]; date_from?: string; date_to?: string },
    store_id_filter?: number,
  ) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.bankExportService.generateBatchExport(body),
    );
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  async registerPayment(
    id: number,
    dto: RegisterApPaymentDto,
    user_id: number,
    store_id_filter?: number,
  ) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.apService.registerPayment(id, dto, user_id),
    );
  }

  // ─── SCHEDULE PAYMENT ──────────────────────────────────────
  async schedulePayment(
    id: number,
    dto: ScheduleApPaymentDto,
    store_id_filter?: number,
  ) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.schedulingService.schedulePayment(id, dto),
    );
  }

  // ─── CANCEL SCHEDULE ───────────────────────────────────────
  async cancelSchedule(scheduleId: number, store_id_filter?: number) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.schedulingService.cancelSchedule(scheduleId),
    );
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  async writeOff(id: number, user_id: number, store_id_filter?: number) {
    const store_id = await this.requireStoreForWrite(store_id_filter);
    return this.orgScope.runWithStoreContext(store_id, () =>
      this.apService.writeOff(id, user_id),
    );
  }

  /**
   * Resolve a `store_id` to pin as request context for a read. Because
   * `accounts_payable` is org-scoped at the data layer, the concrete store is
   * irrelevant to the result set — it only satisfies the store-service's
   * context requirement. When fiscal_scope=STORE (or the org has a single
   * store) the resolver fills `store_id`; in consolidated ORGANIZATION mode we
   * pick any active store of the org as a pivot.
   */
  private async resolveReadStoreContext(
    store_id_filter?: number,
  ): Promise<number> {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });
    if (scope.store_id != null) {
      return scope.store_id;
    }
    return this.pickPivotStoreId();
  }

  /**
   * Resolve the concrete `store_id` a write must target. A payment / schedule /
   * cancel / write-off / bank-export in consolidated ORGANIZATION mode without
   * a `store_id` is ambiguous and is rejected. When fiscal_scope=STORE (or the
   * org has a single store) the scope resolver fills `store_id` automatically.
   */
  private async requireStoreForWrite(
    store_id_filter?: number,
  ): Promise<number> {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });
    if (scope.store_id == null) {
      throw new BadRequestException(
        'store_id is required to register a payment/schedule/cancel/write-off/export at organization scope',
      );
    }
    return scope.store_id;
  }

  /**
   * Pick any active store of the org as a pivot for consolidated ORGANIZATION
   * reads. The store context is only needed to satisfy the store-service's
   * `RequestContext` requirement; the payables it returns are org-wide
   * regardless of which store is pinned.
   */
  private async pickPivotStoreId(): Promise<number> {
    const store_ids = await this.orgScope.getStoreIdsForOrg();
    if (store_ids.length === 0) {
      throw new BadRequestException(
        'Organization has no active stores to read accounts payable',
      );
    }
    return store_ids[0];
  }
}

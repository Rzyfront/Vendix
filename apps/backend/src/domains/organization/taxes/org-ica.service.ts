import { Injectable } from '@nestjs/common';

import { IcaService as StoreIcaService } from '../../store/taxes/ica.service';
import {
  IcaRatesQueryDto,
  IcaCalculateDto,
  IcaReportQueryDto,
} from '../../store/taxes/dto';

import { OrgAccountingScopeService } from '../accounting/org-accounting-scope.service';

/**
 * Org-native ICA municipal service. Mirrors the store-side `IcaService`
 * (`/api/store/taxes/ica`) so the ORG_ADMIN frontend can read rates,
 * resolve/calculate ICA, and pull consolidated reports under its own domain
 * without duplicating any tax logic.
 *
 * Scope model (see `vendix-fiscal-scope`):
 *
 * - ICA municipal `rates` come from a GLOBAL reference table
 *   (`ica_municipal_rates`), not a store/org-scoped one. `findAllRates` and
 *   `calculateICA` therefore delegate straight to the store service — they
 *   need no store/tenant pin.
 * - `resolve` (a store's effective rate from its address + CIIU) and `report`
 *   (per-store aggregation of `invoice_taxes`) are inherently per-store. We
 *   resolve the effective fiscal scope:
 *     - `fiscal_scope=STORE` (or an explicit `store_id`) → delegate to the
 *       store service via `runWithStoreContext(store_id, …)`.
 *     - `fiscal_scope=ORGANIZATION` with no `store_id` → iterate every active
 *       store of the org and aggregate per-store results (sum totals, concat
 *       the municipality breakdown).
 */
@Injectable()
export class OrgIcaService {
  constructor(
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeIca: StoreIcaService,
  ) {}

  /**
   * Global rate catalogue lookup. No store/tenant context required — the
   * underlying table is org-agnostic, so we call the store service directly.
   */
  async findAllRates(query: IcaRatesQueryDto) {
    return this.storeIca.findAllRates(query);
  }

  /**
   * Global rate calculation. No store/tenant context required.
   */
  async calculateICA(dto: IcaCalculateDto) {
    return this.storeIca.calculateICA(
      dto.amount,
      dto.municipality_code,
      dto.ciiu_code,
    );
  }

  /**
   * Resolve the effective ICA rate.
   *
   * - STORE fiscal scope (or an explicit `store_id`) → resolve that store's
   *   rate from its primary address + CIIU.
   * - ORGANIZATION fiscal scope with no `store_id` → resolve per active store
   *   and return the breakdown (each store may sit in a different
   *   municipality / CIIU, so there is no single org-wide rate).
   */
  async resolveStoreIcaRate(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      const resolved = await this.orgScope.runWithStoreContext(
        scope.store_id!,
        () => this.storeIca.resolveStoreIcaRate(),
      );
      return {
        scope: 'STORE' as const,
        store_id: scope.store_id!,
        rate: resolved,
      };
    }

    // Consolidated ORGANIZATION read with no specific store: resolve every
    // active store's effective rate and return the per-store breakdown.
    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const stores = await Promise.all(
      store_ids.map(async (id) => ({
        store_id: id,
        rate: await this.orgScope.runWithStoreContext(id, () =>
          this.storeIca.resolveStoreIcaRate(),
        ),
      })),
    );

    return {
      scope: 'ORGANIZATION' as const,
      organization_id: scope.organization_id,
      stores,
    };
  }

  /**
   * ICA report by period.
   *
   * - STORE fiscal scope (or an explicit `store_id`) → delegate the per-store
   *   `getIcaReport` (reads store-scoped `invoice_taxes`).
   * - ORGANIZATION fiscal scope with no `store_id` → run the per-store report
   *   for every active store and aggregate: sum `total_base` / `total_ica` /
   *   `invoice_count` and concat the municipality `breakdown`.
   */
  async getIcaReport(query: IcaReportQueryDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE' || scope.store_id != null) {
      const report = await this.orgScope.runWithStoreContext(
        scope.store_id!,
        () => this.storeIca.getIcaReport(query.period),
      );
      return {
        scope: 'STORE' as const,
        store_id: scope.store_id!,
        ...report,
      };
    }

    // Consolidated ORGANIZATION report: aggregate every active store.
    const store_ids = await this.orgScope.getStoreIdsForOrg();
    const per_store = await Promise.all(
      store_ids.map(async (id) => ({
        store_id: id,
        report: await this.orgScope.runWithStoreContext(id, () =>
          this.storeIca.getIcaReport(query.period),
        ),
      })),
    );

    let total_base = 0;
    let total_ica = 0;
    let invoice_count = 0;
    const breakdown: Array<Record<string, unknown>> = [];
    let date_range: { start: string; end: string } | undefined;

    for (const { store_id, report } of per_store) {
      total_base += report.total_base;
      total_ica += report.total_ica;
      invoice_count += report.invoice_count;
      date_range = report.date_range;
      for (const entry of report.breakdown) {
        breakdown.push({ ...entry, store_id });
      }
    }

    return {
      scope: 'ORGANIZATION' as const,
      organization_id: scope.organization_id,
      period: query.period,
      date_range,
      total_base: Math.round(total_base * 100) / 100,
      total_ica: Math.round(total_ica * 100) / 100,
      invoice_count,
      breakdown,
      stores: store_ids,
    };
  }
}

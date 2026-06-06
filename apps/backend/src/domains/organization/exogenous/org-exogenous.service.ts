import { Injectable } from '@nestjs/common';

import { OrgAccountingScopeService } from '../accounting/org-accounting-scope.service';
import { ExogenousService } from '../../store/exogenous/exogenous.service';
import { GenerateReportDto, QueryReportsDto } from '../../store/exogenous/dto';

/**
 * Org-native DIAN exogenous (información exógena) reports.
 *
 * Mirrors `/store/exogenous` under `/organization/exogenous` so the ORG_ADMIN
 * frontend can read/write under its own domain without duplicating the
 * exogenous business logic. All work is delegated to the store-side
 * `ExogenousService` (single source of truth for generation, validation and
 * file building).
 *
 * Consolidation path (chosen after studying `ExogenousService`):
 * the store service filters every read by `context.organization_id` and only
 * narrows by `store_id` *when* `context.store_id` is present. It accesses the
 * raw Prisma client (`exogenous_reports` is not registered in
 * `OrganizationPrismaService`) with a manual `organization_id` filter. So:
 *
 *  - `fiscal_scope === 'STORE'` → a store must be targeted. We pin it via
 *    `runWithStoreContext` so the store service narrows by that store.
 *  - `fiscal_scope === 'ORGANIZATION'`:
 *      - with a `store_id` filter → pin that store for a per-store breakdown.
 *      - without a `store_id` filter → call the store service **directly** in
 *        the current ORG_ADMIN context. `organization_id` is already populated
 *        from the JWT and `store_id` is undefined, so the store service
 *        produces a naturally consolidated org-wide read (and correctly
 *        includes org-level reports where `store_id IS NULL`, which a per-store
 *        iteration would miss). No SQL is duplicated.
 *
 * For writes (`generateReport`, `submitReport`) the same rule applies: in
 * consolidated ORGANIZATION mode the report is created with `store_id = null`
 * (org-level); when a store is targeted it is created/located under that store.
 */
@Injectable()
export class OrgExogenousService {
  constructor(
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeExogenous: ExogenousService,
  ) {}

  /**
   * Run a delegated store call either pinned to a specific store (STORE scope,
   * or ORGANIZATION scope with an explicit `store_id` filter) or directly in
   * the current org context (consolidated ORGANIZATION read/write).
   */
  private async runScoped<T>(
    store_id_filter: number | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.store_id != null) {
      // STORE fiscal scope, or ORGANIZATION + explicit store_id filter:
      // narrow to the targeted store.
      return this.orgScope.runWithStoreContext(scope.store_id, callback);
    }

    // ORGANIZATION fiscal scope, no store filter → consolidated org-wide read
    // in the current context (organization_id set, store_id undefined).
    return callback();
  }

  async getReports(query: QueryReportsDto, store_id_filter?: number) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.findAll(query),
    );
  }

  async generateReport(dto: GenerateReportDto, store_id_filter?: number) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.generateReport(dto),
    );
  }

  async getReport(id: number, store_id_filter?: number) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.findOne(id),
    );
  }

  async getReportLines(
    id: number,
    page: number,
    limit: number,
    store_id_filter?: number,
  ) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.getReportLines(id, page, limit),
    );
  }

  async submitReport(id: number, store_id_filter?: number) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.markAsSubmitted(id),
    );
  }

  async validateYear(fiscal_year: number, store_id_filter?: number) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.validateYear(fiscal_year),
    );
  }

  async getStats(fiscal_year: number, store_id_filter?: number) {
    return this.runScoped(store_id_filter, () =>
      this.storeExogenous.getStats(fiscal_year),
    );
  }
}

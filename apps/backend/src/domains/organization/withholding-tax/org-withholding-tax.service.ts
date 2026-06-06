import { Injectable } from '@nestjs/common';

import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

import { WithholdingTaxService as StoreWithholdingTaxService } from '../../store/withholding-tax/withholding-tax.service';
import {
  CreateWithholdingConceptDto,
  UpdateWithholdingConceptDto,
  CalculateWithholdingDto,
} from '../../store/withholding-tax/dto';

import { OrgAccountingScopeService } from '../accounting/org-accounting-scope.service';

/**
 * Org-native withholding-tax (retenciones).
 *
 * Mirrors `/api/store/withholding-tax` so the ORG_ADMIN frontend can
 * read/write under its own domain without duplicating business logic.
 *
 * The underlying models (`withholding_concepts`, `uvt_values`,
 * `withholding_calculations`) are organization-scoped (filtered by
 * `organization_id`, fiscally pinned by `accounting_entity_id`). The
 * store-side `WithholdingTaxService` resolves the correct accounting entity
 * from `RequestContext` via `FiscalScopeService.resolveAccountingEntityForFiscal`:
 *
 *  - fiscal_scope=ORGANIZATION → the resolver returns the single consolidated
 *    org entity regardless of the pinned store, so delegating through a pivot
 *    store yields consolidated reads/writes against the ORG entity.
 *  - fiscal_scope=STORE → caller targets a store; the resolver returns that
 *    store's fiscal entity.
 *
 * In both cases we delegate to the existing store-side service by pinning a
 * store into `RequestContext` (`runWithStoreContext`), preserving the single
 * source of truth for withholding rules.
 */
@Injectable()
export class OrgWithholdingTaxService {
  constructor(
    private readonly fiscalScope: FiscalScopeService,
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeWithholdingTax: StoreWithholdingTaxService,
  ) {}

  // ===== Concepts =====

  async findAllConcepts(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.findAllConcepts(),
    );
  }

  async createConcept(dto: CreateWithholdingConceptDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.createConcept(dto),
    );
  }

  async updateConcept(
    id: number,
    dto: UpdateWithholdingConceptDto,
    store_id_filter?: number,
  ) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.updateConcept(id, dto),
    );
  }

  async deactivateConcept(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.deactivateConcept(id),
    );
  }

  // ===== UVT Values =====

  async findAllUvt(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.findAllUvt(),
    );
  }

  async createUvt(
    data: { year: number; value_cop: number },
    store_id_filter?: number,
  ) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.createUvt(data),
    );
  }

  // ===== Calculate =====

  async calculateWithholding(dto: CalculateWithholdingDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () =>
        this.storeWithholdingTax.calculateWithholding(
          dto.amount,
          dto.concept_code,
          dto.supplier_type,
        ),
    );
  }

  // ===== Stats =====

  async getStats(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeWithholdingTax.getStats(),
    );
  }

  /**
   * Pick any active store of the current org as a pivot when delegating in
   * ORGANIZATION fiscal mode. The store-side service always inspects
   * `RequestContext`, but the accounting_entity it resolves comes from
   * `fiscal_scope`; when that is `ORGANIZATION` the resolved entity is the
   * consolidated ORG one regardless of the pinned pivot store, so the result
   * is consolidated. Throws when the org has no active stores.
   */
  private async pickPivotStoreId(): Promise<number> {
    const storeIds = await this.orgScope.getStoreIdsForOrg();
    if (storeIds.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Organization has no active stores',
      );
    }
    return storeIds[0];
  }
}

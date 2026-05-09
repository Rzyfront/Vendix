import { Injectable } from '@nestjs/common';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

import { FiscalPeriodsService as StoreFiscalPeriodsService } from '../../../store/accounting/fiscal-periods/fiscal-periods.service';
import { CreateFiscalPeriodDto } from '../../../store/accounting/fiscal-periods/dto/create-fiscal-period.dto';
import { UpdateFiscalPeriodDto } from '../../../store/accounting/fiscal-periods/dto/update-fiscal-period.dto';

import { OrgAccountingScopeService } from '../org-accounting-scope.service';

/**
 * Org-native fiscal periods.
 *
 * - operating_scope=ORGANIZATION → reads/writes the org-level
 *   `accounting_entity` directly via `OrganizationPrismaService`.
 * - operating_scope=STORE → delegates to the store service via
 *   `runWithStoreContext`, which resolves the per-store accounting_entity.
 *   `?store_id` selects the target store; otherwise the org's only active
 *   store is used.
 */
@Injectable()
export class OrgFiscalPeriodsService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeFiscalPeriods: StoreFiscalPeriodsService,
  ) {}

  async findAll(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    if (scope.operating_scope === 'STORE' || scope.store_id) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeFiscalPeriods.findAll(),
      );
    }

    const accountingEntity =
      await this.operatingScope.resolveAccountingEntity({
        organization_id: scope.organization_id,
        store_id: null,
      });

    return this.orgPrisma.fiscal_periods.findMany({
      where: { accounting_entity_id: accountingEntity.id },
      orderBy: { start_date: 'desc' },
      include: {
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        _count: { select: { accounting_entries: true } },
      },
    });
  }

  async findOne(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    if (scope.operating_scope === 'STORE' || scope.store_id) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeFiscalPeriods.findOne(id),
      );
    }

    const accountingEntity =
      await this.operatingScope.resolveAccountingEntity({
        organization_id: scope.organization_id,
        store_id: null,
      });

    const period = await this.orgPrisma.fiscal_periods.findFirst({
      where: { id, accounting_entity_id: accountingEntity.id },
      include: {
        closed_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
        _count: { select: { accounting_entries: true } },
      },
    });

    if (!period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }
    return period;
  }

  async create(dto: CreateFiscalPeriodDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });
    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeFiscalPeriods.create(dto),
    );
  }

  async update(
    id: number,
    dto: UpdateFiscalPeriodDto,
    store_id_filter?: number,
  ) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });
    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeFiscalPeriods.update(id, dto),
    );
  }

  async close(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });
    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeFiscalPeriods.close(id),
    );
  }

  async remove(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });
    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeFiscalPeriods.remove(id),
    );
  }

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

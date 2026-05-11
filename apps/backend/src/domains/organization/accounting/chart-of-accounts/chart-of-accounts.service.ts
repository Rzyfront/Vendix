import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

import { ChartOfAccountsService as StoreChartOfAccountsService } from '../../../store/accounting/chart-of-accounts/chart-of-accounts.service';
import { CreateAccountDto } from '../../../store/accounting/chart-of-accounts/dto/create-account.dto';
import { UpdateAccountDto } from '../../../store/accounting/chart-of-accounts/dto/update-account.dto';
import { QueryAccountDto } from '../../../store/accounting/chart-of-accounts/dto/query-account.dto';

import { OrgAccountingScopeService } from '../org-accounting-scope.service';

/**
 * Org-native chart of accounts.
 *
 * - operating_scope=ORGANIZATION → reads/writes the single ORG-scoped
 *   accounting_entity directly via `OrganizationPrismaService` (auto-scopes
 *   by `organization_id`). The accounting entity is materialised on demand
 *   by `OperatingScopeService.resolveAccountingEntity`.
 * - operating_scope=STORE → caller must provide `store_id`. We delegate to
 *   the existing store-side `ChartOfAccountsService` by pinning the store
 *   into RequestContext (no logic duplication).
 */
@Injectable()
export class OrgChartOfAccountsService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeChartOfAccounts: StoreChartOfAccountsService,
  ) {}

  async findAll(query: QueryAccountDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    if (scope.operating_scope === 'STORE' || scope.store_id) {
      // STORE scope or per-store breakdown — delegate to store service.
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeChartOfAccounts.findAll(query),
      );
    }

    // Consolidated ORG read.
    const accountingEntity =
      await this.operatingScope.resolveAccountingEntity({
        organization_id: scope.organization_id,
        store_id: null,
      });

    const where: Prisma.chart_of_accountsWhereInput = {
      accounting_entity_id: accountingEntity.id,
      ...(query.search && {
        OR: [
          { code: { contains: query.search, mode: 'insensitive' as const } },
          { name: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
      ...(query.account_type && { account_type: query.account_type as any }),
      ...(query.parent_id !== undefined && { parent_id: query.parent_id }),
      ...(query.level !== undefined && { level: query.level }),
      ...(query.accepts_entries !== undefined && {
        accepts_entries: query.accepts_entries,
      }),
      ...(query.is_active !== undefined && { is_active: query.is_active }),
    };

    if (query.tree) {
      return this.getTree(store_id_filter);
    }

    const take = query.limit ?? 100;
    const skip = query.offset ?? 0;

    return this.orgPrisma.chart_of_accounts.findMany({
      where,
      orderBy: { code: 'asc' },
      take,
      skip,
      include: {
        parent: { select: { id: true, code: true, name: true } },
        children: {
          select: {
            id: true,
            code: true,
            name: true,
            account_type: true,
            level: true,
          },
          orderBy: { code: 'asc' },
        },
      },
    });
  }

  async getTree(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    if (scope.operating_scope === 'STORE' || scope.store_id) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeChartOfAccounts.getTree(),
      );
    }

    const accountingEntity =
      await this.operatingScope.resolveAccountingEntity({
        organization_id: scope.organization_id,
        store_id: null,
      });

    const all_accounts = await this.orgPrisma.chart_of_accounts.findMany({
      where: { accounting_entity_id: accountingEntity.id },
      orderBy: { code: 'asc' },
      include: {
        children: {
          select: {
            id: true,
            code: true,
            name: true,
            account_type: true,
            nature: true,
            level: true,
            is_active: true,
            accepts_entries: true,
          },
          orderBy: { code: 'asc' },
        },
      },
    });

    return all_accounts.filter((account) => account.parent_id === null);
  }

  async findOne(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    if (scope.operating_scope === 'STORE' || scope.store_id) {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeChartOfAccounts.findOne(id),
      );
    }

    const accountingEntity =
      await this.operatingScope.resolveAccountingEntity({
        organization_id: scope.organization_id,
        store_id: null,
      });

    const account = await this.orgPrisma.chart_of_accounts.findFirst({
      where: { id, accounting_entity_id: accountingEntity.id },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        children: {
          select: {
            id: true,
            code: true,
            name: true,
            account_type: true,
            nature: true,
            level: true,
            is_active: true,
            accepts_entries: true,
          },
          orderBy: { code: 'asc' },
        },
      },
    });

    if (!account) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_001);
    }

    return account;
  }

  /**
   * Create an account. ORG mode targets the ORG accounting_entity; STORE
   * mode delegates to the store-side service which already resolves the
   * correct STORE entity.
   */
  async create(dto: CreateAccountDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      async () => {
        // For ORG mode the store pivot is irrelevant: the store service
        // resolves the accounting_entity by `operating_scope`, which returns
        // the ORG entity regardless of the store context pinned here.
        return this.storeChartOfAccounts.create(dto);
      },
    );
  }

  async update(id: number, dto: UpdateAccountDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeChartOfAccounts.update(id, dto),
    );
  }

  async remove(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeChartOfAccounts.remove(id),
    );
  }

  /**
   * Pick any active store of the current org as a pivot when delegating
   * write operations in ORGANIZATION mode. Required because the store-side
   * service always inspects RequestContext, but the accounting_entity it
   * resolves comes from `operating_scope`, which is `ORGANIZATION` here →
   * the entity is the ORG one regardless of the pivot.
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

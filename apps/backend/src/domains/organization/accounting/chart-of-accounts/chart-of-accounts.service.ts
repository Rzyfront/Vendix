import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

import { ChartOfAccountsService as StoreChartOfAccountsService } from '../../../store/accounting/chart-of-accounts/chart-of-accounts.service';
import { CreateAccountDto } from '../../../store/accounting/chart-of-accounts/dto/create-account.dto';
import { UpdateAccountDto } from '../../../store/accounting/chart-of-accounts/dto/update-account.dto';
import { QueryAccountDto } from '../../../store/accounting/chart-of-accounts/dto/query-account.dto';

import { OrgAccountingScopeService } from '../org-accounting-scope.service';

/**
 * Org-native chart of accounts.
 *
 * - fiscal_scope=ORGANIZATION → reads/writes the single ORG-scoped
 *   accounting_entity directly via `OrganizationPrismaService` (auto-scopes
 *   by `organization_id`). The accounting entity is materialised on demand
 *   by `FiscalScopeService.resolveAccountingEntityForFiscal`.
 * - fiscal_scope=STORE → caller must provide `store_id`. We delegate to
 *   the existing store-side `ChartOfAccountsService` by pinning the store
 *   into RequestContext (no logic duplication).
 */
@Injectable()
export class OrgChartOfAccountsService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeChartOfAccounts: StoreChartOfAccountsService,
  ) {}

  /**
   * Tenant-scoped `where` for the consolidated ORG read.
   *
   * Deliberately a copy of `ChartOfAccountsService.buildWhere` (store lane):
   * the two lanes must select the SAME rows for the same query string, and the
   * only reason this one exists separately is that it filters by the ORG
   * accounting entity instead of the store one.
   *
   * `ids` is the hydration path for server-search selectors. Omitting it here
   * was the defect: `AccountSelectComponent.writeValue` asks for `?ids=…` to
   * paint the account already stored in the form, and this branch answered
   * with the first N accounts by `code asc` instead. Every preloaded row then
   * rendered «Cuenta no encontrada» — an edit screen that looks like it lost
   * its data. When `ids` is present it pins the result set and `search` is
   * ignored, exactly as in the store lane (a selector never sends both).
   */
  private buildWhere(
    accountingEntityId: number,
    query: QueryAccountDto,
  ): Prisma.chart_of_accountsWhereInput {
    const {
      search,
      ids,
      account_type,
      parent_id,
      level,
      accepts_entries,
      is_active,
    } = query;

    return {
      accounting_entity_id: accountingEntityId,
      ...(ids?.length
        ? { id: { in: ids } }
        : search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' as const } },
                { name: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      ...(account_type && { account_type: account_type as any }),
      ...(parent_id !== undefined && { parent_id }),
      ...(level !== undefined && { level }),
      ...(accepts_entries !== undefined && { accepts_entries }),
      ...(is_active !== undefined && { is_active }),
    };
  }

  /**
   * Paginated listing, same envelope as the store lane
   * (`{ data, meta: { total, page, limit, total_pages } }`), so the controller
   * can hand it to `ResponseService.paginated()`.
   *
   * `data` stays the plain row array, so consumers that read `res.data` are
   * unaffected; `meta.total` is purely additive and is what lets a
   * server-search selector render an honest «Mostrando X de Y» instead of
   * repeating the page length as if it were the total.
   *
   * `?tree=true` is not a page and never reaches here — the controller routes
   * it to {@link getTree}, mirroring `ChartOfAccountsController.findAll`.
   */
  async findAllPaginated(query: QueryAccountDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE') {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeChartOfAccounts.findAllPaginated(query),
      );
    }

    // Consolidated ORG read.
    const accountingEntity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: scope.organization_id,
        store_id: null,
      });

    const where = this.buildWhere(accountingEntity.id, query);

    const limit = query.limit ?? 100;
    // `offset` is the selector-facing cursor; `page` stays supported for the
    // table-style consumers. Whichever arrives, both are reported back.
    const skip = query.offset ?? (query.page ? (query.page - 1) * limit : 0);
    const page = query.page ?? Math.floor(skip / limit) + 1;

    const [data, total] = await Promise.all([
      this.orgPrisma.chart_of_accounts.findMany({
        where,
        orderBy: { code: 'asc' },
        take: limit,
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
      }),
      this.orgPrisma.chart_of_accounts.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async getTree(store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE') {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeChartOfAccounts.getTree(),
      );
    }

    const accountingEntity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
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
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    if (scope.fiscal_scope === 'STORE') {
      return this.orgScope.runWithStoreContext(scope.store_id!, () =>
        this.storeChartOfAccounts.findOne(id),
      );
    }

    const accountingEntity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
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
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      async () => {
        // For ORG mode the store pivot is irrelevant: the store service
        // resolves the accounting_entity by `fiscal_scope`, which returns
        // the ORG entity regardless of the store context pinned here.
        return this.storeChartOfAccounts.create(dto);
      },
    );
  }

  async update(id: number, dto: UpdateAccountDto, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
      store_id_filter,
    });

    return this.orgScope.runWithStoreContext(
      scope.store_id ?? (await this.pickPivotStoreId()),
      () => this.storeChartOfAccounts.update(id, dto),
    );
  }

  async remove(id: number, store_id_filter?: number) {
    const scope = await this.orgScope.resolveEffectiveFiscalScope({
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

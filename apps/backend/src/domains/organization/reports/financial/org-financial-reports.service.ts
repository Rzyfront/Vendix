import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { OrgFinancialReportQueryDto } from '../dto/org-financial-report-query.dto';

/**
 * Reportes financieros (P&L, Balance, Trial Balance, General Ledger) para
 * ORG_ADMIN. Las queries son naturalmente org-wide cuando
 * `operating_scope=ORGANIZATION`; con `?store_id=X` opcional se filtran a una
 * tienda concreta (breakdown).
 *
 * Réplica funcional de `AccountingReportsService` usando
 * `OrganizationPrismaService` para que ORG_ADMIN no cruce a `/store/*`.
 */
@Injectable()
export class OrgFinancialReportsService {
  private readonly logger = new Logger(OrgFinancialReportsService.name);

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
   * Construye el `where` de `accounting_entries` según operating_scope + store
   * filter opcional. Lanza si la tienda no pertenece a la org o si el scope
   * es STORE y no se pasó store_id.
   */
  private async buildEntryWhere(
    fiscal_period_id: number,
    store_id_filter: number | null | undefined,
    accounting_entity_id_filter?: number | null,
    date_from?: string,
    date_to?: string,
  ): Promise<{
    organization_id: number;
    where: Prisma.accounting_entriesWhereInput;
  }> {
    const organization_id = this.requireOrgId();
    const scope = await this.operatingScope.requireOperatingScope(
      organization_id,
    );

    const fiscal_period = await this.orgPrisma.fiscal_periods.findFirst({
      where: { id: fiscal_period_id, organization_id },
    });
    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    const where: Prisma.accounting_entriesWhereInput = {
      organization_id,
      fiscal_period_id,
      status: 'posted',
    };

    if (accounting_entity_id_filter != null) {
      const accounting_entity =
        await this.prisma.withoutScope().accounting_entities.findFirst({
          where: { id: accounting_entity_id_filter, organization_id },
          select: { id: true, store_id: true },
        });
      if (!accounting_entity) {
        throw new VendixHttpException(
          ErrorCodes.FISCAL_SCOPE_ACCOUNTING_ENTITY_NOT_FOUND,
          'La entidad contable no pertenece a esta organización.',
          { accounting_entity_id: accounting_entity_id_filter },
        );
      }

      if (
        fiscal_period.accounting_entity_id != null &&
        fiscal_period.accounting_entity_id !== accounting_entity.id
      ) {
        throw new BadRequestException(
          'El periodo fiscal no pertenece a la entidad contable solicitada.',
        );
      }

      if (
        store_id_filter != null &&
        accounting_entity.store_id != null &&
        accounting_entity.store_id !== store_id_filter
      ) {
        throw new BadRequestException(
          'store_id no coincide con la entidad contable solicitada.',
        );
      }

      where.accounting_entity_id = accounting_entity.id;
    }

    if (store_id_filter != null) {
      // Validar pertenencia.
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter,
      });
      where.store_id = store_id_filter;
    } else if (scope === 'STORE') {
      // STORE scope: store_id obligatorio.
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter: null,
      });
    }

    if (date_from || date_to) {
      const range: Prisma.DateTimeFilter = {};
      if (date_from) range.gte = new Date(date_from);
      if (date_to) range.lte = new Date(date_to);
      where.entry_date = range;
    }

    return { organization_id, where };
  }

  /**
   * Trial balance: agrega debits/credits por cuenta dentro del period+filtro.
   */
  async getTrialBalance(query: OrgFinancialReportQueryDto) {
    const { where } = await this.buildEntryWhere(
      query.fiscal_period_id,
      query.store_id ?? null,
      query.accounting_entity_id ?? null,
      query.date_from,
      query.date_to,
    );

    const fiscal_period = await this.orgPrisma.fiscal_periods.findUnique({
      where: { id: query.fiscal_period_id },
    });

    const entries = await this.orgPrisma.accounting_entries.findMany({
      where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        fiscal_period,
        accounts: [],
        totals: { total_debit: 0, total_credit: 0 },
      };
    }

    const lines = await this.orgPrisma.accounting_entry_lines.groupBy({
      by: ['account_id'],
      where: { entry_id: { in: entry_ids } },
      _sum: { debit_amount: true, credit_amount: true },
    });

    const account_ids = lines.map((l) => l.account_id);
    const accounts = await this.orgPrisma.chart_of_accounts.findMany({
      where: { id: { in: account_ids } },
      orderBy: { code: 'asc' },
    });

    const account_map = new Map(accounts.map((a: any) => [a.id, a]));

    const trial_balance = lines
      .map((line) => {
        const account: any = account_map.get(line.account_id);
        const debit = Number(line._sum.debit_amount || 0);
        const credit = Number(line._sum.credit_amount || 0);
        return {
          account_id: line.account_id,
          account_code: account?.code || '',
          account_name: account?.name || '',
          account_type: account?.account_type || '',
          nature: account?.nature || '',
          total_debit: debit,
          total_credit: credit,
          balance: debit - credit,
        };
      })
      .sort((a, b) => a.account_code.localeCompare(b.account_code));

    const totals = trial_balance.reduce(
      (acc, item) => ({
        total_debit: acc.total_debit + item.total_debit,
        total_credit: acc.total_credit + item.total_credit,
      }),
      { total_debit: 0, total_credit: 0 },
    );

    return { fiscal_period, accounts: trial_balance, totals };
  }

  async getBalanceSheet(query: OrgFinancialReportQueryDto) {
    const trial_balance = await this.getTrialBalance(query);

    const assets = trial_balance.accounts.filter(
      (a) => a.account_type === 'asset',
    );
    const liabilities = trial_balance.accounts.filter(
      (a) => a.account_type === 'liability',
    );
    const equity = trial_balance.accounts.filter(
      (a) => a.account_type === 'equity',
    );

    const total_assets = assets.reduce((sum, a) => sum + a.balance, 0);
    const total_liabilities = liabilities.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const total_equity = equity.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );

    return {
      fiscal_period: trial_balance.fiscal_period,
      assets: { accounts: assets, total: total_assets },
      liabilities: { accounts: liabilities, total: total_liabilities },
      equity: { accounts: equity, total: total_equity },
      balance_check: {
        total_assets,
        total_liabilities_and_equity: total_liabilities + total_equity,
        is_balanced:
          Math.abs(total_assets - (total_liabilities + total_equity)) < 0.01,
      },
    };
  }

  async getIncomeStatement(query: OrgFinancialReportQueryDto) {
    const trial_balance = await this.getTrialBalance(query);

    const revenue_accounts = trial_balance.accounts.filter(
      (a) => a.account_type === 'revenue',
    );
    const expense_accounts = trial_balance.accounts.filter(
      (a) => a.account_type === 'expense',
    );

    const total_revenue = revenue_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const total_expenses = expense_accounts.reduce(
      (sum, a) => sum + Math.abs(a.balance),
      0,
    );
    const net_income = total_revenue - total_expenses;

    return {
      fiscal_period: trial_balance.fiscal_period,
      revenue: { accounts: revenue_accounts, total: total_revenue },
      expenses: { accounts: expense_accounts, total: total_expenses },
      net_income,
    };
  }

  async getGeneralLedger(query: OrgFinancialReportQueryDto) {
    if (!query.account_id) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        'account_id is required for general ledger report',
      );
    }

    const { organization_id, where } = await this.buildEntryWhere(
      query.fiscal_period_id,
      query.store_id ?? null,
      query.accounting_entity_id ?? null,
      query.date_from,
      query.date_to,
    );

    const fiscal_period = await this.orgPrisma.fiscal_periods.findUnique({
      where: { id: query.fiscal_period_id },
    });

    const account = await this.orgPrisma.chart_of_accounts.findFirst({
      where: { id: query.account_id, organization_id },
    });
    if (!account) {
      throw new NotFoundException('Account not found in this organization');
    }

    const entries = await this.orgPrisma.accounting_entries.findMany({
      where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    const lines = await this.orgPrisma.accounting_entry_lines.findMany({
      where: {
        account_id: query.account_id,
        entry_id: { in: entry_ids },
      },
      include: {
        entry: {
          select: {
            id: true,
            entry_number: true,
            entry_date: true,
            description: true,
            entry_type: true,
            store: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { entry: { entry_date: 'asc' } },
    });

    let running_balance = 0;
    const ledger_lines = lines.map((line) => {
      const debit = Number(line.debit_amount);
      const credit = Number(line.credit_amount);
      running_balance += debit - credit;

      return {
        line_id: line.id,
        entry_id: line.entry_id,
        entry_number: line.entry.entry_number,
        entry_date: line.entry.entry_date,
        entry_description: line.entry.description,
        entry_type: line.entry.entry_type,
        store: line.entry.store,
        line_description: line.description,
        debit_amount: debit,
        credit_amount: credit,
        running_balance,
      };
    });

    const totals = ledger_lines.reduce(
      (acc, line) => ({
        total_debit: acc.total_debit + line.debit_amount,
        total_credit: acc.total_credit + line.credit_amount,
      }),
      { total_debit: 0, total_credit: 0 },
    );

    return {
      fiscal_period,
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        account_type: account.account_type,
        nature: account.nature,
      },
      lines: ledger_lines,
      totals: { ...totals, final_balance: running_balance },
    };
  }
}

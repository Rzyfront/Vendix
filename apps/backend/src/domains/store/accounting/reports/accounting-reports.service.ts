import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { ReportQueryDto } from './dto/report-query.dto';
import {
  SubsidiaryLedgerByAccountQueryDto,
  SubsidiaryLedgerByThirdPartyQueryDto,
} from './dto/subsidiary-ledger-query.dto';

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Trial Balance: sums debit/credit by account for a fiscal period
   */
  async getTrialBalance(query: ReportQueryDto) {
    const fiscal_period = await this.validateFiscalPeriod(
      query.fiscal_period_id,
    );

    const entry_where: Prisma.accounting_entriesWhereInput = {
      fiscal_period_id: query.fiscal_period_id,
      status: 'posted',
      // store_id filter dropped (phase3-round2): StorePrismaService auto-scopes.
      ...(query.date_from && {
        entry_date: {
          gte: new Date(query.date_from),
          ...(query.date_to && { lte: new Date(query.date_to) }),
        },
      }),
    };

    // Get all posted entries for the period
    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
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

    // Aggregate by account
    const lines = await this.prisma.accounting_entry_lines.groupBy({
      by: ['account_id'],
      where: {
        entry_id: { in: entry_ids },
      },
      _sum: {
        debit_amount: true,
        credit_amount: true,
      },
    });

    // Get account details
    const account_ids = lines.map((l) => l.account_id);
    const accounts = await this.prisma.chart_of_accounts.findMany({
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

    return {
      fiscal_period,
      accounts: trial_balance,
      totals,
    };
  }

  /**
   * Balance Sheet: assets - liabilities = equity
   */
  async getBalanceSheet(query: ReportQueryDto) {
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

    // Signo por naturaleza: cuentas de naturaleza 'credit' (pasivo/patrimonio)
    // se muestran con su signo natural (CR - DR); un saldo contrario a
    // naturaleza (ej. devoluciones 4175) refleja negativo.
    // Ver skill vendix-accounting-rules: nunca Math.abs en saldos.
    const signedBalance = (a: any) =>
      a.nature === 'credit' ? -a.balance : a.balance;

    const total_assets = assets.reduce((sum, a) => sum + signedBalance(a), 0);
    const total_liabilities = liabilities.reduce(
      (sum, a) => sum + signedBalance(a),
      0,
    );
    const total_equity = equity.reduce((sum, a) => sum + signedBalance(a), 0);

    return {
      fiscal_period: trial_balance.fiscal_period,
      assets: {
        accounts: assets,
        total: total_assets,
      },
      liabilities: {
        accounts: liabilities,
        total: total_liabilities,
      },
      equity: {
        accounts: equity,
        total: total_equity,
      },
      balance_check: {
        total_assets,
        total_liabilities_and_equity: total_liabilities + total_equity,
        is_balanced:
          Math.abs(total_assets - (total_liabilities + total_equity)) < 0.01,
      },
    };
  }

  /**
   * Income Statement: revenue - expenses = net income
   */
  async getIncomeStatement(query: ReportQueryDto) {
    const trial_balance = await this.getTrialBalance(query);

    const revenue_accounts = trial_balance.accounts.filter(
      (a) => a.account_type === 'revenue',
    );
    const expense_accounts = trial_balance.accounts.filter(
      (a) => a.account_type === 'expense',
    );

    // Mismo criterio C3: signo por naturaleza. Revenue es credit-nature,
    // expense es debit-nature. Sin Math.abs — el signo refleja la realidad.
    const signedBalance = (a: any) =>
      a.nature === 'credit' ? -a.balance : a.balance;

    const total_revenue = revenue_accounts.reduce(
      (sum, a) => sum + signedBalance(a),
      0,
    );
    const total_expenses = expense_accounts.reduce(
      (sum, a) => sum + signedBalance(a),
      0,
    );
    const net_income = total_revenue - total_expenses;

    return {
      fiscal_period: trial_balance.fiscal_period,
      revenue: {
        accounts: revenue_accounts,
        total: total_revenue,
      },
      expenses: {
        accounts: expense_accounts,
        total: total_expenses,
      },
      net_income,
    };
  }

  /**
   * General Ledger: all entries for a specific account
   */
  async getGeneralLedger(query: ReportQueryDto) {
    if (!query.account_id) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        'account_id is required for general ledger report',
      );
    }

    const fiscal_period = await this.validateFiscalPeriod(
      query.fiscal_period_id,
    );

    // Validate account exists
    const account = await this.prisma.chart_of_accounts.findFirst({
      where: { id: query.account_id },
    });

    if (!account) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_001);
    }

    const entry_where: Prisma.accounting_entriesWhereInput = {
      fiscal_period_id: query.fiscal_period_id,
      status: 'posted',
      // store_id filter dropped (phase3-round2): StorePrismaService auto-scopes.
      ...(query.date_from && {
        entry_date: {
          gte: new Date(query.date_from),
          ...(query.date_to && { lte: new Date(query.date_to) }),
        },
      }),
    };

    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });

    const entry_ids = entries.map((e) => e.id);

    // Get all lines for this account in the period
    const lines = await this.prisma.accounting_entry_lines.findMany({
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

    // Calculate running balance
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
      totals: {
        ...totals,
        final_balance: running_balance,
      },
    };
  }

  private async validateFiscalPeriod(fiscal_period_id: number) {
    const period = await this.prisma.fiscal_periods.findFirst({
      where: { id: fiscal_period_id },
    });

    if (!period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    return period;
  }

  /**
   * Libro auxiliar jerárquico por rango de cuenta (arts. 48-55 C.Co: libro
   * auxiliar obligatorio para comerciantes). Resuelve la cuenta padre por
   * `account_code` y agrega TODAS sus hijas directas vía
   * `chart_of_accounts.parent_id` (jerarquía ya existente, sin migración).
   *
   * Signo por naturaleza (C3, commit 7739c9ba — reusa el mismo criterio, NO
   * Math.abs): cuentas credit-nature muestran CR - DR; debit-nature muestran
   * DR - CR. Un saldo contrario a naturaleza queda negativo a propósito para
   * que el contador lo detecte.
   */
  async getSubsidiaryLedgerByAccountRange(
    query: SubsidiaryLedgerByAccountQueryDto,
  ) {
    const parent_account = await this.prisma.chart_of_accounts.findFirst({
      where: { code: query.account_code },
    });

    if (!parent_account) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_001);
    }

    const children = await this.prisma.chart_of_accounts.findMany({
      where: { parent_id: parent_account.id },
      orderBy: { code: 'asc' },
    });

    const account_ids = [parent_account.id, ...children.map((c) => c.id)];

    const entry_where: Prisma.accounting_entriesWhereInput = {
      status: 'posted',
      ...(query.date_from && {
        entry_date: {
          gte: new Date(query.date_from),
          ...(query.date_to && { lte: new Date(query.date_to) }),
        },
      }),
    };

    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    const signedBalance = (nature: string, debit: number, credit: number) =>
      nature === 'credit' ? credit - debit : debit - credit;

    if (entry_ids.length === 0) {
      const accounts = [parent_account, ...children].map((a: any) => ({
        account_id: a.id,
        account_code: a.code,
        account_name: a.name,
        account_type: a.account_type,
        nature: a.nature,
        is_parent: a.id === parent_account.id,
        lines: [],
        total_debit: 0,
        total_credit: 0,
        closing_balance: 0,
      }));
      return {
        parent_account: {
          id: parent_account.id,
          code: parent_account.code,
          name: parent_account.name,
        },
        accounts,
        grand_total: { total_debit: 0, total_credit: 0, closing_balance: 0 },
      };
    }

    const lines = await this.prisma.accounting_entry_lines.findMany({
      where: {
        account_id: { in: account_ids },
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

    const account_map = new Map(
      [parent_account, ...children].map((a: any) => [a.id, a]),
    );

    // Running balance independiente por cuenta (padre e hijas no se mezclan).
    const running_balance_by_account = new Map<number, number>();
    const lines_by_account = new Map<number, any[]>();

    for (const line of lines) {
      const account: any = account_map.get(line.account_id);
      const debit = Number(line.debit_amount);
      const credit = Number(line.credit_amount);
      const prev_balance = running_balance_by_account.get(line.account_id) ?? 0;
      const delta = signedBalance(account.nature, debit, credit);
      const running_balance = prev_balance + delta;
      running_balance_by_account.set(line.account_id, running_balance);

      const bucket = lines_by_account.get(line.account_id) ?? [];
      bucket.push({
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
        third_party_id: line.third_party_id,
        third_party_type: line.third_party_type,
        third_party_name: line.third_party_name,
        third_party_tax_id: line.third_party_tax_id,
        running_balance,
      });
      lines_by_account.set(line.account_id, bucket);
    }

    let grand_total_debit = 0;
    let grand_total_credit = 0;
    let grand_total_balance = 0;

    const accounts = [parent_account, ...children].map((a: any) => {
      const account_lines = lines_by_account.get(a.id) ?? [];
      const total_debit = account_lines.reduce(
        (sum, l) => sum + l.debit_amount,
        0,
      );
      const total_credit = account_lines.reduce(
        (sum, l) => sum + l.credit_amount,
        0,
      );
      const closing_balance = running_balance_by_account.get(a.id) ?? 0;

      grand_total_debit += total_debit;
      grand_total_credit += total_credit;
      grand_total_balance += closing_balance;

      return {
        account_id: a.id,
        account_code: a.code,
        account_name: a.name,
        account_type: a.account_type,
        nature: a.nature,
        is_parent: a.id === parent_account.id,
        lines: account_lines,
        total_debit,
        total_credit,
        closing_balance,
      };
    });

    return {
      parent_account: {
        id: parent_account.id,
        code: parent_account.code,
        name: parent_account.name,
      },
      accounts,
      grand_total: {
        total_debit: grand_total_debit,
        total_credit: grand_total_credit,
        closing_balance: grand_total_balance,
      },
    };
  }

  /**
   * Libro auxiliar por tercero: todas las líneas cuyo snapshot histórico
   * (third_party_id/type, columnas M1+M2) coincide con el tercero solicitado.
   * Fidelidad histórica: el nombre/NIT mostrado es el snapshot GUARDADO en la
   * línea al momento del asiento, nunca releído desde customers/suppliers/
   * employees (exigencia exógena art. 631 ET — el NIT histórico no muta).
   */
  async getSubsidiaryLedgerByThirdParty(
    query: SubsidiaryLedgerByThirdPartyQueryDto,
  ) {
    const entry_where: Prisma.accounting_entriesWhereInput = {
      status: 'posted',
      ...(query.date_from && {
        entry_date: {
          gte: new Date(query.date_from),
          ...(query.date_to && { lte: new Date(query.date_to) }),
        },
      }),
    };

    const entries = await this.prisma.accounting_entries.findMany({
      where: entry_where,
      select: { id: true },
    });
    const entry_ids = entries.map((e) => e.id);

    if (entry_ids.length === 0) {
      return {
        third_party: {
          type: query.third_party_type,
          id: query.third_party_id,
          name: null,
          tax_id: null,
        },
        lines: [],
        totals: { total_debit: 0, total_credit: 0, final_balance: 0 },
      };
    }

    const lines = await this.prisma.accounting_entry_lines.findMany({
      where: {
        third_party_type: query.third_party_type,
        third_party_id: query.third_party_id,
        entry_id: { in: entry_ids },
      },
      include: {
        account: true,
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

    const signedBalance = (nature: string, debit: number, credit: number) =>
      nature === 'credit' ? credit - debit : debit - credit;

    let running_balance = 0;
    let snapshot_name: string | null = null;
    let snapshot_tax_id: string | null = null;

    const ledger_lines = lines.map((line: any) => {
      const debit = Number(line.debit_amount);
      const credit = Number(line.credit_amount);
      running_balance += signedBalance(line.account.nature, debit, credit);

      // Última ocurrencia no nula gana — el snapshot puede variar levemente
      // entre líneas antiguas (p.ej. mayúsculas) pero refleja siempre lo
      // guardado, nunca un lookup en vivo.
      if (line.third_party_name) snapshot_name = line.third_party_name;
      if (line.third_party_tax_id) snapshot_tax_id = line.third_party_tax_id;

      return {
        line_id: line.id,
        entry_id: line.entry_id,
        entry_number: line.entry.entry_number,
        entry_date: line.entry.entry_date,
        entry_description: line.entry.description,
        entry_type: line.entry.entry_type,
        store: line.entry.store,
        account_id: line.account.id,
        account_code: line.account.code,
        account_name: line.account.name,
        line_description: line.description,
        debit_amount: debit,
        credit_amount: credit,
        third_party_name: line.third_party_name,
        third_party_tax_id: line.third_party_tax_id,
        running_balance,
      };
    });

    const totals = ledger_lines.reduce(
      (acc, l) => ({
        total_debit: acc.total_debit + l.debit_amount,
        total_credit: acc.total_credit + l.credit_amount,
      }),
      { total_debit: 0, total_credit: 0 },
    );

    return {
      third_party: {
        type: query.third_party_type,
        id: query.third_party_id,
        name: snapshot_name,
        tax_id: snapshot_tax_id,
      },
      lines: ledger_lines,
      totals: {
        ...totals,
        final_balance: running_balance,
      },
    };
  }
}

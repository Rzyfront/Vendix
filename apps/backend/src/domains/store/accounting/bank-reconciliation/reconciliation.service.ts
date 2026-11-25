import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '../../../../common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  BankAccountPolicy,
  bankAccountAvailableInStoreWhere,
  canModifyBankAccount,
  canViewAllOrganizationBankAccounts,
  resolveBankAccountPolicy,
} from '../../../../common/helpers/bank-account-availability.helper';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { BankAccountsService } from './bank-accounts.service';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly bank_accounts_service: BankAccountsService,
    private readonly fiscalScopeService: FiscalScopeService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async resolvePolicy(): Promise<BankAccountPolicy> {
    const context = this.getContext();
    const organization_id = context.organization_id;
    const store_id = context.store_id ?? 0;

    if (!organization_id) {
      throw new VendixHttpException(
        ErrorCodes.ORG_CONTEXT_001,
        'Se requiere contexto de organización para operar conciliaciones bancarias.',
      );
    }

    return resolveBankAccountPolicy(this.fiscalScopeService, {
      organization_id,
      store_id,
      context,
    });
  }

  private buildAccountVisibilityWhere(
    policy: BankAccountPolicy,
  ): Prisma.bank_accountsWhereInput {
    if (canViewAllOrganizationBankAccounts(policy)) {
      return { organization_id: policy.organization_id };
    }
    return bankAccountAvailableInStoreWhere(
      policy.store_id,
      policy.organization_id,
    );
  }

  /**
   * Valida que la conciliación pertenezca a una cuenta visible en el contexto
   * actual Y que el usuario tenga permiso para modificarla (en scope
   * ORGANIZATION, solo un usuario de organización puede mutar conciliaciones
   * de cuentas de organización).
   */
  async assertCanModifyReconciliation(id: number) {
    const policy = await this.resolvePolicy();
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: {
        id,
        bank_account: this.buildAccountVisibilityWhere(policy),
      },
      include: {
        bank_account: {
          select: {
            id: true,
            store_id: true,
            chart_account_id: true,
          },
        },
      },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

    if (!canModifyBankAccount(reconciliation.bank_account, policy)) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
    }

    return reconciliation;
  }

  async findAll(query: { bank_account_id?: number; status?: string }) {
    const policy = await this.resolvePolicy();
    const where: any = {
      ...(query.bank_account_id && { bank_account_id: query.bank_account_id }),
      ...(query.status && { status: query.status }),
      bank_account: this.buildAccountVisibilityWhere(policy),
    };

    const reconciliations = await this.prisma.bank_reconciliations.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        bank_account: {
          select: {
            id: true,
            name: true,
            account_number: true,
            bank_name: true,
          },
        },
        created_by: {
          select: { id: true, user_name: true },
        },
        _count: {
          select: { matches: true },
        },
      },
    });

    return reconciliations;
  }

  async findOne(id: number) {
    const policy = await this.resolvePolicy();
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: {
        id,
        bank_account: this.buildAccountVisibilityWhere(policy),
      },
      include: {
        bank_account: {
          select: {
            id: true,
            name: true,
            account_number: true,
            bank_name: true,
            chart_account_id: true,
          },
        },
        created_by: {
          select: { id: true, user_name: true },
        },
        matches: {
          include: {
            bank_transaction: true,
            accounting_entry: {
              select: {
                id: true,
                entry_number: true,
                description: true,
                entry_date: true,
                total_debit: true,
                total_credit: true,
              },
            },
            matched_by: {
              select: { id: true, user_name: true },
            },
          },
          orderBy: { matched_at: 'desc' },
        },
      },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

    // Calculate summary
    const matched_count = reconciliation.matches.length;

    const unmatched_bank = await this.prisma.bank_transactions.count({
      where: {
        bank_account_id: reconciliation.bank_account_id,
        transaction_date: {
          gte: reconciliation.period_start,
          lte: reconciliation.period_end,
        },
        is_reconciled: false,
      },
    });

    // Unmatched accounting entries that touch the bank's chart account
    let unmatched_accounting = 0;
    if (reconciliation.bank_account.chart_account_id) {
      const matched_entry_ids = reconciliation.matches
        .filter((m) => m.accounting_entry_id)
        .map((m) => m.accounting_entry_id!);

      unmatched_accounting = await this.prisma.accounting_entries.count({
        where: {
          status: 'posted' as any,
          entry_date: {
            gte: reconciliation.period_start,
            lte: reconciliation.period_end,
          },
          accounting_entry_lines: {
            some: {
              account_id: reconciliation.bank_account.chart_account_id,
            },
          },
          ...(matched_entry_ids.length > 0 && {
            id: { notIn: matched_entry_ids },
          }),
        },
      });
    }

    return {
      ...reconciliation,
      summary: {
        matched: matched_count,
        unmatched_bank,
        unmatched_accounting,
        difference: Number(reconciliation.difference),
      },
    };
  }

  async create(create_dto: CreateReconciliationDto) {
    const context = this.getContext();

    // Validate bank account exists and is modifiable by the current context
    const account = await this.bank_accounts_service.findOne(
      create_dto.bank_account_id,
    );
    if (account.can_edit === false) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
    }

    const opening_balance =
      create_dto.opening_balance !== undefined
        ? create_dto.opening_balance
        : Number(account.opening_balance);

    const difference = create_dto.statement_balance - opening_balance;

    const reconciliation = await this.prisma.bank_reconciliations.create({
      data: {
        bank_account_id: create_dto.bank_account_id,
        period_start: new Date(create_dto.period_start),
        period_end: new Date(create_dto.period_end),
        opening_balance,
        statement_balance: create_dto.statement_balance,
        reconciled_balance: 0,
        difference,
        created_by_user_id: context.user_id || null,
      },
      include: {
        bank_account: {
          select: {
            id: true,
            name: true,
            account_number: true,
            bank_name: true,
          },
        },
      },
    });

    return reconciliation;
  }

  async complete(id: number) {
    const reconciliation = await this.assertCanModifyReconciliation(id);

    if (reconciliation.status === ('completed' as any)) {
      throw new VendixHttpException(
        ErrorCodes.BANK_RECONCILIATION_ALREADY_COMPLETED,
      );
    }

    if (Number(reconciliation.difference) !== 0) {
      throw new VendixHttpException(
        ErrorCodes.BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO,
      );
    }

    const updated = await this.prisma.bank_reconciliations.update({
      where: { id },
      data: {
        status: 'completed' as any,
        completed_at: new Date(),
      },
    });

    // Mark all matched bank transactions as reconciled
    const matches = await this.prisma.bank_reconciliation_matches.findMany({
      where: { reconciliation_id: id },
      select: { bank_transaction_id: true },
    });

    const transaction_ids = matches.map((m) => m.bank_transaction_id);
    if (transaction_ids.length > 0) {
      await this.prisma.bank_transactions.updateMany({
        where: { id: { in: transaction_ids } },
        data: { is_reconciled: true },
      });
    }

    return updated;
  }

  async remove(id: number) {
    const reconciliation = await this.assertCanModifyReconciliation(id);

    if (reconciliation.status === ('completed' as any)) {
      throw new VendixHttpException(
        ErrorCodes.BANK_RECONCILIATION_ALREADY_COMPLETED,
      );
    }

    // Cascade deletes matches via DB relation
    await this.prisma.bank_reconciliations.delete({
      where: { id },
    });
  }

  async recalculateBalance(id: number) {
    const policy = await this.resolvePolicy();
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: {
        id,
        bank_account: this.buildAccountVisibilityWhere(policy),
      },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

    // Sum matched transaction amounts
    const matches = await this.prisma.bank_reconciliation_matches.findMany({
      where: { reconciliation_id: id },
      include: {
        bank_transaction: {
          select: { amount: true, type: true },
        },
      },
    });

    let reconciled_balance = Number(reconciliation.opening_balance);
    for (const match of matches) {
      const amount = Number(match.bank_transaction.amount);
      if (match.bank_transaction.type === ('credit' as any)) {
        reconciled_balance += amount;
      } else {
        reconciled_balance -= amount;
      }
    }

    const difference =
      Number(reconciliation.statement_balance) - reconciled_balance;

    await this.prisma.bank_reconciliations.update({
      where: { id },
      data: {
        reconciled_balance,
        difference,
      },
    });

    return { reconciled_balance, difference };
  }
}

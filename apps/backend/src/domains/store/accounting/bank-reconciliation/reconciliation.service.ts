import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { BankAccountsService } from './bank-accounts.service';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly bank_accounts_service: BankAccountsService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: { bank_account_id?: number; status?: string }) {
    const where: any = {
      ...(query.bank_account_id && { bank_account_id: query.bank_account_id }),
      ...(query.status && { status: query.status }),
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
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id },
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

    // Validate bank account exists
    const account = await this.bank_accounts_service.findOne(
      create_dto.bank_account_id,
    );

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
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

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
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

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
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id },
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

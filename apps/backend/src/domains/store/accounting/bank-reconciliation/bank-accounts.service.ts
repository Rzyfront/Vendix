import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { QueryBankAccountDto } from './dto/query-bank-account.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryBankAccountDto) {
    const { search, status, store_id } = query;

    const where: Prisma.bank_accountsWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { account_number: { contains: search, mode: 'insensitive' as const } },
          { bank_name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status: status as any }),
      ...(store_id && { store_id }),
    };

    const accounts = await this.prisma.bank_accounts.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        chart_account: {
          select: { id: true, code: true, name: true },
        },
        _count: {
          select: {
            bank_transactions: {
              where: { is_reconciled: false },
            },
          },
        },
      },
    });

    return accounts;
  }

  async findOne(id: number) {
    const account = await this.prisma.bank_accounts.findFirst({
      where: { id },
      include: {
        chart_account: {
          select: { id: true, code: true, name: true },
        },
        _count: {
          select: {
            bank_transactions: true,
            bank_reconciliations: true,
          },
        },
      },
    });

    if (!account) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_NOT_FOUND);
    }

    return account;
  }

  async create(create_dto: CreateBankAccountDto) {
    const context = this.getContext();

    // Validate account_number uniqueness (scoped by organization via @@unique)
    const existing = await this.prisma.bank_accounts.findFirst({
      where: { account_number: create_dto.account_number },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_DUPLICATE);
    }

    // Validate chart_account_id exists if provided
    if (create_dto.chart_account_id) {
      const chart_account = await this.prisma.chart_of_accounts.findFirst({
        where: { id: create_dto.chart_account_id },
      });

      if (!chart_account) {
        throw new VendixHttpException(
          ErrorCodes.ACC_FIND_001,
          'Linked chart of accounts entry not found',
        );
      }
    }

    const account = await this.prisma.bank_accounts.create({
      data: {
        name: create_dto.name,
        account_number: create_dto.account_number,
        bank_name: create_dto.bank_name,
        bank_code: create_dto.bank_code || null,
        currency: create_dto.currency || 'COP',
        opening_balance: create_dto.opening_balance || 0,
        current_balance: create_dto.opening_balance || 0,
        chart_account_id: create_dto.chart_account_id || null,
        store_id: create_dto.store_id || null,
        organization_id: context.organization_id,
      },
      include: {
        chart_account: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return account;
  }

  async update(id: number, update_dto: UpdateBankAccountDto) {
    await this.findOne(id);

    // If changing account_number, validate uniqueness
    if (update_dto.account_number) {
      const existing = await this.prisma.bank_accounts.findFirst({
        where: {
          account_number: update_dto.account_number,
          id: { not: id },
        },
      });

      if (existing) {
        throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_DUPLICATE);
      }
    }

    // Validate chart_account_id if provided
    if (update_dto.chart_account_id) {
      const chart_account = await this.prisma.chart_of_accounts.findFirst({
        where: { id: update_dto.chart_account_id },
      });

      if (!chart_account) {
        throw new VendixHttpException(
          ErrorCodes.ACC_FIND_001,
          'Linked chart of accounts entry not found',
        );
      }
    }

    const updated = await this.prisma.bank_accounts.update({
      where: { id },
      data: {
        ...(update_dto.name !== undefined && { name: update_dto.name }),
        ...(update_dto.account_number !== undefined && { account_number: update_dto.account_number }),
        ...(update_dto.bank_name !== undefined && { bank_name: update_dto.bank_name }),
        ...(update_dto.bank_code !== undefined && { bank_code: update_dto.bank_code }),
        ...(update_dto.currency !== undefined && { currency: update_dto.currency }),
        ...(update_dto.opening_balance !== undefined && { opening_balance: update_dto.opening_balance }),
        ...(update_dto.chart_account_id !== undefined && { chart_account_id: update_dto.chart_account_id }),
        ...(update_dto.store_id !== undefined && { store_id: update_dto.store_id }),
        ...(update_dto.column_mapping !== undefined && { column_mapping: update_dto.column_mapping as any }),
      },
      include: {
        chart_account: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return updated;
  }

  async remove(id: number) {
    await this.findOne(id);

    // Soft delete: set status to closed
    await this.prisma.bank_accounts.update({
      where: { id },
      data: { status: 'closed' as any },
    });
  }

  async updateBalance(bank_account_id: number) {
    const account = await this.findOne(bank_account_id);

    const aggregations = await this.prisma.bank_transactions.aggregate({
      where: { bank_account_id },
      _sum: {
        amount: true,
      },
    });

    // Calculate separately by type
    const credits = await this.prisma.bank_transactions.aggregate({
      where: { bank_account_id, type: 'credit' as any },
      _sum: { amount: true },
    });

    const debits = await this.prisma.bank_transactions.aggregate({
      where: { bank_account_id, type: 'debit' as any },
      _sum: { amount: true },
    });

    const credit_total = Number(credits._sum.amount || 0);
    const debit_total = Number(debits._sum.amount || 0);
    const opening = Number(account.opening_balance);
    const current_balance = opening + credit_total - debit_total;

    await this.prisma.bank_accounts.update({
      where: { id: bank_account_id },
      data: { current_balance },
    });

    return current_balance;
  }
}

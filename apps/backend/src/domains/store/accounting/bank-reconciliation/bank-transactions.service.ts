import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { QueryBankTransactionDto } from './dto/query-bank-transaction.dto';
import { BankAccountsService } from './bank-accounts.service';
import { StatementParserFactory } from './parsers/statement-parser.factory';
import { Prisma } from '@prisma/client';

@Injectable()
export class BankTransactionsService {
  private readonly logger = new Logger(BankTransactionsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly bank_accounts_service: BankAccountsService,
    private readonly statement_parser_factory: StatementParserFactory,
  ) {}

  async findAll(query: QueryBankTransactionDto) {
    const {
      bank_account_id,
      date_from,
      date_to,
      is_reconciled,
      search,
      page,
      limit,
    } = query;

    const skip = ((page || 1) - 1) * (limit || 50);
    const take = limit || 50;

    const where: Prisma.bank_transactionsWhereInput = {
      bank_account_id,
      ...(date_from && {
        transaction_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
      ...(date_to &&
        !date_from && {
          transaction_date: { lte: new Date(date_to) },
        }),
      ...(is_reconciled !== undefined && { is_reconciled }),
      ...(search && {
        OR: [
          { description: { contains: search, mode: 'insensitive' as const } },
          { reference: { contains: search, mode: 'insensitive' as const } },
          { counterparty: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.bank_transactions.findMany({
        where,
        skip,
        take,
        orderBy: { transaction_date: 'desc' },
        include: {
          bank_reconciliation_matches: {
            select: {
              id: true,
              match_type: true,
              confidence_score: true,
              accounting_entry: {
                select: { id: true, entry_number: true, description: true },
              },
            },
          },
        },
      }),
      this.prisma.bank_transactions.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: page || 1,
        limit: take,
        total_pages: Math.ceil(total / take),
      },
    };
  }

  async importStatement(
    bank_account_id: number,
    file: Buffer,
    filename: string,
  ) {
    const account = await this.bank_accounts_service.findOne(bank_account_id);

    let column_mapping: any = undefined;
    if (account.column_mapping) {
      column_mapping = account.column_mapping;
    }

    let parse_result;
    try {
      parse_result = await this.statement_parser_factory.parse(
        file,
        filename,
        column_mapping,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new VendixHttpException(ErrorCodes.STATEMENT_PARSE_ERROR, message);
    }

    if (parse_result.transactions.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.STATEMENT_PARSE_ERROR,
        'No transactions found in the file',
      );
    }

    // Prepare records for insert
    const records = parse_result.transactions.map((tx) => ({
      bank_account_id,
      transaction_date: tx.date,
      value_date: tx.value_date || null,
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      reference: tx.reference || null,
      external_id: tx.external_id || null,
      counterparty: tx.counterparty || null,
    }));

    // Use createMany with skipDuplicates (deduplication by bank_account_id + external_id)
    const result = await this.prisma.bank_transactions.createMany({
      data: records,
      skipDuplicates: true,
    });

    // Recalculate balance
    await this.bank_accounts_service.updateBalance(bank_account_id);

    this.logger.log(
      `Imported ${result.count} transactions for bank account ${bank_account_id} (${parse_result.transactions.length - result.count} duplicates skipped)`,
    );

    return {
      imported: result.count,
      total_parsed: parse_result.transactions.length,
      duplicates_skipped: parse_result.transactions.length - result.count,
      errors: parse_result.errors,
    };
  }

  async previewImport(bank_account_id: number, file: Buffer, filename: string) {
    const account = await this.bank_accounts_service.findOne(bank_account_id);

    let column_mapping: any = undefined;
    if (account.column_mapping) {
      column_mapping = account.column_mapping;
    }

    let parse_result;
    try {
      parse_result = await this.statement_parser_factory.parse(
        file,
        filename,
        column_mapping,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new VendixHttpException(ErrorCodes.STATEMENT_PARSE_ERROR, message);
    }

    // Check for existing external_ids to report duplicates
    const external_ids = parse_result.transactions
      .map((tx) => tx.external_id)
      .filter(Boolean) as string[];

    let duplicate_count = 0;
    if (external_ids.length > 0) {
      duplicate_count = await this.prisma.bank_transactions.count({
        where: {
          bank_account_id,
          external_id: { in: external_ids },
        },
      });
    }

    return {
      transactions: parse_result.transactions,
      total_parsed: parse_result.transactions.length,
      duplicates_found: duplicate_count,
      new_transactions: parse_result.transactions.length - duplicate_count,
      errors: parse_result.errors,
      account_number: parse_result.account_number,
      statement_date: parse_result.statement_date,
      opening_balance: parse_result.opening_balance,
      closing_balance: parse_result.closing_balance,
    };
  }

  async remove(id: number) {
    const transaction = await this.prisma.bank_transactions.findFirst({
      where: { id },
    });

    if (!transaction) {
      throw new VendixHttpException(ErrorCodes.BANK_TRANSACTION_NOT_FOUND);
    }

    if (transaction.is_reconciled) {
      throw new VendixHttpException(
        ErrorCodes.BANK_TRANSACTION_ALREADY_RECONCILED,
      );
    }

    const bank_account_id = transaction.bank_account_id;

    await this.prisma.bank_transactions.delete({
      where: { id },
    });

    // Recalculate balance
    await this.bank_accounts_service.updateBalance(bank_account_id);
  }
}

import {
  Injectable,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';

const ENTRY_INCLUDE = {
  accounting_entry_lines: {
    include: {
      account: {
        select: { id: true, code: true, name: true, account_type: true, nature: true },
      },
    },
    orderBy: { id: 'asc' as const },
  },
  fiscal_period: {
    select: { id: true, name: true, start_date: true, end_date: true, status: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  posted_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  store: {
    select: { id: true, name: true },
  },
};

@Injectable()
export class JournalEntriesService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryJournalEntryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      fiscal_period_id,
      entry_type,
      status,
      date_from,
      date_to,
      store_id,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.accounting_entriesWhereInput = {
      ...(search && {
        OR: [
          { entry_number: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(fiscal_period_id && { fiscal_period_id }),
      ...(entry_type && { entry_type: entry_type as any }),
      ...(status && { status: status as any }),
      ...(store_id && { store_id }),
      ...(date_from && {
        entry_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.accounting_entries.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: ENTRY_INCLUDE,
      }),
      this.prisma.accounting_entries.count({ where }),
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

  async findOne(id: number) {
    const entry = await this.prisma.accounting_entries.findFirst({
      where: { id },
      include: ENTRY_INCLUDE,
    });

    if (!entry) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_002);
    }

    return entry;
  }

  async create(create_dto: CreateJournalEntryDto) {
    const context = this.getContext();

    // Validate fiscal period exists and is open
    const fiscal_period = await this.prisma.fiscal_periods.findFirst({
      where: { id: create_dto.fiscal_period_id },
    });

    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    if (fiscal_period.status !== 'open') {
      throw new ConflictException(
        `Cannot create entries in fiscal period '${fiscal_period.name}' — status is '${fiscal_period.status}'`,
      );
    }

    // Validate double-entry: sum(debit) === sum(credit)
    const total_debit = create_dto.lines.reduce(
      (sum, line) => sum + Number(line.debit_amount),
      0,
    );
    const total_credit = create_dto.lines.reduce(
      (sum, line) => sum + Number(line.credit_amount),
      0,
    );

    if (Math.abs(total_debit - total_credit) > 0.001) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        `Double-entry mismatch: total debit (${total_debit}) does not equal total credit (${total_credit})`,
      );
    }

    // Validate each line has either debit or credit (not both, not neither)
    for (const line of create_dto.lines) {
      const has_debit = Number(line.debit_amount) > 0;
      const has_credit = Number(line.credit_amount) > 0;

      if (has_debit && has_credit) {
        throw new VendixHttpException(
          ErrorCodes.ACC_VALIDATE_001,
          'A line cannot have both debit and credit amounts',
        );
      }

      if (!has_debit && !has_credit) {
        throw new VendixHttpException(
          ErrorCodes.ACC_VALIDATE_001,
          'Each line must have either a debit or credit amount',
        );
      }
    }

    // Validate all accounts exist and accept entries
    const account_ids = create_dto.lines.map((line) => line.account_id);
    const accounts = await this.prisma.chart_of_accounts.findMany({
      where: {
        id: { in: account_ids },
      },
    });

    if (accounts.length !== new Set(account_ids).size) {
      throw new VendixHttpException(
        ErrorCodes.ACC_FIND_001,
        'One or more accounts not found',
      );
    }

    const non_entry_accounts = accounts.filter((acc) => !acc.accepts_entries);
    if (non_entry_accounts.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        `Accounts [${non_entry_accounts.map((a) => a.code).join(', ')}] do not accept entries`,
      );
    }

    // Generate entry number
    const entry_number = await this.generateEntryNumber(context.organization_id!);

    // Determine store_id: use DTO value, or context store_id if available
    const store_id = create_dto.store_id || context.store_id || null;

    // Create entry with lines in a transaction
    const entry = await this.prisma.$transaction(async (tx: any) => {
      const created_entry = await tx.accounting_entries.create({
        data: {
          organization_id: context.organization_id,
          store_id,
          entry_number,
          entry_type: (create_dto.entry_type as any) || 'manual',
          status: 'draft',
          fiscal_period_id: create_dto.fiscal_period_id,
          entry_date: new Date(create_dto.entry_date),
          description: create_dto.description || null,
          source_type: create_dto.source_type || null,
          source_id: create_dto.source_id || null,
          total_debit: new Prisma.Decimal(total_debit),
          total_credit: new Prisma.Decimal(total_credit),
          created_by_user_id: context.user_id,
        },
      });

      // Create entry lines
      await tx.accounting_entry_lines.createMany({
        data: create_dto.lines.map((line) => ({
          entry_id: created_entry.id,
          account_id: line.account_id,
          description: line.description || null,
          debit_amount: new Prisma.Decimal(line.debit_amount),
          credit_amount: new Prisma.Decimal(line.credit_amount),
        })),
      });

      return created_entry;
    });

    // Return with full includes
    return this.findOne(entry.id);
  }

  async update(id: number, update_dto: UpdateJournalEntryDto) {
    const entry = await this.findOne(id);

    // Only allow editing draft entries
    if (entry.status !== 'draft') {
      throw new ConflictException(
        `Cannot edit entry in '${entry.status}' status. Only draft entries can be edited.`,
      );
    }

    // If changing fiscal period, validate it's open
    if (update_dto.fiscal_period_id && update_dto.fiscal_period_id !== entry.fiscal_period_id) {
      const fiscal_period = await this.prisma.fiscal_periods.findFirst({
        where: { id: update_dto.fiscal_period_id },
      });

      if (!fiscal_period) {
        throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
      }

      if (fiscal_period.status !== 'open') {
        throw new ConflictException(
          `Cannot move entry to fiscal period '${fiscal_period.name}' — status is '${fiscal_period.status}'`,
        );
      }
    }

    // If updating lines, validate double-entry balance
    if (update_dto.lines) {
      const total_debit = update_dto.lines.reduce(
        (sum, line) => sum + Number(line.debit_amount),
        0,
      );
      const total_credit = update_dto.lines.reduce(
        (sum, line) => sum + Number(line.credit_amount),
        0,
      );

      if (Math.abs(total_debit - total_credit) > 0.001) {
        throw new VendixHttpException(
          ErrorCodes.ACC_VALIDATE_001,
          `Double-entry mismatch: total debit (${total_debit}) does not equal total credit (${total_credit})`,
        );
      }

      // Validate accounts
      const account_ids = update_dto.lines.map((line) => line.account_id);
      const accounts = await this.prisma.chart_of_accounts.findMany({
        where: { id: { in: account_ids } },
      });

      if (accounts.length !== new Set(account_ids).size) {
        throw new VendixHttpException(
          ErrorCodes.ACC_FIND_001,
          'One or more accounts not found',
        );
      }

      const non_entry_accounts = accounts.filter((acc) => !acc.accepts_entries);
      if (non_entry_accounts.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.ACC_VALIDATE_001,
          `Accounts [${non_entry_accounts.map((a) => a.code).join(', ')}] do not accept entries`,
        );
      }

      // Update in transaction: delete old lines, create new ones
      await this.prisma.$transaction(async (tx: any) => {
        await tx.accounting_entry_lines.deleteMany({
          where: { entry_id: id },
        });

        await tx.accounting_entries.update({
          where: { id },
          data: {
            ...(update_dto.entry_date && { entry_date: new Date(update_dto.entry_date) }),
            ...(update_dto.description !== undefined && { description: update_dto.description }),
            ...(update_dto.fiscal_period_id && { fiscal_period_id: update_dto.fiscal_period_id }),
            total_debit: new Prisma.Decimal(total_debit),
            total_credit: new Prisma.Decimal(total_credit),
          },
        });

        await tx.accounting_entry_lines.createMany({
          data: update_dto.lines!.map((line) => ({
            entry_id: id,
            account_id: line.account_id,
            description: line.description || null,
            debit_amount: new Prisma.Decimal(line.debit_amount),
            credit_amount: new Prisma.Decimal(line.credit_amount),
          })),
        });
      });
    } else {
      // Update only header fields
      await this.prisma.accounting_entries.update({
        where: { id },
        data: {
          ...(update_dto.entry_date && { entry_date: new Date(update_dto.entry_date) }),
          ...(update_dto.description !== undefined && { description: update_dto.description }),
          ...(update_dto.fiscal_period_id && { fiscal_period_id: update_dto.fiscal_period_id }),
        },
      });
    }

    return this.findOne(id);
  }

  async remove(id: number) {
    const entry = await this.findOne(id);

    if (entry.status !== 'draft') {
      throw new ConflictException(
        `Cannot delete entry in '${entry.status}' status. Only draft entries can be deleted.`,
      );
    }

    // Lines are deleted by cascade
    await this.prisma.accounting_entries.delete({
      where: { id },
    });
  }

  private async generateEntryNumber(organization_id: number): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `AE-${year}-`;

    // Find the latest entry number for this organization and year
    const latest = await this.prisma.accounting_entries.findFirst({
      where: {
        entry_number: { startsWith: prefix },
      },
      orderBy: { entry_number: 'desc' },
    });

    let sequence = 1;
    if (latest) {
      const last_number = parseInt(latest.entry_number.replace(prefix, ''), 10);
      if (!isNaN(last_number)) {
        sequence = last_number + 1;
      }
    }

    return `${prefix}${String(sequence).padStart(6, '0')}`;
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';

const ENTRY_INCLUDE = {
  accounting_entry_lines: {
    include: {
      account: {
        select: {
          id: true,
          code: true,
          name: true,
          account_type: true,
          nature: true,
        },
      },
    },
    orderBy: { id: 'asc' as const },
  },
  fiscal_period: {
    select: {
      id: true,
      name: true,
      start_date: true,
      end_date: true,
      status: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  posted_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  private async requireContext() {
    return this.platformOrg.requirePlatformContext();
  }

  async findAll(query: QueryJournalEntryDto) {
    const ctx = await this.requireContext();
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'entry_date',
      sort_order = 'desc',
      fiscal_period_id,
      entry_type,
      status,
      source_type,
      date_from,
      date_to,
      account_code,
    } = query;

    const skip = (page - 1) * limit;

    let entry_ids_for_account: number[] | undefined = undefined;
    if (account_code) {
      const account = await this.prisma
        .withoutScope()
        .chart_of_accounts.findFirst({
          where: {
            code: account_code,
            accounting_entity_id: ctx.accounting_entity_id,
            organization_id: ctx.organization_id,
          },
          select: { id: true },
        });
      if (!account) {
        return {
          data: [],
          meta: { total: 0, page, limit, total_pages: 0 },
        };
      }
      const lines = await this.prisma
        .withoutScope()
        .accounting_entry_lines.findMany({
          where: { account_id: account.id },
          select: { entry_id: true },
        });
      entry_ids_for_account = Array.from(new Set(lines.map((l) => l.entry_id)));
      if (entry_ids_for_account.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, limit, total_pages: 0 },
        };
      }
    }

    const where: Prisma.accounting_entriesWhereInput = {
      accounting_entity_id: ctx.accounting_entity_id,
      organization_id: ctx.organization_id,
      ...(search && {
        OR: [
          { entry_number: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(fiscal_period_id && { fiscal_period_id }),
      ...(entry_type && { entry_type: entry_type as any }),
      ...(status && { status: status as any }),
      ...(source_type && { source_type }),
      ...(date_from && {
        entry_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
      ...(entry_ids_for_account && { id: { in: entry_ids_for_account } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.withoutScope().accounting_entries.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: ENTRY_INCLUDE,
      }),
      this.prisma.withoutScope().accounting_entries.count({ where }),
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
    const ctx = await this.requireContext();
    const entry = await this.prisma.withoutScope().accounting_entries.findFirst({
      where: {
        id,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
      include: ENTRY_INCLUDE,
    });

    if (!entry) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_002);
    }

    return entry;
  }

  async create(
    create_dto: CreateJournalEntryDto,
    user_id: number | null,
  ) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    // Validate fiscal period
    const fiscal_period = await base.fiscal_periods.findFirst({
      where: {
        id: create_dto.fiscal_period_id,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
    });

    if (!fiscal_period) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_003);
    }

    if (fiscal_period.status !== 'open') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot create entries in fiscal period '${fiscal_period.name}' — status is '${fiscal_period.status}'`,
      );
    }

    // Validate entry_date falls within the open period
    const entry_date = new Date(create_dto.entry_date);
    if (
      entry_date < new Date(fiscal_period.start_date) ||
      entry_date > new Date(fiscal_period.end_date)
    ) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_002,
        `Entry date ${entry_date.toISOString().split('T')[0]} falls outside fiscal period '${fiscal_period.name}' (${fiscal_period.start_date.toISOString().split('T')[0]} → ${fiscal_period.end_date.toISOString().split('T')[0]})`,
      );
    }

    // Validate each line: only one of debit/credit, at least one
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

    // Validate double-entry balance
    const total_debit = create_dto.lines.reduce(
      (sum, l) => sum + Number(l.debit_amount),
      0,
    );
    const total_credit = create_dto.lines.reduce(
      (sum, l) => sum + Number(l.credit_amount),
      0,
    );

    if (Math.abs(total_debit - total_credit) > 0.001) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        `Double-entry mismatch: total debit (${total_debit}) does not equal total credit (${total_credit})`,
      );
    }

    // Validate all accounts exist in the platform org's COA
    const account_ids = Array.from(
      new Set(create_dto.lines.map((l) => l.account_id)),
    );
    const accounts = await base.chart_of_accounts.findMany({
      where: {
        id: { in: account_ids },
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
    });

    if (accounts.length !== account_ids.length) {
      throw new VendixHttpException(
        ErrorCodes.ACC_FIND_001,
        'One or more accounts not found in the platform chart of accounts',
      );
    }

    const non_entry_accounts = accounts.filter((acc) => !acc.accepts_entries);
    if (non_entry_accounts.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        `Accounts [${non_entry_accounts.map((a) => a.code).join(', ')}] do not accept entries`,
      );
    }

    const created = await base.$transaction(async (tx) => {
      const entry_number = await this.generateEntryNumber(
        ctx.organization_id,
        ctx.accounting_entity_id,
        tx as any,
      );

      const created_entry = await tx.accounting_entries.create({
        data: {
          organization_id: ctx.organization_id,
          accounting_entity_id: ctx.accounting_entity_id,
          store_id: null,
          entry_number,
          entry_type: 'manual',
          status: 'posted',
          fiscal_period_id: create_dto.fiscal_period_id,
          entry_date,
          description: create_dto.description ?? null,
          source_type: 'manual_journal_entry',
          total_debit: new Prisma.Decimal(total_debit),
          total_credit: new Prisma.Decimal(total_credit),
          created_by_user_id: user_id,
          posted_by_user_id: user_id,
          posted_at: new Date(),
        },
      });

      await tx.accounting_entry_lines.createMany({
        data: create_dto.lines.map((line) => ({
          entry_id: created_entry.id,
          account_id: line.account_id,
          description: line.description ?? null,
          debit_amount: new Prisma.Decimal(line.debit_amount),
          credit_amount: new Prisma.Decimal(line.credit_amount),
        })),
      });

      // Mirror source_id = entry.id (per spec)
      await tx.accounting_entries.update({
        where: { id: created_entry.id },
        data: { source_id: created_entry.id },
      });

      return created_entry;
    });

    return this.findOne(created.id);
  }

  private async generateEntryNumber(
    organization_id: number,
    accounting_entity_id: number,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `AE-${year}-`;

    const latest = await tx.accounting_entries.findFirst({
      where: {
        organization_id,
        accounting_entity_id,
        entry_number: { startsWith: prefix },
      },
      orderBy: { entry_number: 'desc' },
      select: { entry_number: true },
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

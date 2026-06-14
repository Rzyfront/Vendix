import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  private async requireContext() {
    const ctx = await this.platformOrg.requirePlatformContext();
    return ctx;
  }

  async findAll(query: QueryAccountDto) {
    const ctx = await this.requireContext();
    const {
      search,
      account_type,
      parent_id,
      level,
      accepts_entries,
      is_active,
      limit,
      offset,
    } = query;

    const where: Prisma.chart_of_accountsWhereInput = {
      accounting_entity_id: ctx.accounting_entity_id,
      organization_id: ctx.organization_id,
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(account_type && { account_type: account_type as any }),
      ...(parent_id !== undefined && { parent_id }),
      ...(level !== undefined && { level }),
      ...(accepts_entries !== undefined && { accepts_entries }),
      ...(is_active !== undefined && { is_active }),
    };

    const take = limit ?? 100;
    const skip = offset ?? 0;

    const [accounts, total] = await Promise.all([
      this.prisma.withoutScope().chart_of_accounts.findMany({
        where,
        orderBy: { code: 'asc' },
        take,
        skip,
        include: {
          parent: {
            select: { id: true, code: true, name: true },
          },
        },
      }),
      this.prisma.withoutScope().chart_of_accounts.count({ where }),
    ]);

    return {
      data: accounts,
      total,
      page: skip > 0 ? Math.floor(skip / take) + 1 : 1,
      limit: take,
    };
  }

  async getTree() {
    const ctx = await this.requireContext();

    const all = await this.prisma.withoutScope().chart_of_accounts.findMany({
      where: {
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
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

    return all.filter((account) => account.parent_id === null);
  }

  async findOne(code: string) {
    const ctx = await this.requireContext();
    const account = await this.prisma.withoutScope().chart_of_accounts.findFirst({
      where: {
        code,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
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

  async create(create_dto: CreateAccountDto) {
    const ctx = await this.requireContext();
    const base = this.prisma.withoutScope();

    let level = 1;
    let parent_account: Awaited<ReturnType<typeof base.chart_of_accounts.findFirst>> = null;

    if (create_dto.parent_id) {
      parent_account = await base.chart_of_accounts.findFirst({
        where: {
          id: create_dto.parent_id,
          accounting_entity_id: ctx.accounting_entity_id,
          organization_id: ctx.organization_id,
        },
      });
      if (!parent_account) {
        throw new VendixHttpException(
          ErrorCodes.ACC_FIND_001,
          'Parent account not found',
        );
      }
      if (!create_dto.code.startsWith(parent_account.code)) {
        throw new VendixHttpException(
          ErrorCodes.ACC_VALIDATE_001,
          `Account code '${create_dto.code}' must start with the parent code prefix '${parent_account.code}'`,
        );
      }
      level = parent_account.level + 1;
    } else if (create_dto.parent_code) {
      parent_account = await base.chart_of_accounts.findFirst({
        where: {
          code: create_dto.parent_code,
          accounting_entity_id: ctx.accounting_entity_id,
          organization_id: ctx.organization_id,
        },
      });
      if (!parent_account) {
        throw new VendixHttpException(
          ErrorCodes.ACC_FIND_001,
          `Parent account with code '${create_dto.parent_code}' not found`,
        );
      }
      if (!create_dto.code.startsWith(parent_account.code)) {
        throw new VendixHttpException(
          ErrorCodes.ACC_VALIDATE_001,
          `Account code '${create_dto.code}' must start with the parent code prefix '${parent_account.code}'`,
        );
      }
      level = parent_account.level + 1;
    }

    const existing = await base.chart_of_accounts.findFirst({
      where: {
        code: create_dto.code,
        accounting_entity_id: ctx.accounting_entity_id,
        organization_id: ctx.organization_id,
      },
    });

    if (existing) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Account code '${create_dto.code}' already exists in the platform chart of accounts`,
      );
    }

    const account_type = (create_dto.account_type ??
      (parent_account?.account_type as string) ??
      'asset') as any;
    const nature = (create_dto.nature ??
      (parent_account?.nature as string) ??
      'debit') as any;

    return base.chart_of_accounts.create({
      data: {
        code: create_dto.code,
        name: create_dto.name,
        account_type,
        nature,
        parent_id: parent_account?.id ?? null,
        level,
        is_active: create_dto.is_active ?? true,
        accepts_entries: create_dto.accepts_entries ?? false,
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
      },
      include: {
        parent: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async update(code: string, update_dto: UpdateAccountDto) {
    const account = await this.findOne(code);

    return this.prisma.withoutScope().chart_of_accounts.update({
      where: { id: account.id },
      data: {
        ...(update_dto.name !== undefined && { name: update_dto.name }),
        ...(update_dto.accepts_entries !== undefined && {
          accepts_entries: update_dto.accepts_entries,
        }),
        ...(update_dto.is_active !== undefined && { is_active: update_dto.is_active }),
        updated_at: new Date(),
      },
      include: {
        parent: { select: { id: true, code: true, name: true } },
      },
    });
  }
}

import { Injectable, ConflictException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { Prisma } from '@prisma/client';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScopeService: FiscalScopeService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryAccountDto) {
    const {
      search,
      account_type,
      parent_id,
      level,
      accepts_entries,
      is_active,
      tree,
      limit,
      offset,
    } = query;
    const context = this.getContext();
    const accountingEntity = await this.fiscalScopeService.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });

    const where: Prisma.chart_of_accountsWhereInput = {
      accounting_entity_id: accountingEntity.id,
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

    if (tree) {
      return this.getTree();
    }

    const take = limit ?? 100;
    const skip = offset ?? 0;

    const accounts = await this.prisma.chart_of_accounts.findMany({
      where,
      orderBy: { code: 'asc' },
      take,
      skip,
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
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
    });

    return accounts;
  }

  async getTree() {
    const context = this.getContext();
    const accountingEntity = await this.fiscalScopeService.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });

    const all_accounts = await this.prisma.chart_of_accounts.findMany({
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

    // Return only root-level accounts (parent_id is null), children are included via relation
    const root_accounts = all_accounts.filter(
      (account) => account.parent_id === null,
    );
    return root_accounts;
  }

  async findOne(id: number) {
    const context = this.getContext();
    const accountingEntity = await this.fiscalScopeService.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });

    const account = await this.prisma.chart_of_accounts.findFirst({
      where: { id, accounting_entity_id: accountingEntity.id },
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
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
    const context = this.getContext();
    const accountingEntity = await this.fiscalScopeService.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });
    let level = 1;

    // Validate parent exists and set level
    if (create_dto.parent_id) {
      const parent = await this.prisma.chart_of_accounts.findFirst({
        where: { id: create_dto.parent_id, accounting_entity_id: accountingEntity.id },
      });

      if (!parent) {
        throw new VendixHttpException(
          ErrorCodes.ACC_FIND_001,
          'Parent account not found',
        );
      }

      level = parent.level + 1;
    }

    // Validate code uniqueness within organization (handled by @@unique but give better error)
    const existing = await this.prisma.chart_of_accounts.findFirst({
      where: {
        code: create_dto.code,
        accounting_entity_id: accountingEntity.id,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Account code '${create_dto.code}' already exists in this organization`,
      );
    }

    const account = await this.prisma.chart_of_accounts.create({
      data: {
        code: create_dto.code,
        name: create_dto.name,
        account_type: create_dto.account_type as any,
        nature: create_dto.nature as any,
        parent_id: create_dto.parent_id || null,
        level,
        is_active: create_dto.is_active ?? true,
        accepts_entries: create_dto.accepts_entries ?? false,
        organization_id: context.organization_id!,
        accounting_entity_id: accountingEntity.id,
      },
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return account;
  }

  async update(id: number, update_dto: UpdateAccountDto) {
    const account = await this.findOne(id);

    // If changing parent, recalculate level
    let level = account.level;
    if (
      update_dto.parent_id !== undefined &&
      update_dto.parent_id !== account.parent_id
    ) {
      if (update_dto.parent_id === null) {
        level = 1;
      } else {
        // Prevent circular reference
        if (update_dto.parent_id === id) {
          throw new ConflictException('An account cannot be its own parent');
        }

        const parent = await this.prisma.chart_of_accounts.findFirst({
          where: {
            id: update_dto.parent_id,
            accounting_entity_id: account.accounting_entity_id,
          },
        });

        if (!parent) {
          throw new VendixHttpException(
            ErrorCodes.ACC_FIND_001,
            'Parent account not found',
          );
        }

        level = parent.level + 1;
      }
    }

    // If changing code, validate uniqueness
    if (update_dto.code && update_dto.code !== account.code) {
      const existing = await this.prisma.chart_of_accounts.findFirst({
        where: {
          code: update_dto.code,
          accounting_entity_id: account.accounting_entity_id,
          id: { not: id },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Account code '${update_dto.code}' already exists in this organization`,
        );
      }
    }

    const updated = await this.prisma.chart_of_accounts.update({
      where: { id },
      data: {
        ...update_dto,
        ...(update_dto.account_type && {
          account_type: update_dto.account_type as any,
        }),
        ...(update_dto.nature && { nature: update_dto.nature as any }),
        level,
      },
      include: {
        parent: {
          select: { id: true, code: true, name: true },
        },
        children: {
          select: { id: true, code: true, name: true },
          orderBy: { code: 'asc' },
        },
      },
    });

    return updated;
  }

  async remove(id: number) {
    const account = await this.findOne(id);

    // Check if has children
    if (account.children && account.children.length > 0) {
      throw new ConflictException(
        'Cannot delete account with child accounts. Remove children first.',
      );
    }

    // Check if has journal entry lines
    const entry_lines_count = await this.prisma.accounting_entry_lines.count({
      where: { account_id: id },
    });

    if (entry_lines_count > 0) {
      throw new ConflictException(
        'Cannot delete account with associated journal entry lines',
      );
    }

    await this.prisma.chart_of_accounts.delete({
      where: { id },
    });
  }

  /**
   * Find account by code within the current organization scope
   */
  async findByCode(code: string) {
    const context = this.getContext();
    const accountingEntity = await this.fiscalScopeService.resolveAccountingEntityForFiscal({
      organization_id: context.organization_id!,
      store_id: context.store_id,
    });

    return this.prisma.chart_of_accounts.findFirst({
      where: { code, accounting_entity_id: accountingEntity.id },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '../../../../common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  BankAccountDuplicateWarning,
  BankAccountPolicy,
  bankAccountAvailableInStoreWhere,
  buildDuplicateBankAccountWarnings,
  canModifyBankAccount,
  canViewAllOrganizationBankAccounts,
  resolveBankAccountPolicy,
} from '../../../../common/helpers/bank-account-availability.helper';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { QueryBankAccountDto } from './dto/query-bank-account.dto';
import { Prisma } from '@prisma/client';

export interface BankAccountScopeContext {
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  can_manage_accounts: boolean;
  can_manage_organization_accounts: boolean;
  current_store_id: number;
  stores: Array<{
    id: number;
    name: string;
    store_code: string | null;
    is_active: boolean;
  }>;
  duplicate_number_warnings: BankAccountDuplicateWarning[];
}

const BANK_ACCOUNT_RELATIONS_INCLUDE = {
  chart_account: {
    select: { id: true, code: true, name: true },
  },
  store: {
    select: { id: true, name: true },
  },
  store_assignments: {
    select: {
      store_id: true,
      store: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class BankAccountsService {
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

  private async resolvePolicy(): Promise<BankAccountPolicy> {
    const context = this.getContext();
    const organization_id = context.organization_id;
    const store_id = context.store_id ?? 0;

    if (!organization_id) {
      throw new VendixHttpException(
        ErrorCodes.ORG_CONTEXT_001,
        'Se requiere contexto de organización para operar cuentas bancarias.',
      );
    }

    return resolveBankAccountPolicy(this.fiscalScopeService, {
      organization_id,
      store_id,
      context,
    });
  }

  private buildVisibilityWhere(
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

  private formatAccount<
    T extends {
      store_id: number | null;
      store_assignments?: ReadonlyArray<{
        store_id: number;
        store?: { id: number; name: string } | null;
      }>;
      _count?: { bank_transactions?: number; bank_reconciliations?: number };
    },
  >(account: T, policy: BankAccountPolicy) {
    return {
      ...account,
      unreconciled_count: account._count?.bank_transactions ?? 0,
      assigned_store_ids: (account.store_assignments ?? []).map(
        (assignment) => assignment.store_id,
      ),
      can_edit: canModifyBankAccount(account, policy),
    };
  }

  private async validateOrganizationStoreIds(
    organization_id: number,
    store_ids: number[] | undefined,
  ): Promise<number[]> {
    const uniqueIds = Array.from(
      new Set((store_ids ?? []).filter((id) => Number.isInteger(id) && id > 0)),
    );

    if (uniqueIds.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT,
        'Debes seleccionar al menos una tienda cuando la cuenta no está disponible en todas las tiendas.',
      );
    }

    const foundStores = await this.prisma.stores.findMany({
      where: {
        organization_id,
        id: { in: uniqueIds },
      },
      select: { id: true },
    });

    if (foundStores.length !== uniqueIds.length) {
      throw new VendixHttpException(
        ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT,
        'Una o más tiendas seleccionadas no pertenecen a esta organización.',
      );
    }

    return uniqueIds;
  }

  /**
   * QUI-1061 — devuelve el contexto de scope fiscal, permisos, sucursales
   * disponibles para asignar y avisos no bloqueantes de números repetidos
   * (cuando la organización pasó a scope ORGANIZATION con cuentas previas por
   * tienda que comparten número).
   */
  async getScopeContext(): Promise<BankAccountScopeContext> {
    const policy = await this.resolvePolicy();
    const canManageAccounts =
      policy.fiscal_scope === 'STORE'
        ? true
        : policy.can_manage_organization_accounts;

    let stores: BankAccountScopeContext['stores'] = [];
    let duplicate_number_warnings: BankAccountDuplicateWarning[] = [];

    if (policy.fiscal_scope === 'ORGANIZATION') {
      stores = await this.prisma.stores.findMany({
        where: {
          organization_id: policy.organization_id,
          is_active: true,
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          store_code: true,
          is_active: true,
        },
      });

      if (policy.can_manage_organization_accounts) {
        const orgAccounts = await this.prisma.bank_accounts.findMany({
          where: {
            organization_id: policy.organization_id,
            status: { not: 'closed' as any },
          },
          select: {
            id: true,
            name: true,
            bank_name: true,
            account_number: true,
            store_id: true,
            status: true,
            store: { select: { id: true, name: true } },
          },
          orderBy: { created_at: 'asc' },
        });
        duplicate_number_warnings =
          buildDuplicateBankAccountWarnings(orgAccounts);
      }
    }

    return {
      fiscal_scope: policy.fiscal_scope,
      can_manage_accounts: canManageAccounts,
      can_manage_organization_accounts: policy.can_manage_organization_accounts,
      current_store_id: policy.store_id,
      stores,
      duplicate_number_warnings,
    };
  }

  async findAll(query: QueryBankAccountDto) {
    const policy = await this.resolvePolicy();
    const { search, status } = query;

    const filters: Prisma.bank_accountsWhereInput[] = [
      this.buildVisibilityWhere(policy),
    ];

    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          {
            account_number: { contains: search, mode: 'insensitive' as const },
          },
          { bank_name: { contains: search, mode: 'insensitive' as const } },
        ],
      });
    }

    if (status) {
      filters.push({ status: status as any });
    }

    const accounts = await this.prisma.bank_accounts.findMany({
      where: { AND: filters },
      orderBy: { created_at: 'desc' },
      include: {
        ...BANK_ACCOUNT_RELATIONS_INCLUDE,
        _count: {
          select: {
            bank_transactions: {
              where: { is_reconciled: false },
            },
          },
        },
      },
    });

    return accounts.map((account) => this.formatAccount(account, policy));
  }

  async findOne(id: number) {
    const policy = await this.resolvePolicy();
    const account = await this.prisma.bank_accounts.findFirst({
      where: {
        AND: [{ id }, this.buildVisibilityWhere(policy)],
      },
      include: {
        ...BANK_ACCOUNT_RELATIONS_INCLUDE,
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

    return this.formatAccount(account, policy);
  }

  async create(create_dto: CreateBankAccountDto) {
    const policy = await this.resolvePolicy();

    let owner_store_id: number | null;
    let available_in_all_stores = true;
    let assigned_store_ids: number[] = [];

    if (policy.fiscal_scope === 'ORGANIZATION') {
      if (!policy.can_manage_organization_accounts) {
        throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
      }
      owner_store_id = null;
      available_in_all_stores = create_dto.available_in_all_stores ?? true;
      if (available_in_all_stores) {
        if (
          Array.isArray(create_dto.store_ids) &&
          create_dto.store_ids.length > 0
        ) {
          throw new VendixHttpException(
            ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT,
            'Para asignar tiendas específicas debes indicar available_in_all_stores en false.',
          );
        }
      } else {
        assigned_store_ids = await this.validateOrganizationStoreIds(
          policy.organization_id,
          create_dto.store_ids,
        );
      }
    } else {
      if (!policy.store_id) {
        throw new VendixHttpException(
          ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT,
          'Se requiere contexto de tienda para crear la cuenta bancaria.',
        );
      }
      owner_store_id = policy.store_id;
    }

    // QUI-1061 — unicidad según el scope fiscal:
    // - Scope STORE: única por (organización, tienda, número).
    // - Scope ORGANIZATION: única por (organización, número) entre cuentas de organización (store_id NULL).
    const existing = await this.prisma.bank_accounts.findFirst({
      where: {
        organization_id: policy.organization_id,
        store_id: owner_store_id,
        account_number: create_dto.account_number,
      },
      select: { id: true },
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
        store_id: owner_store_id,
        organization_id: policy.organization_id,
        available_in_all_stores,
        ...(!available_in_all_stores && assigned_store_ids.length > 0
          ? {
              store_assignments: {
                create: assigned_store_ids.map((store_id) => ({
                  store_id,
                  organization_id: policy.organization_id,
                })),
              },
            }
          : {}),
      },
      include: BANK_ACCOUNT_RELATIONS_INCLUDE,
    });

    return this.formatAccount(account, policy);
  }

  async update(id: number, update_dto: UpdateBankAccountDto) {
    const policy = await this.resolvePolicy();
    const existingAccount = await this.findOne(id);

    if (!canModifyBankAccount(existingAccount, policy)) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
    }

    // If changing account_number, validate uniqueness within the account's ownership scope
    if (update_dto.account_number) {
      const duplicate = await this.prisma.bank_accounts.findFirst({
        where: {
          organization_id: policy.organization_id,
          store_id: existingAccount.store_id,
          account_number: update_dto.account_number,
          id: { not: id },
        },
        select: { id: true },
      });

      if (duplicate) {
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

    const shouldUpdateAssignment =
      existingAccount.store_id === null &&
      policy.fiscal_scope === 'ORGANIZATION' &&
      (update_dto.available_in_all_stores !== undefined ||
        update_dto.store_ids !== undefined);

    let nextAvailableInAll: boolean | undefined;
    let validatedStoreIds: number[] | undefined;

    if (shouldUpdateAssignment) {
      nextAvailableInAll =
        update_dto.available_in_all_stores ??
        existingAccount.available_in_all_stores ??
        true;

      if (nextAvailableInAll) {
        if (
          Array.isArray(update_dto.store_ids) &&
          update_dto.store_ids.length > 0
        ) {
          throw new VendixHttpException(
            ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT,
            'Para asignar tiendas específicas debes indicar available_in_all_stores en false.',
          );
        }
      } else {
        const candidateStoreIds =
          update_dto.store_ids !== undefined
            ? update_dto.store_ids
            : existingAccount.assigned_store_ids;
        validatedStoreIds = await this.validateOrganizationStoreIds(
          policy.organization_id,
          candidateStoreIds,
        );
      }
    }

    const updateData = {
      ...(update_dto.name !== undefined && { name: update_dto.name }),
      ...(update_dto.account_number !== undefined && {
        account_number: update_dto.account_number,
      }),
      ...(update_dto.bank_name !== undefined && {
        bank_name: update_dto.bank_name,
      }),
      ...(update_dto.bank_code !== undefined && {
        bank_code: update_dto.bank_code,
      }),
      ...(update_dto.currency !== undefined && {
        currency: update_dto.currency,
      }),
      ...(update_dto.opening_balance !== undefined && {
        opening_balance: update_dto.opening_balance,
      }),
      ...(update_dto.chart_account_id !== undefined && {
        chart_account_id: update_dto.chart_account_id,
      }),
      ...(update_dto.column_mapping !== undefined && {
        column_mapping: update_dto.column_mapping as any,
      }),
      ...(nextAvailableInAll !== undefined && {
        available_in_all_stores: nextAvailableInAll,
      }),
    };

    if (shouldUpdateAssignment) {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.bank_accounts.update({
          where: { id },
          data: updateData,
        });

        if (nextAvailableInAll) {
          await tx.bank_account_stores.deleteMany({
            where: { bank_account_id: id },
          });
        } else if (update_dto.store_ids !== undefined && validatedStoreIds) {
          await tx.bank_account_stores.deleteMany({
            where: { bank_account_id: id },
          });
          await tx.bank_account_stores.createMany({
            data: validatedStoreIds.map((store_id) => ({
              bank_account_id: id,
              store_id,
              organization_id: policy.organization_id,
            })),
            skipDuplicates: true,
          });
        }
      });

      return this.findOne(id);
    }

    const updated = await this.prisma.bank_accounts.update({
      where: { id },
      data: updateData,
      include: BANK_ACCOUNT_RELATIONS_INCLUDE,
    });

    return this.formatAccount(updated, policy);
  }

  async remove(id: number) {
    const policy = await this.resolvePolicy();
    const existingAccount = await this.findOne(id);

    if (!canModifyBankAccount(existingAccount, policy)) {
      throw new VendixHttpException(ErrorCodes.BANK_ACCOUNT_ORG_MANAGED);
    }

    // Soft delete: set status to closed
    await this.prisma.bank_accounts.update({
      where: { id },
      data: { status: 'closed' as any },
    });
  }

  async updateBalance(bank_account_id: number) {
    const account = await this.findOne(bank_account_id);

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

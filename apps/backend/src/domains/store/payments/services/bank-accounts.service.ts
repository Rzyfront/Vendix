import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  BankAccountOptionDto,
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from '../dto/bank-account.dto';

/**
 * QUI-728 — proyección de `bank_accounts` para transferencia.
 *
 * Invive en el MÓDULO DE PAYMENTS (no en bank-reconciliation / accounting, que
 * es territorio de E.2). Solo expone la proyección mínima
 * `{ id, name, bank_name, account_number }` para el selector del cajero y el
 * CRUD de settings. No toca balances, chart_account ni column_mapping.
 */
@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Lista las cuentas bancarias disponibles para la tienda del contexto:
   * `status='active'` y scope `organization_id` + (`store_id === null` o
   * `=== store_id`). Devuelve la proyección mínima.
   */
  async listForStore(): Promise<BankAccountOptionDto[]> {
    const storeId = this.getContextStoreId();

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada para listar cuentas bancarias');
    }

    const accounts = await this.prisma.bank_accounts.findMany({
      where: {
        organization_id: store.organization_id,
        status: 'active',
        OR: [{ store_id: null }, { store_id: storeId }],
      },
      orderBy: { bank_name: 'asc' },
      select: {
        id: true,
        name: true,
        bank_name: true,
        account_number: true,
      },
    });

    return accounts;
  }

  async create(dto: CreateBankAccountDto): Promise<BankAccountOptionDto> {
    const storeId = this.getContextStoreId();
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada para crear la cuenta bancaria');
    }

    const account = await this.prisma.bank_accounts.create({
      data: {
        organization_id: store.organization_id,
        store_id: storeId,
        name: dto.name,
        bank_name: dto.bank_name,
        account_number: dto.account_number,
        bank_code: dto.bank_code ?? null,
        currency: dto.currency ?? 'COP',
      },
      select: { id: true, name: true, bank_name: true, account_number: true },
    });

    return account;
  }

  async update(id: number, dto: UpdateBankAccountDto): Promise<BankAccountOptionDto> {
    const storeId = this.getContextStoreId();
    await this.assertOwned(id, storeId);

    const account = await this.prisma.bank_accounts.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.bank_name !== undefined && { bank_name: dto.bank_name }),
        ...(dto.account_number !== undefined && { account_number: dto.account_number }),
        ...(dto.bank_code !== undefined && { bank_code: dto.bank_code }),
      },
      select: { id: true, name: true, bank_name: true, account_number: true },
    });

    return account;
  }

  /**
   * Cierre lógico: `status='closed'` (las cuentas con pagos asociados usan
   * ON DELETE RESTRICT; nunca borrado físico). Devuelve la proyección.
   */
  async close(id: number): Promise<BankAccountOptionDto> {
    const storeId = this.getContextStoreId();
    await this.assertOwned(id, storeId);

    const account = await this.prisma.bank_accounts.update({
      where: { id },
      data: { status: 'closed' },
      select: { id: true, name: true, bank_name: true, account_number: true },
    });

    return account;
  }

  private getContextStoreId(): number {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new ForbiddenException('Se requiere contexto de tienda para esta operación');
    }
    return storeId;
  }

  private async assertOwned(id: number, storeId: number): Promise<void> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }
    const account = await this.prisma.bank_accounts.findFirst({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('Cuenta bancaria no encontrada');
    }
    if (
      account.organization_id !== store.organization_id ||
      (account.store_id !== null && account.store_id !== storeId)
    ) {
      throw new ForbiddenException('La cuenta bancaria no pertenece a esta tienda');
    }
  }
}

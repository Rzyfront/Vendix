import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  bankAccountAvailableInStoreWhere,
  collectBankTransferAccountIds,
  filterBankTransferConfigAccounts,
} from '../../../../common/helpers/bank-account-availability.helper';
import {
  EnablePaymentMethodDto,
  UpdateStorePaymentMethodDto,
  ReorderPaymentMethodsDto,
} from '../dto';
import { PaymentEncryptionService } from './payment-encryption.service';
import { CONFIG_VALIDATORS } from '../validators';

@Injectable()
export class StorePaymentMethodsService {
  constructor(
    private prisma: StorePrismaService,
    private paymentEncryption: PaymentEncryptionService,
  ) {}

  /**
   * Get available payment methods for a store to enable
   * Shows organization methods first, then system methods that are active and not yet enabled
   */
  async getAvailableForStore() {
    // Get already enabled methods (StorePrismaService automatically filters by store_id)
    const enabled_methods = await this.prisma.store_payment_methods.findMany({
      select: { system_payment_method_id: true },
    });

    const enabled_ids = enabled_methods.map((m) => m.system_payment_method_id);

    // TODO: Add organization payment methods here when the feature is implemented
    // For now, only system methods are available
    const available_methods = await this.prisma.system_payment_methods.findMany(
      {
        where: {
          is_active: true,
          id: { notIn: enabled_ids },
        },
        orderBy: [
          { provider: 'asc' }, // 'organization' methods first, then 'system'
          { name: 'asc' },
        ],
      },
    );

    return available_methods;
  }

  /**
   * Get enabled payment methods for a store
   * Masks sensitive fields in custom_config before returning
   */
  async getEnabledForStore() {
    const methods = await this.prisma.store_payment_methods.findMany({
      include: {
        system_payment_method: true,
      },
      orderBy: { display_order: 'asc' },
    });

    const masked = methods.map((method) => ({
      ...method,
      custom_config: method.custom_config
        ? this.paymentEncryption.maskConfig(
            method.custom_config as Record<string, any>,
            method.system_payment_method?.type || '',
          )
        : method.custom_config,
    }));

    return this.filterBankTransferMethodsForStore(masked);
  }

  /**
   * Get single store payment method
   * Masks sensitive fields in custom_config before returning
   */
  async findOne(method_id: number) {
    if (!method_id || isNaN(method_id)) {
      throw new NotFoundException('Invalid payment method ID');
    }

    const method = await this.prisma.store_payment_methods.findUnique({
      where: {
        id: method_id,
      },
      include: {
        system_payment_method: true,
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    const masked = {
      ...method,
      custom_config: method.custom_config
        ? this.paymentEncryption.maskConfig(
            method.custom_config as Record<string, any>,
            method.system_payment_method?.type || '',
          )
        : method.custom_config,
    };

    const [filtered] = await this.filterBankTransferMethodsForStore([masked]);
    return filtered;
  }

  /**
   * Get decrypted custom_config for internal use (gateway processing, webhooks).
   * NEVER expose this directly to API responses.
   */
  async getDecryptedConfig(
    storePaymentMethodId: number,
  ): Promise<Record<string, any>> {
    const method = await this.prisma.store_payment_methods.findUnique({
      where: { id: storePaymentMethodId },
      include: { system_payment_method: true },
    });

    if (!method?.custom_config) return {};

    const providerType = method.system_payment_method?.type || '';
    return this.paymentEncryption.decryptConfig(
      method.custom_config as Record<string, any>,
      providerType,
    );
  }

  /**
   * Enable a system payment method for a store
   */
  async enableForStore(
    system_payment_method_id: number,
    enable_dto: EnablePaymentMethodDto,
  ) {
    // Get store_id from context for create operation
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    // Verify system method exists and is active
    const system_method = await this.prisma.system_payment_methods.findUnique({
      where: { id: system_payment_method_id },
    });

    if (!system_method || !system_method.is_active) {
      throw new BadRequestException('System payment method not available');
    }

    const providerType = system_method.type;

    // Check if already enabled (use base client to bypass store filtering)
    const base_client = this.prisma.withoutScope();
    const existing = await base_client.store_payment_methods.findFirst({
      where: {
        store_id: store_id,
        system_payment_method_id: system_payment_method_id,
      },
    });

    if (existing) {
      if (existing.state !== 'enabled') {
        if (enable_dto.custom_config) {
          this.validateConfig(providerType, enable_dto.custom_config);
          if (providerType === 'bank_transfer') {
            await this.validateBankTransferAccountAvailability(
              store_id,
              enable_dto.custom_config,
            );
          }
        }
        // Encrypt custom_config if provided
        const encryptedConfig = enable_dto.custom_config
          ? this.paymentEncryption.encryptConfig(
              enable_dto.custom_config,
              providerType,
            )
          : undefined;

        return base_client.store_payment_methods.update({
          where: { id: existing.id },
          data: {
            state: 'enabled',
            // Update config if provided, otherwise keep existing
            ...(enable_dto.display_name && {
              display_name: enable_dto.display_name,
            }),
            ...(encryptedConfig && { custom_config: encryptedConfig }),
          },
          include: {
            system_payment_method: true,
          },
        });
      }

      throw new BadRequestException(
        'This payment method is already enabled for this store',
      );
    }

    // Validate configuration if required
    if (system_method.requires_config && !enable_dto.custom_config) {
      throw new BadRequestException(
        'This payment method requires configuration',
      );
    }

    // Validate configuration against provider-specific validator
    if (enable_dto.custom_config) {
      this.validateConfig(providerType, enable_dto.custom_config);
      if (providerType === 'bank_transfer') {
        await this.validateBankTransferAccountAvailability(
          store_id,
          enable_dto.custom_config,
        );
      }
    }

    // Encrypt sensitive fields in custom_config before storing
    const configToStore = enable_dto.custom_config
      ? this.paymentEncryption.encryptConfig(
          enable_dto.custom_config,
          providerType,
        )
      : (system_method.default_config ?? undefined);

    return base_client.store_payment_methods.create({
      data: {
        store_id: store_id,
        system_payment_method_id: system_payment_method_id,
        display_name: enable_dto.display_name || system_method.display_name,
        custom_config: configToStore,
        state: 'enabled',
        display_order: enable_dto.display_order || 0,
        min_amount: enable_dto.min_amount,
        max_amount: enable_dto.max_amount,
      },
      include: {
        system_payment_method: true,
      },
    });
  }

  /**
   * Update store payment method configuration
   */
  async updateStoreMethod(
    store_payment_method_id: number,
    update_dto: UpdateStorePaymentMethodDto,
  ) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: store_payment_method_id,
      },
      include: {
        system_payment_method: true,
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    // Validate configuration against provider-specific validator
    if (update_dto.custom_config) {
      const providerType = method.system_payment_method?.type || '';
      this.validateConfig(
        providerType,
        update_dto.custom_config as Record<string, any>,
      );
      if (providerType === 'bank_transfer') {
        const targetStoreId =
          method.store_id ?? RequestContextService.getContext()?.store_id;
        if (!targetStoreId) {
          throw new ForbiddenException(
            'Store context required for this operation',
          );
        }
        await this.validateBankTransferAccountAvailability(
          targetStoreId,
          update_dto.custom_config as Record<string, any>,
        );
      }
    }

    // Encrypt sensitive fields in custom_config before storing
    const dataToUpdate = { ...update_dto };
    if (dataToUpdate.custom_config) {
      const providerType = method.system_payment_method?.type || '';
      dataToUpdate.custom_config = this.paymentEncryption.encryptConfig(
        dataToUpdate.custom_config as Record<string, any>,
        providerType,
      );
    }

    return this.prisma.store_payment_methods.update({
      where: { id: store_payment_method_id },
      data: dataToUpdate,
      include: {
        system_payment_method: true,
      },
    });
  }

  /**
   * Re-enable a disabled store payment method
   */
  async reEnableForStore(store_payment_method_id: number) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: store_payment_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    if (method.state === 'enabled') {
      throw new BadRequestException('Payment method is already enabled');
    }

    return this.prisma.store_payment_methods.update({
      where: { id: store_payment_method_id },
      data: { state: 'enabled' },
      include: {
        system_payment_method: true,
      },
    });
  }

  /**
   * Disable payment method for a store
   */
  async disableForStore(store_payment_method_id: number) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: store_payment_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    return this.prisma.store_payment_methods.update({
      where: { id: store_payment_method_id },
      data: { state: 'disabled' },
    });
  }

  /**
   * Delete/remove payment method from store
   */
  async removeFromStore(store_payment_method_id: number) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: store_payment_method_id,
      },
      include: {
        _count: {
          select: { payments: true },
        },
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    if (method._count.payments > 0) {
      throw new BadRequestException(
        `Cannot remove payment method because it has been used in ${method._count.payments} payment(s). You can disable it instead.`,
      );
    }

    await this.prisma.store_payment_methods.delete({
      where: { id: store_payment_method_id },
    });

    return { success: true, message: 'Payment method removed from store' };
  }

  /**
   * Reorder payment methods for display
   */
  async reorderMethods(order_dto: ReorderPaymentMethodsDto) {
    // Update display_order for each method
    const updates = order_dto.methods.map((item, index) =>
      this.prisma.store_payment_methods.updateMany({
        where: {
          id: item.id,
        },
        data: {
          display_order: index,
        },
      }),
    );

    await this.prisma.$transaction(updates);

    return { success: true, message: 'Payment methods reordered' };
  }

  /**
   * Get payment method statistics for the store
   */
  async getStats() {
    // Get all payment methods for this store (filtered by StorePrismaService)
    const all_methods = await this.prisma.store_payment_methods.findMany({
      select: {
        state: true,
      },
    });

    // Count methods by state
    const stats = all_methods.reduce(
      (acc, method) => {
        switch (method.state) {
          case 'enabled':
            acc.enabled_methods++;
            break;
          case 'disabled':
            acc.disabled_methods++;
            break;
          case 'requires_configuration':
            acc.requires_config++;
            break;
        }
        acc.total_methods++;
        return acc;
      },
      {
        total_methods: 0,
        enabled_methods: 0,
        disabled_methods: 0,
        requires_config: 0,
      },
    );

    // Get payment statistics (StorePrismaService automatically filters by store_id)
    const payment_stats = await this.prisma.payments.aggregate({
      _count: {
        id: true,
      },
      _sum: {
        amount: true,
      },
      where: {
        state: {
          in: ['succeeded', 'captured'],
        },
      },
    });

    // Get transaction counts by state
    const transaction_counts = await this.prisma.payments.groupBy({
      by: ['state'],
      _count: {
        state: true,
      },
    });

    const successful_transactions =
      transaction_counts.find((tc) => tc.state === 'succeeded')?._count.state ||
      transaction_counts.find((tc) => tc.state === 'captured')?._count.state ||
      0;

    const failed_transactions =
      transaction_counts.find((tc) => tc.state === 'failed')?._count.state || 0;

    return {
      ...stats,
      total_transactions: payment_stats._count.id || 0,
      successful_transactions: successful_transactions,
      failed_transactions: failed_transactions,
      total_revenue: parseFloat(payment_stats._sum.amount?.toString() || '0'),
    };
  }

  /**
   * Validate custom_config against provider-specific validator (if one exists).
   * Throws BadRequestException with detailed messages on validation failure.
   */
  private validateConfig(
    providerType: string,
    config: Record<string, any>,
  ): void {
    // QUI-728 — validación propia del shape `{ accounts: BankAccountRef[] }`.
    // No hay un validator class en CONFIG_VALIDATORS para `bank_transfer` porque
    // el shape es un array de refs a `bank_accounts`, no un mapa plano.
    if (providerType === 'bank_transfer') {
      this.validateBankTransferConfig(config);
      return;
    }

    const ValidatorClass = CONFIG_VALIDATORS[providerType];
    if (!ValidatorClass) return; // No validator for this type, skip

    const instance = plainToInstance(ValidatorClass, config);
    const errors = validateSync(instance, {
      whitelist: false,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      const messages = errors
        .map((e) => Object.values(e.constraints || {}).join(', '))
        .join('; ');
      throw new BadRequestException(`Configuración inválida: ${messages}`);
    }
  }

  /**
   * QUI-728 — valida `custom_config.accounts` del método `bank_transfer`.
   * Un método de transferencia sin cuentas configuradas es un estado inválido:
   * el cajero no tendría a dónde dirigir el pago. No se exige `id` para permitir
   * refs legacy (auto-migrada sin vínculo a `bank_accounts`), pero sí `bank_name`
   * y `account_number`.
   */
  private validateBankTransferConfig(config: Record<string, any>): void {
    const accounts = config?.accounts;

    if (accounts === undefined || accounts === null) {
      throw new BadRequestException(
        'Configuración inválida: Se requiere al menos una cuenta bancaria (campo "accounts").',
      );
    }
    if (!Array.isArray(accounts)) {
      throw new BadRequestException(
        'Configuración inválida: "accounts" debe ser una lista de cuentas bancarias.',
      );
    }
    if (accounts.length === 0) {
      throw new BadRequestException(
        'Configuración inválida: agrega al menos una cuenta bancaria para transferencia.',
      );
    }

    for (const acc of accounts) {
      if (!acc || typeof acc !== 'object') {
        throw new BadRequestException(
          'Configuración inválida: cada cuenta de "accounts" debe ser un objeto.',
        );
      }
      if (
        acc.id !== undefined &&
        (typeof acc.id !== 'number' || !Number.isInteger(acc.id) || acc.id < 1)
      ) {
        throw new BadRequestException(
          'Configuración inválida: cada cuenta requiere un id numérico válido.',
        );
      }
      if (
        acc.bank_account_id !== undefined &&
        (typeof acc.bank_account_id !== 'number' ||
          !Number.isInteger(acc.bank_account_id) ||
          acc.bank_account_id < 1)
      ) {
        throw new BadRequestException(
          'Configuración inválida: cada cuenta requiere un bank_account_id numérico válido.',
        );
      }
      if (!acc.bank_name) {
        throw new BadRequestException(
          'Configuración inválida: cada cuenta requiere un nombre de banco (bank_name).',
        );
      }
      if (!acc.account_number) {
        throw new BadRequestException(
          'Configuración inválida: cada cuenta requiere un número de cuenta (account_number).',
        );
      }
    }
  }

  private async resolveOrganizationIdForStore(
    storeId: number,
  ): Promise<number | null> {
    const contextOrgId = RequestContextService.getContext()?.organization_id;
    if (contextOrgId) return contextOrgId;

    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });
    return store?.organization_id ?? null;
  }

  /**
   * QUI-1061 — filtra `custom_config.accounts` en métodos `bank_transfer`
   * contra las cuentas activas y disponibles para la tienda actual
   * (`bankAccountAvailableInStoreWhere`), preservando entradas legacy sin id.
   */
  private async filterBankTransferMethodsForStore<
    T extends {
      store_id?: number;
      custom_config: any;
      system_payment_method?: { type?: string | null } | null;
    },
  >(methods: T[]): Promise<T[]> {
    const accountIds = new Set<number>();
    for (const method of methods) {
      if (method.system_payment_method?.type !== 'bank_transfer') continue;
      for (const id of collectBankTransferAccountIds(method.custom_config)) {
        accountIds.add(id);
      }
    }

    if (accountIds.size === 0) return methods;

    const storeId =
      RequestContextService.getContext()?.store_id ?? methods[0]?.store_id;
    const allowedIds = new Set<number>();

    if (storeId) {
      const organizationId = await this.resolveOrganizationIdForStore(storeId);
      if (organizationId) {
        const validAccounts = await this.prisma.bank_accounts.findMany({
          where: {
            id: { in: Array.from(accountIds) },
            ...bankAccountAvailableInStoreWhere(storeId, organizationId),
            status: 'active',
          },
          select: { id: true },
        });
        for (const row of validAccounts) {
          allowedIds.add(row.id);
        }
      }
    }

    return methods.map((method) => {
      if (method.system_payment_method?.type !== 'bank_transfer') return method;
      return {
        ...method,
        custom_config: filterBankTransferConfigAccounts(
          method.custom_config as Record<string, any> | null | undefined,
          allowedIds,
        ),
      };
    });
  }

  /**
   * QUI-1061 — impide guardar en `custom_config.accounts` referencias a
   * cuentas bancarias que pertenezcan a otra tienda, no estén asignadas a esta
   * tienda o no estén activas.
   */
  private async validateBankTransferAccountAvailability(
    storeId: number,
    config: Record<string, any>,
  ): Promise<void> {
    const accountIds = collectBankTransferAccountIds(config);
    if (accountIds.length === 0) return;

    const organizationId = await this.resolveOrganizationIdForStore(storeId);
    if (!organizationId) {
      throw new ForbiddenException('Store context required for this operation');
    }

    const validAccounts = await this.prisma.bank_accounts.findMany({
      where: {
        id: { in: accountIds },
        ...bankAccountAvailableInStoreWhere(storeId, organizationId),
        status: 'active',
      },
      select: { id: true },
    });

    if (validAccounts.length !== accountIds.length) {
      throw new VendixHttpException(
        ErrorCodes.BANK_ACCOUNT_NOT_ASSIGNED_TO_STORE,
        'Una o más cuentas bancarias seleccionadas no están disponibles o activas para esta tienda.',
      );
    }
  }
}

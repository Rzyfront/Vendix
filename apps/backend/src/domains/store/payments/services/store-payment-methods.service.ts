import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  EnablePaymentMethodDto,
  UpdateStorePaymentMethodDto,
  ReorderPaymentMethodsDto,
} from '../dto';

@Injectable()
export class StorePaymentMethodsService {
  constructor(private prisma: StorePrismaService) { }

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
    const available_methods = await this.prisma.system_payment_methods.findMany({
      where: {
        is_active: true,
        id: { notIn: enabled_ids },
      },
      orderBy: [
        { provider: 'asc' }, // 'organization' methods first, then 'system'
        { name: 'asc' },
      ],
    });

    return available_methods;
  }

  /**
   * Get enabled payment methods for a store
   */
  async getEnabledForStore() {
    return this.prisma.store_payment_methods.findMany({
      include: {
        system_payment_method: true,
      },
      orderBy: { display_order: 'asc' },
    });
  }

  /**
   * Get single store payment method
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

    return method;
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
        return base_client.store_payment_methods.update({
          where: { id: existing.id },
          data: {
            state: 'enabled',
            // Update config if provided, otherwise keep existing
            ...(enable_dto.display_name && { display_name: enable_dto.display_name }),
            ...(enable_dto.custom_config && { custom_config: enable_dto.custom_config }),
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

    // TODO: Validate configuration against schema if exists
    // if (system_method.config_schema && enable_dto.custom_config) {
    //   validateJsonSchema(enable_dto.custom_config, system_method.config_schema);
    // }

    return base_client.store_payment_methods.create({
      data: {
        store_id: store_id,
        system_payment_method_id: system_payment_method_id,
        display_name: enable_dto.display_name || system_method.display_name,
        custom_config: enable_dto.custom_config || system_method.default_config,
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

    // TODO: Validate configuration if provided
    // if (update_dto.custom_config && method.system_payment_method.config_schema) {
    //   validateJsonSchema(update_dto.custom_config, method.system_payment_method.config_schema);
    // }

    return this.prisma.store_payment_methods.update({
      where: { id: store_payment_method_id },
      data: update_dto,
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
  async disableForStore(
    store_payment_method_id: number,
  ) {
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
  async removeFromStore(
    store_payment_method_id: number,
  ) {
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
  async reorderMethods(
    order_dto: ReorderPaymentMethodsDto,
  ) {
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
      }
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
}

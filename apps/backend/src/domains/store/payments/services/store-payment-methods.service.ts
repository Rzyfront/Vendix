import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  EnablePaymentMethodDto,
  UpdateStorePaymentMethodDto,
  ReorderPaymentMethodsDto,
} from '../dto';

@Injectable()
export class StorePaymentMethodsService {
  constructor(private prisma: StorePrismaService) {}

  /**
   * Get available payment methods for a store to enable
   * Shows only system methods that are active and not yet enabled
   */
  async getAvailableForStore() {
    // Get already enabled methods (StorePrismaService automatically filters by store_id)
    const enabledMethods = await this.prisma.store_payment_methods.findMany({
      select: { system_payment_method_id: true },
    });

    const enabledIds = enabledMethods.map((m) => m.system_payment_method_id);

    // Get available system methods not yet enabled
    return this.prisma.system_payment_methods.findMany({
      where: {
        is_active: true,
        id: { notIn: enabledIds },
      },
      orderBy: { name: 'asc' },
    });
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
  async findOne(methodId: number) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: methodId,
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
    systemPaymentMethodId: number,
    enableDto: EnablePaymentMethodDto,
  ) {

    // Verify system method exists and is active
    const systemMethod = await this.prisma.system_payment_methods.findUnique({
      where: { id: systemPaymentMethodId },
    });

    if (!systemMethod || !systemMethod.is_active) {
      throw new BadRequestException('System payment method not available');
    }

    // Check if already enabled
    const existing = await this.prisma.store_payment_methods.findFirst({
      where: {
        system_payment_method_id: systemPaymentMethodId,
      },
    });

    if (existing) {
      throw new BadRequestException(
        'This payment method is already enabled for this store',
      );
    }

    // Validate configuration if required
    if (systemMethod.requires_config && !enableDto.custom_config) {
      throw new BadRequestException(
        'This payment method requires configuration',
      );
    }

    // TODO: Validate configuration against schema if exists
    // if (systemMethod.config_schema && enableDto.custom_config) {
    //   validateJsonSchema(enableDto.custom_config, systemMethod.config_schema);
    // }

    return this.prisma.store_payment_methods.create({
      data: {
        system_payment_method_id: systemPaymentMethodId,
        display_name: enableDto.display_name,
        custom_config: enableDto.custom_config || systemMethod.default_config,
        state: 'enabled',
        display_order: enableDto.display_order || 0,
        min_amount: enableDto.min_amount,
        max_amount: enableDto.max_amount,
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
    storePaymentMethodId: number,
    updateDto: UpdateStorePaymentMethodDto,
  ) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: storePaymentMethodId,
      },
      include: {
        system_payment_method: true,
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    // TODO: Validate configuration if provided
    // if (updateDto.custom_config && method.system_payment_method.config_schema) {
    //   validateJsonSchema(updateDto.custom_config, method.system_payment_method.config_schema);
    // }

    return this.prisma.store_payment_methods.update({
      where: { id: storePaymentMethodId },
      data: updateDto,
      include: {
        system_payment_method: true,
      },
    });
  }

  /**
   * Disable payment method for a store
   */
  async disableForStore(
    storePaymentMethodId: number,
  ) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: storePaymentMethodId,
      },
    });

    if (!method) {
      throw new NotFoundException('Payment method not found for this store');
    }

    return this.prisma.store_payment_methods.update({
      where: { id: storePaymentMethodId },
      data: { state: 'disabled' },
    });
  }

  /**
   * Delete/remove payment method from store
   */
  async removeFromStore(
    storePaymentMethodId: number,
  ) {
    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: storePaymentMethodId,
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
      where: { id: storePaymentMethodId },
    });

    return { success: true, message: 'Payment method removed from store' };
  }

  /**
   * Reorder payment methods for display
   */
  async reorderMethods(
    orderDto: ReorderPaymentMethodsDto,
  ) {
    // Update display_order for each method
    const updates = orderDto.methods.map((item, index) =>
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
    const allMethods = await this.prisma.store_payment_methods.findMany({
      select: {
        state: true,
      },
    });

    // Count methods by state
    const stats = allMethods.reduce(
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
    const paymentStats = await this.prisma.payments.aggregate({
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
    const transactionCounts = await this.prisma.payments.groupBy({
      by: ['state'],
      _count: {
        state: true,
      },
    });

    const successfulTransactions =
      transactionCounts.find((tc) => tc.state === 'succeeded')?._count.state ||
      transactionCounts.find((tc) => tc.state === 'captured')?._count.state ||
      0;

    const failedTransactions =
      transactionCounts.find((tc) => tc.state === 'failed')?._count.state || 0;

    return {
      ...stats,
      total_transactions: paymentStats._count.id || 0,
      successful_transactions: successfulTransactions,
      failed_transactions: failedTransactions,
      total_revenue: parseFloat(paymentStats._sum.amount?.toString() || '0'),
    };
  }
}

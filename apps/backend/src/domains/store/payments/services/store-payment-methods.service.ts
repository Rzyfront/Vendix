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
  async getAvailableForStore(storeId: number, user: any) {
    await this.validateUserAccess(user, storeId);

    // Get already enabled methods
    const enabledMethods = await this.prisma.store_payment_methods.findMany({
      where: { store_id: storeId },
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
  async getEnabledForStore(storeId: number, user: any) {
    await this.validateUserAccess(user, storeId);

    return this.prisma.store_payment_methods.findMany({
      where: {
        store_id: storeId,
      },
      include: {
        system_payment_method: true,
      },
      orderBy: { display_order: 'asc' },
    });
  }

  /**
   * Get single store payment method
   */
  async findOne(storeId: number, methodId: number, user: any) {
    await this.validateUserAccess(user, storeId);

    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: methodId,
        store_id: storeId,
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
    storeId: number,
    systemPaymentMethodId: number,
    enableDto: EnablePaymentMethodDto,
    user: any,
  ) {
    await this.validateUserAccess(user, storeId);

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
        store_id: storeId,
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
        store_id: storeId,
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
    storeId: number,
    storePaymentMethodId: number,
    updateDto: UpdateStorePaymentMethodDto,
    user: any,
  ) {
    await this.validateUserAccess(user, storeId);

    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: storePaymentMethodId,
        store_id: storeId,
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
    storeId: number,
    storePaymentMethodId: number,
    user: any,
  ) {
    await this.validateUserAccess(user, storeId);

    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: storePaymentMethodId,
        store_id: storeId,
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
    storeId: number,
    storePaymentMethodId: number,
    user: any,
  ) {
    await this.validateUserAccess(user, storeId);

    const method = await this.prisma.store_payment_methods.findFirst({
      where: {
        id: storePaymentMethodId,
        store_id: storeId,
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
    storeId: number,
    orderDto: ReorderPaymentMethodsDto,
    user: any,
  ) {
    await this.validateUserAccess(user, storeId);

    // Update display_order for each method
    const updates = orderDto.methods.map((item, index) =>
      this.prisma.store_payment_methods.updateMany({
        where: {
          id: item.id,
          store_id: storeId,
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
   * Validate user access to store
   * Reuses logic from PaymentsService
   */
  private async validateUserAccess(user: any, storeId: number): Promise<void> {
    // 1. Allow super_admin to access any store
    if (user.roles && user.roles.includes('super_admin')) {
      return;
    }

    // 2. Check if user is explicitly assigned to the store (store_users)
    const userStoreIds = await this.getUserStoreIds(user);
    if (userStoreIds.includes(storeId)) {
      return;
    }

    // 3. Check if user's main_store_id matches the requested store
    if (user.main_store_id === storeId) {
      return;
    }

    // 4. Check if user's current token store_id matches the requested store
    if (user.store_id === storeId) {
      return;
    }

    // 5. Check if user is Owner or Admin of the Organization that owns the store
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { organization_id: true },
    });

    if (store && user.organization_id === store.organization_id) {
      if (
        user.roles &&
        (user.roles.includes('owner') || user.roles.includes('admin'))
      ) {
        return;
      }
    }

    // 6. Access denied
    throw new ForbiddenException('Access denied to this store');
  }

  /**
   * Get store IDs that user has access to
   */
  private async getUserStoreIds(user: any): Promise<number[]> {
    const storeUsers = await this.prisma.store_users.findMany({
      where: { user_id: user.id },
      select: { store_id: true },
    });

    return storeUsers.map((su: any) => su.store_id);
  }
}

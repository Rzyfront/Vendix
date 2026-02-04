import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  EnableShippingMethodDto,
  UpdateStoreShippingMethodDto,
  ReorderShippingMethodsDto,
} from '../dto/store-shipping-method.dto';

@Injectable()
export class StoreShippingMethodsService {
  constructor(private prisma: StorePrismaService) {}

  /**
   * Get available shipping methods for a store to enable
   * Shows system methods that are active and not yet enabled
   */
  async getAvailableForStore() {
    // Get already enabled methods (StorePrismaService automatically filters by store_id)
    const enabled_methods = await this.prisma.store_shipping_methods.findMany({
      select: { system_shipping_method_id: true },
    });

    const enabled_ids = enabled_methods.map((m) => m.system_shipping_method_id);

    // Get system shipping methods that are active and not yet enabled
    const available_methods = await this.prisma.shipping_methods.findMany({
      where: {
        is_active: true,
        is_system: true,
        store_id: null, // Only system-wide methods
        id: { notIn: enabled_ids },
      },
      orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    });

    return available_methods;
  }

  /**
   * Get enabled shipping methods for a store
   */
  async getEnabledForStore() {
    return this.prisma.store_shipping_methods.findMany({
      include: {
        system_shipping_method: true,
      },
      orderBy: { display_order: 'asc' },
    });
  }

  /**
   * Get single store shipping method
   */
  async findOne(method_id: number) {
    if (!method_id || isNaN(method_id)) {
      throw new NotFoundException('Invalid shipping method ID');
    }

    const method = await this.prisma.store_shipping_methods.findUnique({
      where: {
        id: method_id,
      },
      include: {
        system_shipping_method: true,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    return method;
  }

  /**
   * Enable a system shipping method for a store
   */
  async enableForStore(
    system_shipping_method_id: number,
    enable_dto: EnableShippingMethodDto,
  ) {
    // Get store_id from context for create operation
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    // Verify system method exists and is active
    const system_method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: system_shipping_method_id,
        is_system: true,
        store_id: null,
      },
    });

    if (!system_method || !system_method.is_active) {
      throw new BadRequestException('System shipping method not available');
    }

    // Check if already enabled (use base client to bypass store filtering)
    const base_client = this.prisma.withoutScope();
    const existing = await base_client.store_shipping_methods.findFirst({
      where: {
        store_id: store_id,
        system_shipping_method_id: system_shipping_method_id,
      },
    });

    if (existing) {
      if (existing.state !== 'enabled') {
        return base_client.store_shipping_methods.update({
          where: { id: existing.id },
          data: {
            state: 'enabled',
            ...(enable_dto.display_name && {
              display_name: enable_dto.display_name,
            }),
            ...(enable_dto.custom_config && {
              custom_config: enable_dto.custom_config,
            }),
          },
          include: {
            system_shipping_method: true,
          },
        });
      }

      throw new BadRequestException(
        'This shipping method is already enabled for this store',
      );
    }

    return base_client.store_shipping_methods.create({
      data: {
        store_id: store_id,
        system_shipping_method_id: system_shipping_method_id,
        display_name: enable_dto.display_name || system_method.name,
        custom_config: enable_dto.custom_config,
        state: 'enabled',
        display_order: enable_dto.display_order || 0,
        min_order_amount: enable_dto.min_order_amount,
        max_order_amount: enable_dto.max_order_amount,
      },
      include: {
        system_shipping_method: true,
      },
    });
  }

  /**
   * Update store shipping method configuration
   */
  async updateStoreMethod(
    store_shipping_method_id: number,
    update_dto: UpdateStoreShippingMethodDto,
  ) {
    const method = await this.prisma.store_shipping_methods.findFirst({
      where: {
        id: store_shipping_method_id,
      },
      include: {
        system_shipping_method: true,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    return this.prisma.store_shipping_methods.update({
      where: { id: store_shipping_method_id },
      data: update_dto,
      include: {
        system_shipping_method: true,
      },
    });
  }

  /**
   * Re-enable a disabled store shipping method
   */
  async reEnableForStore(store_shipping_method_id: number) {
    const method = await this.prisma.store_shipping_methods.findFirst({
      where: {
        id: store_shipping_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    if (method.state === 'enabled') {
      throw new BadRequestException('Shipping method is already enabled');
    }

    return this.prisma.store_shipping_methods.update({
      where: { id: store_shipping_method_id },
      data: { state: 'enabled' },
      include: {
        system_shipping_method: true,
      },
    });
  }

  /**
   * Disable shipping method for a store
   */
  async disableForStore(store_shipping_method_id: number) {
    const method = await this.prisma.store_shipping_methods.findFirst({
      where: {
        id: store_shipping_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    return this.prisma.store_shipping_methods.update({
      where: { id: store_shipping_method_id },
      data: { state: 'disabled' },
    });
  }

  /**
   * Delete/remove shipping method from store
   */
  async removeFromStore(store_shipping_method_id: number) {
    const method = await this.prisma.store_shipping_methods.findFirst({
      where: {
        id: store_shipping_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    // TODO: Check if used in any orders before allowing deletion
    // For now, we allow deletion since orders reference shipping_methods directly

    await this.prisma.store_shipping_methods.delete({
      where: { id: store_shipping_method_id },
    });

    return { success: true, message: 'Shipping method removed from store' };
  }

  /**
   * Reorder shipping methods for display
   */
  async reorderMethods(order_dto: ReorderShippingMethodsDto) {
    const updates = order_dto.methods.map((item, index) =>
      this.prisma.store_shipping_methods.updateMany({
        where: {
          id: item.id,
        },
        data: {
          display_order: index,
        },
      }),
    );

    await this.prisma.$transaction(updates);

    return { success: true, message: 'Shipping methods reordered' };
  }

  /**
   * Get shipping method statistics for the store
   */
  async getStats() {
    // Get all shipping methods for this store
    const all_methods = await this.prisma.store_shipping_methods.findMany({
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
        }
        acc.total_methods++;
        return acc;
      },
      {
        total_methods: 0,
        enabled_methods: 0,
        disabled_methods: 0,
      },
    );

    // Count orders with shipping
    const orders_with_shipping = await this.prisma.orders.count({
      where: {
        shipping_method_id: { not: null },
      },
    });

    return {
      ...stats,
      orders_using_shipping: orders_with_shipping,
    };
  }
}

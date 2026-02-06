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

    // Use withoutScope() to query system methods (which have store_id = null)
    // The scoped client would overwrite store_id: null with the current store's ID
    const base_client = this.prisma.withoutScope();

    // Get system shipping methods that are active and not yet enabled
    const available_methods = await base_client.shipping_methods.findMany({
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
   * Enable a system shipping method for a store (One-Click Magic)
   *
   * When enabling a shipping method:
   * 1. Creates the store_shipping_methods record
   * 2. Auto-copies all system zones that have rates for this method
   * 3. Copies all rates for this method within those zones
   *
   * All operations are wrapped in a transaction for atomicity.
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

    // Use base client to bypass store filtering for system methods (store_id = null)
    const base_client = this.prisma.withoutScope();

    // Verify system method exists and is active
    const system_method = await base_client.shipping_methods.findFirst({
      where: {
        id: system_shipping_method_id,
        is_system: true,
        store_id: null,
      },
    });

    if (!system_method || !system_method.is_active) {
      throw new BadRequestException('System shipping method not available');
    }

    // Check if already enabled
    const existing = await base_client.store_shipping_methods.findFirst({
      where: {
        store_id: store_id,
        system_shipping_method_id: system_shipping_method_id,
      },
    });

    if (existing) {
      if (existing.state !== 'enabled') {
        // Re-enable: Also reactivate previously copied zones and rates
        return base_client.$transaction(async (tx) => {
          // Re-enable the store_shipping_method
          const updated_method = await tx.store_shipping_methods.update({
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

          // Reactivate rates for this method in store zones
          await tx.shipping_rates.updateMany({
            where: {
              shipping_method_id: system_shipping_method_id,
              shipping_zone: { store_id: store_id },
              source_type: 'system_copy',
            },
            data: { is_active: true },
          });

          return updated_method;
        });
      }

      throw new BadRequestException(
        'This shipping method is already enabled for this store',
      );
    }

    // NEW: Wrap everything in a transaction for atomicity (One-Click Magic)
    return base_client.$transaction(async (tx) => {
      // 1. Create store_shipping_methods record
      const store_method = await tx.store_shipping_methods.create({
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

      // 2. Find all system zones that have rates for this method
      const system_zones = await tx.shipping_zones.findMany({
        where: {
          is_system: true,
          store_id: null,
          shipping_rates: {
            some: { shipping_method_id: system_shipping_method_id },
          },
        },
        include: {
          shipping_rates: {
            where: { shipping_method_id: system_shipping_method_id },
          },
        },
      });

      // 3. Copy each zone and its rates to the store
      let copied_zones_count = 0;
      let copied_rates_count = 0;

      for (const system_zone of system_zones) {
        // Check if this zone was already copied for this store
        const existing_zone_copy = await tx.shipping_zones.findFirst({
          where: {
            store_id: store_id,
            copied_from_system_zone_id: system_zone.id,
          },
        });

        let target_zone_id: number;

        if (existing_zone_copy) {
          // Zone already copied, just ensure it's active and add rates if needed
          target_zone_id = existing_zone_copy.id;
          if (!existing_zone_copy.is_active) {
            await tx.shipping_zones.update({
              where: { id: target_zone_id },
              data: { is_active: true },
            });
          }
        } else {
          // Create a new copy of the zone
          const zone_copy = await tx.shipping_zones.create({
            data: {
              store_id: store_id,
              name: system_zone.name,
              display_name: system_zone.display_name,
              countries: system_zone.countries,
              regions: system_zone.regions,
              cities: system_zone.cities,
              zip_codes: system_zone.zip_codes,
              is_active: true,
              is_system: false,
              source_type: 'system_copy',
              copied_from_system_zone_id: system_zone.id,
            },
          });
          target_zone_id = zone_copy.id;
          copied_zones_count++;
        }

        // 4. Copy rates for this zone
        for (const system_rate of system_zone.shipping_rates) {
          // Check if rate already exists
          const existing_rate = await tx.shipping_rates.findFirst({
            where: {
              shipping_zone_id: target_zone_id,
              shipping_method_id: system_shipping_method_id,
              copied_from_system_rate_id: system_rate.id,
            },
          });

          if (!existing_rate) {
            await tx.shipping_rates.create({
              data: {
                shipping_zone_id: target_zone_id,
                shipping_method_id: system_shipping_method_id,
                name: system_rate.name,
                type: system_rate.type,
                base_cost: system_rate.base_cost,
                per_unit_cost: system_rate.per_unit_cost,
                min_val: system_rate.min_val,
                max_val: system_rate.max_val,
                free_shipping_threshold: system_rate.free_shipping_threshold,
                is_active: true,
                source_type: 'system_copy',
                copied_from_system_rate_id: system_rate.id,
              },
            });
            copied_rates_count++;
          } else if (!existing_rate.is_active) {
            // Reactivate if it was deactivated
            await tx.shipping_rates.update({
              where: { id: existing_rate.id },
              data: { is_active: true },
            });
          }
        }
      }

      // Return the method with copy statistics for user feedback
      return {
        ...store_method,
        _copy_stats: {
          zones_copied: copied_zones_count,
          rates_copied: copied_rates_count,
        },
      };
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
   *
   * When disabling:
   * 1. Marks the store_shipping_method as disabled
   * 2. Deactivates (not deletes) all rates for this method in store zones
   *
   * This preserves user customizations for potential re-enabling later.
   */
  async disableForStore(store_shipping_method_id: number) {
    // Get store_id from context
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    const method = await this.prisma.store_shipping_methods.findFirst({
      where: {
        id: store_shipping_method_id,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    const base_client = this.prisma.withoutScope();

    // Wrap in transaction to ensure consistency
    return base_client.$transaction(async (tx) => {
      // 1. Disable the store_shipping_method
      const updated_method = await tx.store_shipping_methods.update({
        where: { id: store_shipping_method_id },
        data: { state: 'disabled' },
      });

      // 2. Deactivate all rates for this method in zones belonging to this store
      // This includes both system_copy and custom zones
      await tx.shipping_rates.updateMany({
        where: {
          shipping_method_id: method.system_shipping_method_id,
          shipping_zone: { store_id: store_id },
        },
        data: { is_active: false },
      });

      return updated_method;
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
   * Enhanced with zone and rate statistics for the new shipping module design
   */
  async getStats() {
    // Get all shipping methods for this store
    const all_methods = await this.prisma.store_shipping_methods.findMany({
      select: {
        state: true,
      },
    });

    // Count methods by state
    const method_stats = all_methods.reduce(
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

    // Count zones configured for this store
    const zones = await this.prisma.shipping_zones.findMany({
      where: { is_active: true },
      select: { source_type: true },
    });

    const zone_stats = zones.reduce(
      (acc, zone) => {
        acc.total_zones++;
        if (zone.source_type === 'system_copy') {
          acc.system_copy_zones++;
        } else if (zone.source_type === 'custom') {
          acc.custom_zones++;
        }
        return acc;
      },
      {
        total_zones: 0,
        system_copy_zones: 0,
        custom_zones: 0,
      },
    );

    // Count active rates
    const total_rates = await this.prisma.shipping_rates.count({
      where: { is_active: true },
    });

    // Count orders with shipping
    const orders_with_shipping = await this.prisma.orders.count({
      where: {
        shipping_method_id: { not: null },
      },
    });

    return {
      ...method_stats,
      ...zone_stats,
      total_rates,
      orders_using_shipping: orders_with_shipping,
    };
  }
}

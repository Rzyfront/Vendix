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
   * Shows system methods that are active and not yet copied to this store
   */
  async getAvailableForStore() {
    // Get store_id from context
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    // Use base client to query across scopes
    const base_client = this.prisma.withoutScope();

    // Get system method IDs already copied to this store
    const copied_methods = await base_client.shipping_methods.findMany({
      where: {
        store_id: store_id,
        is_system: false,
        copied_from_system_method_id: { not: null },
      },
      select: { copied_from_system_method_id: true },
    });

    const copied_ids = copied_methods
      .map((m) => m.copied_from_system_method_id)
      .filter((id): id is number => id !== null);

    // Get system shipping methods that are active and not yet copied
    const available_methods = await base_client.shipping_methods.findMany({
      where: {
        is_active: true,
        is_system: true,
        store_id: null,
        id: { notIn: copied_ids },
      },
      orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    });

    return available_methods;
  }

  /**
   * Get enabled shipping methods for a store
   * Returns store's own copies of system methods (is_system=false, store_id=current)
   */
  async getEnabledForStore() {
    return this.prisma.shipping_methods.findMany({
      where: {
        is_system: false,
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

    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
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
   * Creates a COPY of the system method in shipping_methods with the store's store_id.
   * Also auto-copies all system zones that have rates for this method,
   * and copies all rates referencing the NEW store method ID.
   *
   * All operations are wrapped in a transaction for atomicity.
   */
  async enableForStore(
    system_shipping_method_id: number,
    enable_dto: EnableShippingMethodDto,
  ) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

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

    // Check if already copied to this store
    const existing = await base_client.shipping_methods.findFirst({
      where: {
        store_id: store_id,
        copied_from_system_method_id: system_shipping_method_id,
      },
    });

    if (existing) {
      if (!existing.is_active) {
        // Re-enable: reactivate the existing copy and its rates
        return base_client.$transaction(async (tx) => {
          const updated_method = await tx.shipping_methods.update({
            where: { id: existing.id },
            data: {
              is_active: true,
              ...(enable_dto.name && { name: enable_dto.name }),
              ...(enable_dto.custom_config && {
                custom_config: enable_dto.custom_config,
              }),
            },
          });

          // Reactivate rates for this store method in store zones
          await tx.shipping_rates.updateMany({
            where: {
              shipping_method_id: existing.id,
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

    // NEW: Create a copy of the system method + copy zones/rates
    return base_client.$transaction(async (tx) => {
      // 1. Create a copy of the system method for this store
      const store_method = await tx.shipping_methods.create({
        data: {
          store_id: store_id,
          name: enable_dto.name || system_method.name,
          code: system_method.code,
          description: system_method.description,
          logo_url: system_method.logo_url,
          type: system_method.type,
          provider_name: system_method.provider_name,
          tracking_url: system_method.tracking_url,
          min_days: system_method.min_days,
          max_days: system_method.max_days,
          is_active: true,
          is_system: false,
          display_order: enable_dto.display_order || 0,
          custom_config: enable_dto.custom_config,
          min_order_amount: enable_dto.min_order_amount,
          max_order_amount: enable_dto.max_order_amount,
          copied_from_system_method_id: system_shipping_method_id,
        },
      });

      // 2. Find all system zones that have rates for this system method
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
          target_zone_id = existing_zone_copy.id;
          if (!existing_zone_copy.is_active) {
            await tx.shipping_zones.update({
              where: { id: target_zone_id },
              data: { is_active: true },
            });
          }
        } else {
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

        // 4. Copy rates — use the NEW store method ID, not the system method ID
        for (const system_rate of system_zone.shipping_rates) {
          const existing_rate = await tx.shipping_rates.findFirst({
            where: {
              shipping_zone_id: target_zone_id,
              shipping_method_id: store_method.id,
              copied_from_system_rate_id: system_rate.id,
            },
          });

          if (!existing_rate) {
            await tx.shipping_rates.create({
              data: {
                shipping_zone_id: target_zone_id,
                shipping_method_id: store_method.id,
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
            await tx.shipping_rates.update({
              where: { id: existing_rate.id },
              data: { is_active: true },
            });
          }
        }
      }

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
    method_id: number,
    update_dto: UpdateStoreShippingMethodDto,
  ) {
    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    return this.prisma.shipping_methods.update({
      where: { id: method_id },
      data: update_dto,
    });
  }

  /**
   * Re-enable a disabled store shipping method
   */
  async reEnableForStore(method_id: number) {
    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    if (method.is_active) {
      throw new BadRequestException('Shipping method is already enabled');
    }

    return this.prisma.shipping_methods.update({
      where: { id: method_id },
      data: { is_active: true },
    });
  }

  /**
   * Disable shipping method for a store
   *
   * When disabling:
   * 1. Marks the shipping method as inactive
   * 2. Deactivates (not deletes) all rates for this method in store zones
   */
  async disableForStore(method_id: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    const base_client = this.prisma.withoutScope();

    return base_client.$transaction(async (tx) => {
      // 1. Disable the shipping method
      const updated_method = await tx.shipping_methods.update({
        where: { id: method_id },
        data: { is_active: false },
      });

      // 2. Deactivate all rates for THIS store method in zones belonging to this store
      await tx.shipping_rates.updateMany({
        where: {
          shipping_method_id: method_id,
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
  async removeFromStore(method_id: number) {
    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
      },
    });

    if (!method) {
      throw new NotFoundException('Shipping method not found for this store');
    }

    await this.prisma.shipping_methods.delete({
      where: { id: method_id },
    });

    return { success: true, message: 'Shipping method removed from store' };
  }

  /**
   * Reorder shipping methods for display
   */
  async reorderMethods(order_dto: ReorderShippingMethodsDto) {
    const updates = order_dto.methods.map((item, index) =>
      this.prisma.shipping_methods.updateMany({
        where: {
          id: item.id,
          is_system: false,
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
    // Get all store shipping methods (is_system=false, scoped by store_id)
    const all_methods = await this.prisma.shipping_methods.findMany({
      where: { is_system: false },
      select: { is_active: true },
    });

    // Count methods by active state
    const method_stats = all_methods.reduce(
      (acc, method) => {
        if (method.is_active) {
          acc.enabled_methods++;
        } else {
          acc.disabled_methods++;
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

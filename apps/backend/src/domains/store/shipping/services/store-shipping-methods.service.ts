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
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

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
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
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
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
    }

    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
      },
    });

    if (!method) {
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
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
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
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
          // Plan Despacho Economía — FASE 2 paso 8: copiar la política tipada
          // desde el método de sistema (defaults de fábrica). El DTO permite
          // sobrescribir al habilitar (ej. una tienda quiere su propio vehículo).
          collects_payment:
            enable_dto.collects_payment ?? system_method.collects_payment ?? false,
          payment_timing:
            enable_dto.payment_timing ?? system_method.payment_timing ?? 'on_delivery',
          generates_transport_cost:
            enable_dto.generates_transport_cost ??
            system_method.generates_transport_cost ??
            'none',
          default_vehicle_id:
            enable_dto.default_vehicle_id ?? system_method.default_vehicle_id ?? null,
          default_driver_user_id:
            enable_dto.default_driver_user_id ?? system_method.default_driver_user_id ?? null,
          default_carrier_supplier_id:
            enable_dto.default_carrier_supplier_id ??
            system_method.default_carrier_supplier_id ??
            null,
          cost_settlement_timing:
            enable_dto.cost_settlement_timing ??
            system_method.cost_settlement_timing ??
            'immediate_on_close',
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
   *
   * Plan Despacho Economía — FASE 2 paso 8:
   * `generates_transport_cost` y los defaults se validan con reglas cruzadas:
   *   - Si genera costo de transporte, el ejecutor por defecto debe ser
   *     coherente con `type`:
   *       `own_fleet`      ⇒ `default_vehicle_id` (y opcional driver_user_id)
   *       `carrier | third_party_provider` ⇒ `default_carrier_supplier_id`
   *   - Si NO genera costo (none), no se exige ejecutor.
   *   - Los ejecutores deben pertenecer a la misma tienda del método.
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
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
    }

    // Resolver valores efectivos (mezcla dto + método existente) antes de validar.
    const next_type =
      update_dto.generates_transport_cost ?? method.generates_transport_cost;
    const next_method_type = update_dto.name || method.type;
    const next_default_vehicle =
      update_dto.default_vehicle_id !== undefined
        ? update_dto.default_vehicle_id
        : method.default_vehicle_id;
    const next_default_driver =
      update_dto.default_driver_user_id !== undefined
        ? update_dto.default_driver_user_id
        : method.default_driver_user_id;
    const next_default_carrier =
      update_dto.default_carrier_supplier_id !== undefined
        ? update_dto.default_carrier_supplier_id
        : method.default_carrier_supplier_id;

    if (next_type && next_type !== 'none') {
      if (
        next_method_type === 'own_fleet' &&
        next_default_vehicle == null
      ) {
        throw new BadRequestException(
          'Si el método es own_fleet con costo de transporte, debe tener default_vehicle_id',
        );
      }
      if (
        (next_method_type === 'carrier' ||
          next_method_type === 'third_party_provider') &&
        next_default_carrier == null
      ) {
        throw new BadRequestException(
          'Si el método es carrier/third_party_provider con costo de transporte, debe tener default_carrier_supplier_id',
        );
      }
    }

    // Validar que los ejecutores pertenezcan al tenant actual.
    if (next_default_vehicle != null) {
      const v = await this.prisma.vehicles.findFirst({
        where: { id: next_default_vehicle, store_id: method.store_id ?? undefined },
      });
      if (!v) {
        throw new BadRequestException(
          `El vehículo #${next_default_vehicle} no pertenece a esta tienda`,
        );
      }
    }
    if (next_default_carrier != null) {
      const s = await this.prisma.suppliers.findFirst({
        where: { id: next_default_carrier, store_id: method.store_id ?? undefined },
      });
      if (!s) {
        throw new BadRequestException(
          `El proveedor transportista #${next_default_carrier} no pertenece a esta tienda`,
        );
      }
      if (s.supplier_category !== 'carrier') {
        throw new BadRequestException(
          `El proveedor #${next_default_carrier} debe tener supplier_category='carrier'`,
        );
      }
    }

    return this.prisma.shipping_methods.update({
      where: { id: method_id },
      data: update_dto,
    });
  }

  /**
   * Plan Despacho Economía — FASE 2 paso 8.
   * Política efectiva del método: merge del método con defaults globales de
   * la tienda (`store_settings.dispatch`). El método tiene precedencia.
   *
   * GET /store/shipping/methods/:id/policy
   */
  async getEffectivePolicy(method_id: number) {
    const method = await this.prisma.shipping_methods.findFirst({
      where: { id: method_id, is_system: false },
    });
    if (!method) {
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
    }

    const store_id = method.store_id;
    const settings = store_id
      ? await this.prisma.store_settings.findFirst({
          where: { store_id, section: 'dispatch' },
        })
      : null;
    const defaults =
      (settings?.settings as Record<string, unknown> | null) ?? {};

    return {
      method_id: method.id,
      method_type: method.type,
      collects_payment: method.collects_payment,
      payment_timing: method.payment_timing,
      generates_transport_cost: method.generates_transport_cost,
      default_vehicle_id: method.default_vehicle_id,
      default_driver_user_id: method.default_driver_user_id,
      default_carrier_supplier_id: method.default_carrier_supplier_id,
      cost_settlement_timing: method.cost_settlement_timing,
      // Defaults globales como fallback explícito (lo usa el frontend cuando
      // el método no define un campo).
      store_defaults: defaults,
    };
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
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
    }

    if (method.is_active) {
      throw new VendixHttpException(ErrorCodes.SHIP_VALIDATE_001);
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
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const method = await this.prisma.shipping_methods.findFirst({
      where: {
        id: method_id,
        is_system: false,
      },
    });

    if (!method) {
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
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
      throw new VendixHttpException(ErrorCodes.SHIP_FIND_001);
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

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  CreateZoneDto,
  UpdateZoneDto,
  CreateRateDto,
  UpdateRateDto,
} from '../dto/store-shipping-zones.dto';

@Injectable()
export class StoreShippingZonesService {
  constructor(private prisma: StorePrismaService) {}

  // ========== ZONAS DEL SISTEMA (Solo lectura) ==========

  /**
   * Get all active system shipping zones (for reference)
   * These are created by super-admin and visible to all stores
   */
  async getSystemZones() {
    const base_client = this.prisma.withoutScope();
    return base_client.shipping_zones.findMany({
      where: {
        is_system: true,
        is_active: true,
        store_id: null,
      },
      include: {
        _count: {
          select: { shipping_rates: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get rates for a specific system zone
   */
  async getSystemZoneRates(zone_id: number) {
    const base_client = this.prisma.withoutScope();

    // Verify it's a system zone
    const zone = await base_client.shipping_zones.findFirst({
      where: {
        id: zone_id,
        is_system: true,
        store_id: null,
      },
    });

    if (!zone) {
      throw new NotFoundException('Zona del sistema no encontrada');
    }

    return base_client.shipping_rates.findMany({
      where: {
        shipping_zone_id: zone_id,
        is_active: true,
      },
      include: {
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            logo_url: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ========== ZONAS DE TIENDA (CRUD) ==========

  /**
   * Get all shipping zones owned by the current store
   */
  async getStoreZones() {
    // StorePrismaService automatically filters by store_id
    return this.prisma.shipping_zones.findMany({
      where: {
        is_system: false, // Only store-specific zones
      },
      include: {
        _count: {
          select: { shipping_rates: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a new shipping zone for the store
   */
  async createStoreZone(dto: CreateZoneDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    // Use base client to create with explicit store_id
    const base_client = this.prisma.withoutScope();

    return base_client.shipping_zones.create({
      data: {
        name: dto.name,
        display_name: dto.display_name,
        countries: dto.countries,
        regions: dto.regions || [],
        cities: dto.cities || [],
        zip_codes: dto.zip_codes || [],
        is_active: dto.is_active ?? true,
        store_id: store_id,
        is_system: false,
        source_type: 'custom', // Zones created from scratch are custom
      },
      include: {
        _count: {
          select: { shipping_rates: true },
        },
      },
    });
  }

  /**
   * Update a store's shipping zone
   */
  async updateStoreZone(id: number, dto: UpdateZoneDto) {
    const zone = await this.prisma.shipping_zones.findFirst({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Zona no encontrada');
    }

    if (zone.is_system) {
      throw new ForbiddenException('No se pueden editar zonas del sistema');
    }

    return this.prisma.shipping_zones.update({
      where: { id },
      data: dto,
      include: {
        _count: {
          select: { shipping_rates: true },
        },
      },
    });
  }

  /**
   * Delete a store's shipping zone (cascade deletes rates)
   */
  async deleteStoreZone(id: number) {
    const zone = await this.prisma.shipping_zones.findFirst({
      where: { id },
    });

    if (!zone) {
      throw new NotFoundException('Zona no encontrada');
    }

    if (zone.is_system) {
      throw new ForbiddenException('No se pueden eliminar zonas del sistema');
    }

    // Rates are deleted automatically via onDelete: Cascade
    return this.prisma.shipping_zones.delete({
      where: { id },
    });
  }

  // ========== TARIFAS DE ZONAS DE TIENDA (CRUD) ==========

  /**
   * Get rates for a store's zone
   */
  async getStoreZoneRates(zone_id: number) {
    // Verify the zone belongs to this store and is not a system zone
    const zone = await this.prisma.shipping_zones.findFirst({
      where: {
        id: zone_id,
        is_system: false,
      },
    });

    if (!zone) {
      throw new NotFoundException('Zona de tienda no encontrada');
    }

    return this.prisma.shipping_rates.findMany({
      where: { shipping_zone_id: zone_id },
      include: {
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            logo_url: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a rate for a store's zone
   */
  async createStoreRate(dto: CreateRateDto) {
    // Verify the zone belongs to this store and is not a system zone
    const zone = await this.prisma.shipping_zones.findFirst({
      where: {
        id: dto.shipping_zone_id,
        is_system: false,
      },
    });

    if (!zone) {
      throw new NotFoundException('Zona de tienda no encontrada');
    }

    // Verify shipping method exists
    const base_client = this.prisma.withoutScope();
    const method = await base_client.shipping_methods.findFirst({
      where: { id: dto.shipping_method_id },
    });

    if (!method) {
      throw new NotFoundException('Método de envío no encontrado');
    }

    return this.prisma.shipping_rates.create({
      data: {
        shipping_zone_id: dto.shipping_zone_id,
        shipping_method_id: dto.shipping_method_id,
        name: dto.name,
        type: dto.type,
        base_cost: dto.base_cost,
        per_unit_cost: dto.per_unit_cost,
        min_val: dto.min_val,
        max_val: dto.max_val,
        free_shipping_threshold: dto.free_shipping_threshold,
        is_active: dto.is_active ?? true,
      },
      include: {
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            logo_url: true,
          },
        },
      },
    });
  }

  /**
   * Update a rate in a store's zone
   */
  async updateStoreRate(id: number, dto: UpdateRateDto) {
    const rate = await this.prisma.shipping_rates.findFirst({
      where: { id },
      include: {
        shipping_zone: true,
      },
    });

    if (!rate) {
      throw new NotFoundException('Tarifa no encontrada');
    }

    if (rate.shipping_zone?.is_system) {
      throw new ForbiddenException('No se pueden editar tarifas del sistema');
    }

    // Remove zone_id from update if present (can't change zone)
    const { shipping_zone_id, ...update_data } = dto;

    return this.prisma.shipping_rates.update({
      where: { id },
      data: update_data,
      include: {
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            logo_url: true,
          },
        },
      },
    });
  }

  /**
   * Delete a rate from a store's zone
   */
  async deleteStoreRate(id: number) {
    const rate = await this.prisma.shipping_rates.findFirst({
      where: { id },
      include: {
        shipping_zone: true,
      },
    });

    if (!rate) {
      throw new NotFoundException('Tarifa no encontrada');
    }

    if (rate.shipping_zone?.is_system) {
      throw new ForbiddenException('No se pueden eliminar tarifas del sistema');
    }

    return this.prisma.shipping_rates.delete({
      where: { id },
    });
  }

  // ========== DUPLICACIÓN DEL SISTEMA ==========

  /**
   * Duplicate a system zone to create an editable copy for the store.
   * The copy will have source_type='custom' and can be fully edited.
   */
  async duplicateSystemZone(system_zone_id: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    const base_client = this.prisma.withoutScope();

    // Verify it's a system zone
    const system_zone = await base_client.shipping_zones.findFirst({
      where: {
        id: system_zone_id,
        is_system: true,
        store_id: null,
      },
      include: {
        shipping_rates: true,
      },
    });

    if (!system_zone) {
      throw new NotFoundException('Zona del sistema no encontrada');
    }

    // Create a copy with source_type='custom'
    return base_client.$transaction(async (tx) => {
      // Create the zone copy
      const zone_copy = await tx.shipping_zones.create({
        data: {
          store_id: store_id,
          name: `Copia de ${system_zone.name}`,
          display_name: system_zone.display_name
            ? `Copia de ${system_zone.display_name}`
            : null,
          countries: system_zone.countries,
          regions: system_zone.regions,
          cities: system_zone.cities,
          zip_codes: system_zone.zip_codes,
          is_active: true,
          is_system: false,
          source_type: 'custom', // Mark as custom for full editing
          copied_from_system_zone_id: system_zone.id,
        },
      });

      // Copy all rates
      const rate_copies: Awaited<ReturnType<typeof tx.shipping_rates.create>>[] = [];
      for (const rate of system_zone.shipping_rates) {
        const rate_copy = await tx.shipping_rates.create({
          data: {
            shipping_zone_id: zone_copy.id,
            shipping_method_id: rate.shipping_method_id,
            name: rate.name,
            type: rate.type,
            base_cost: rate.base_cost,
            per_unit_cost: rate.per_unit_cost,
            min_val: rate.min_val,
            max_val: rate.max_val,
            free_shipping_threshold: rate.free_shipping_threshold,
            is_active: true,
            source_type: 'custom',
            copied_from_system_rate_id: rate.id,
          },
        });
        rate_copies.push(rate_copy);
      }

      return {
        ...zone_copy,
        shipping_rates: rate_copies,
        _count: { shipping_rates: rate_copies.length },
      };
    });
  }

  /**
   * Duplicate a specific system rate to a store zone.
   * Useful for selectively adding rates from system zones.
   */
  async duplicateSystemRate(
    system_rate_id: number,
    target_zone_id: number,
  ) {
    const base_client = this.prisma.withoutScope();

    // Verify the rate is from a system zone
    const system_rate = await base_client.shipping_rates.findFirst({
      where: { id: system_rate_id },
      include: {
        shipping_zone: true,
        shipping_method: true,
      },
    });

    if (!system_rate || !system_rate.shipping_zone?.is_system) {
      throw new NotFoundException('Tarifa del sistema no encontrada');
    }

    // Verify target zone belongs to this store
    const target_zone = await this.prisma.shipping_zones.findFirst({
      where: {
        id: target_zone_id,
        is_system: false,
      },
    });

    if (!target_zone) {
      throw new NotFoundException('Zona destino no encontrada');
    }

    // Create the rate copy
    return this.prisma.shipping_rates.create({
      data: {
        shipping_zone_id: target_zone_id,
        shipping_method_id: system_rate.shipping_method_id,
        name: system_rate.name,
        type: system_rate.type,
        base_cost: system_rate.base_cost,
        per_unit_cost: system_rate.per_unit_cost,
        min_val: system_rate.min_val,
        max_val: system_rate.max_val,
        free_shipping_threshold: system_rate.free_shipping_threshold,
        is_active: true,
        source_type: 'custom',
        copied_from_system_rate_id: system_rate.id,
      },
      include: {
        shipping_method: {
          select: {
            id: true,
            name: true,
            type: true,
            logo_url: true,
          },
        },
      },
    });
  }

  /**
   * Get pending updates for system zones that were copied to this store.
   * Shows changes made by super-admin that the store might want to sync.
   */
  async getSystemZoneUpdates(zone_id: number) {
    // Verify the zone belongs to this store and was copied from system
    const zone = await this.prisma.shipping_zones.findFirst({
      where: {
        id: zone_id,
        is_system: false,
        source_type: 'system_copy',
        copied_from_system_zone_id: { not: null },
      },
    });

    if (!zone) {
      throw new NotFoundException(
        'Zona no encontrada o no es una copia del sistema',
      );
    }

    const base_client = this.prisma.withoutScope();

    // Get updates for the source system zone since this copy was last updated
    return base_client.system_zone_updates.findMany({
      where: {
        system_zone_id: zone.copied_from_system_zone_id!,
        created_at: { gt: zone.updated_at || zone.created_at },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Sync a store zone with its source system zone.
   * Only applies to zones with source_type='system_copy'.
   */
  async syncWithSystem(zone_id: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    // Verify the zone belongs to this store and was copied from system
    const store_zone = await this.prisma.shipping_zones.findFirst({
      where: {
        id: zone_id,
        is_system: false,
        source_type: 'system_copy',
        copied_from_system_zone_id: { not: null },
      },
    });

    if (!store_zone) {
      throw new NotFoundException(
        'Zona no encontrada o no es una copia del sistema',
      );
    }

    const base_client = this.prisma.withoutScope();

    // Get the source system zone with its rates
    const system_zone = await base_client.shipping_zones.findFirst({
      where: {
        id: store_zone.copied_from_system_zone_id!,
        is_system: true,
      },
      include: {
        shipping_rates: true,
      },
    });

    if (!system_zone) {
      throw new NotFoundException('Zona del sistema original ya no existe');
    }

    // Sync in a transaction
    return base_client.$transaction(async (tx) => {
      // Update zone properties
      const updated_zone = await tx.shipping_zones.update({
        where: { id: zone_id },
        data: {
          name: system_zone.name,
          display_name: system_zone.display_name,
          countries: system_zone.countries,
          regions: system_zone.regions,
          cities: system_zone.cities,
          zip_codes: system_zone.zip_codes,
          updated_at: new Date(),
        },
      });

      // Sync rates: add new ones, update existing ones
      let synced_rates = 0;
      let new_rates = 0;

      for (const system_rate of system_zone.shipping_rates) {
        const existing_rate = await tx.shipping_rates.findFirst({
          where: {
            shipping_zone_id: zone_id,
            copied_from_system_rate_id: system_rate.id,
          },
        });

        if (existing_rate) {
          // Update existing rate
          await tx.shipping_rates.update({
            where: { id: existing_rate.id },
            data: {
              name: system_rate.name,
              type: system_rate.type,
              base_cost: system_rate.base_cost,
              per_unit_cost: system_rate.per_unit_cost,
              min_val: system_rate.min_val,
              max_val: system_rate.max_val,
              free_shipping_threshold: system_rate.free_shipping_threshold,
              updated_at: new Date(),
            },
          });
          synced_rates++;
        } else {
          // Create new rate
          await tx.shipping_rates.create({
            data: {
              shipping_zone_id: zone_id,
              shipping_method_id: system_rate.shipping_method_id,
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
          new_rates++;
        }
      }

      return {
        zone: updated_zone,
        _sync_stats: {
          rates_updated: synced_rates,
          rates_added: new_rates,
        },
      };
    });
  }

  // ========== ESTADÍSTICAS ==========

  /**
   * Get statistics for zones and rates
   */
  async getStats() {
    const base_client = this.prisma.withoutScope();

    const [system_zones, store_zones, store_rates] = await Promise.all([
      // Count active system zones
      base_client.shipping_zones.count({
        where: {
          is_system: true,
          is_active: true,
          store_id: null,
        },
      }),
      // Count store zones (StorePrismaService filters by store_id)
      this.prisma.shipping_zones.count({
        where: { is_system: false },
      }),
      // Count rates in store zones
      this.prisma.shipping_rates.count({
        where: {
          shipping_zone: {
            is_system: false,
          },
        },
      }),
    ]);

    return {
      system_zones,
      store_zones,
      store_rates,
    };
  }

  // ========== MÉTODOS DE ENVÍO DISPONIBLES ==========

  /**
   * Get shipping methods available for creating rates
   * Returns both system methods and store-enabled methods
   */
  async getAvailableShippingMethods() {
    const base_client = this.prisma.withoutScope();

    // Get system shipping methods (active ones)
    const system_methods = await base_client.shipping_methods.findMany({
      where: {
        is_system: true,
        is_active: true,
        store_id: null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        logo_url: true,
      },
      orderBy: { name: 'asc' },
    });

    return system_methods;
  }
}

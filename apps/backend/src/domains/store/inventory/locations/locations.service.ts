import { Injectable, ForbiddenException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationQueryDto } from './dto/location-query.dto';

@Injectable()
export class LocationsService {
  constructor(private prisma: StorePrismaService) {}

  create(createLocationDto: CreateLocationDto) {
    return this.prisma.inventory_locations.create({
      data: createLocationDto,
    });
  }

  findAll(query: LocationQueryDto) {
    return this.prisma.inventory_locations.findMany({
      where: {
        type: query.type,
        is_active: query.is_active,
      },
      include: {
        addresses: true,
      },
    });
  }

  findOne(id: number) {
    return this.prisma.inventory_locations.findUnique({
      where: { id },
      include: {
        addresses: true,
      },
    });
  }

  update(id: number, updateLocationDto: UpdateLocationDto) {
    return this.prisma.inventory_locations.update({
      where: { id },
      data: updateLocationDto,
    });
  }

  remove(id: number) {
    return this.prisma.inventory_locations.update({
      where: { id },
      data: { is_active: false },
    });
  }

  /**
   * Obtiene la ubicación default para un store
   */
  async getDefaultLocation(storeId: number): Promise<any> {
    // Primero buscar ubicaciones específicas del store
    let location = await this.prisma.inventory_locations.findFirst({
      where: {
        store_id: storeId,
        is_active: true,
        type: 'warehouse', // Priorizar warehouses
      },
    });

    // Si no hay warehouse, buscar cualquier ubicación del store
    if (!location) {
      location = await this.prisma.inventory_locations.findFirst({
        where: {
          store_id: storeId,
          is_active: true,
        },
      });
    }

    // Si no hay ubicaciones del store, buscar de la organización
    if (!location) {
      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
        select: { organization_id: true },
      });

      if (store) {
        location = await this.prisma.inventory_locations.findFirst({
          where: {
            organization_id: store.organization_id,
            store_id: null,
            is_active: true,
            type: 'warehouse',
          },
        });

        // Si no hay warehouse, buscar cualquier ubicación de la organización
        if (!location) {
          location = await this.prisma.inventory_locations.findFirst({
            where: {
              organization_id: store.organization_id,
              store_id: null,
              is_active: true,
            },
          });
        }
      }
    }

    // Si todavía no hay ubicación, crear una default
    if (!location) {
      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
        select: { organization_id: true, name: true },
      });

      if (store) {
        location = await this.prisma.inventory_locations.create({
          data: {
            organization_id: store.organization_id,
            store_id: storeId,
            name: `${store.name} - Default Location`,
            code: `DEFAULT-${storeId}`,
            type: 'warehouse',
            is_active: true,
          },
        });
      }
    }

    if (!location) {
      throw new Error(`No default location found for store ${storeId}`);
    }

    return location;
  }

  /**
   * Obtiene todas las ubicaciones de una organización
   */
  async getLocationsByOrganization(organizationId: number) {
    return await this.prisma.inventory_locations.findMany({
      where: {
        organization_id: organizationId,
        is_active: true,
      },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { store_id: 'asc' }, // Ubicaciones de organización primero
        { type: 'asc' }, // Luego por tipo
        { name: 'asc' },
      ],
    });
  }
}

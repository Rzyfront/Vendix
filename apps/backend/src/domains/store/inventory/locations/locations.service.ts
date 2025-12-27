import { Injectable, ForbiddenException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationQueryDto } from './dto/location-query.dto';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class LocationsService {
  constructor(private prisma: StorePrismaService) { }

  async create(createLocationDto: CreateLocationDto) {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new BadRequestException('Organization context is missing');
    }

    const { address, ...locationData } = createLocationDto;

    return this.prisma.$transaction(async (tx) => {
      let newAddress: any = null;

      if (address) {
        newAddress = await tx.addresses.create({
          data: {
            address_line1: address.address_line_1,
            address_line2: address.address_line_2,
            city: address.city,
            state_province: address.state,
            postal_code: address.postal_code,
            country_code: (address.country && address.country.length <= 3) ? address.country : 'COL',
            organization_id: context.organization_id,
            store_id: createLocationDto.store_id || context.store_id,
          }
        });
      }

      return tx.inventory_locations.create({
        data: {
          ...(locationData as any),
          organization_id: context.organization_id,
          store_id: createLocationDto.store_id || context.store_id,
          address_id: newAddress?.id
        },
        include: {
          addresses: true
        }
      });
    });
  }

  async findAll(query: LocationQueryDto) {
    const context = RequestContextService.getContext();
    const where: any = {
      organization_id: context?.organization_id,
      is_active: query.is_active,
      type: query.type,
    };

    // Add search filter
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.inventory_locations.findMany({
        where,
        include: {
          addresses: true,
        },
        orderBy: {
          name: 'asc',
        },
        skip,
        take: limit,
      }),
      this.prisma.inventory_locations.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  findOne(id: number) {
    return this.prisma.inventory_locations.findUnique({
      where: { id },
      include: {
        addresses: true,
      },
    });
  }

  async update(id: number, updateLocationDto: UpdateLocationDto) {
    const context = RequestContextService.getContext();
    const { address, ...locationData } = updateLocationDto;

    const data: any = { ...locationData };

    if (address) {
      // Check if location already has an address
      const location = await this.prisma.inventory_locations.findUnique({
        where: { id },
        select: { address_id: true }
      });

      if (location?.address_id) {
        data.addresses = {
          update: {
            address_line1: address.address_line_1,
            address_line2: address.address_line_2,
            city: address.city,
            state_province: address.state,
            postal_code: address.postal_code,
            country_code: (address.country && address.country.length <= 3) ? address.country : 'COL',
          }
        };
      } else {
        data.addresses = {
          create: {
            address_line1: address.address_line_1,
            address_line2: address.address_line_2,
            city: address.city,
            state_province: address.state,
            postal_code: address.postal_code,
            country_code: (address.country && address.country.length <= 3) ? address.country : 'COL',
            organization_id: context?.organization_id,
            store_id: updateLocationDto.store_id || context?.store_id,
          }
        };
      }
    }

    return this.prisma.inventory_locations.update({
      where: { id },
      data,
      include: {
        addresses: true
      }
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

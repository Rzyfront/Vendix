import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  AddressQueryDto,
  UpdateGPSCoordinatesDto,
} from './dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  async create(createAddressDto: CreateAddressDto, user: any) {
    if (!createAddressDto.store_id) {
      throw new BadRequestException('store_id must be provided');
    }

    await this.validateStoreAccess(createAddressDto.store_id, user);

    if (createAddressDto.is_default) {
      await this.unsetOtherDefaults({ store_id: createAddressDto.store_id });
    }

    const addressData: Prisma.addressesUncheckedCreateInput = {
      address_line1: createAddressDto.address_line_1,
      address_line2: createAddressDto.address_line_2,
      city: createAddressDto.city,
      state_province: createAddressDto.state,
      postal_code: createAddressDto.postal_code,
      country_code: createAddressDto.country,
      type: createAddressDto.type as any,
      is_primary: createAddressDto.is_default,
      latitude: createAddressDto.latitude
        ? parseFloat(createAddressDto.latitude)
        : null,
      longitude: createAddressDto.longitude
        ? parseFloat(createAddressDto.longitude)
        : null,
      store_id: createAddressDto.store_id,
    };

    try {
      return await this.prisma.addresses.create({
        data: addressData,
        include: {
          stores: { select: { id: true, name: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid store reference');
        }
      }
      throw error;
    }
  }

  async findAll(query: AddressQueryDto, user: any) {
    const {
      page = 1,
      limit = 10,
      search,
      store_id,
      type,
      is_default,
      city,
      state,
      country,
      sort_by = 'id',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const where: Prisma.addressesWhereInput = {};

    if (search) {
      where.OR = [
        { address_line1: { contains: search, mode: 'insensitive' } },
        { address_line2: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { state_province: { contains: search, mode: 'insensitive' } },
        { postal_code: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (store_id) {
      where.store_id = store_id;
      await this.validateStoreAccess(store_id, user);
    }
    if (type) where.type = type as any;
    if (is_default !== undefined) where.is_primary = is_default;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state_province = { contains: state, mode: 'insensitive' };
    if (country)
      where.country_code = { contains: country, mode: 'insensitive' };

    const [addresses, total] = await Promise.all([
      this.prisma.addresses.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: { select: { id: true, name: true } },
        },
      }),
      this.prisma.addresses.count({ where }),
    ]);

    return {
      data: addresses,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, user: any) {
    const address = await this.prisma.addresses.findFirst({
      where: { id },
      include: {
        stores: { select: { id: true, name: true } },
      },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    if (address.store_id) {
      await this.validateStoreAccess(address.store_id, user);
    }

    return address;
  }

  async findByStore(storeId: number, user: any) {
    await this.validateStoreAccess(storeId, user);

    return await this.prisma.addresses.findMany({
      where: { store_id: storeId },
      include: {
        stores: { select: { id: true, name: true } },
      },
      orderBy: { is_primary: 'desc' },
    });
  }

  async update(id: number, updateAddressDto: UpdateAddressDto, user: any) {
    const address = await this.findOne(id, user);

    if (updateAddressDto.is_default) {
      await this.unsetOtherDefaults(
        {
          store_id: address.store_id || undefined,
        },
        id,
      );
    }
    
    const updateData: Prisma.addressesUpdateInput = {};
    if (updateAddressDto.address_line_1)
      updateData.address_line1 = updateAddressDto.address_line_1;
    if (updateAddressDto.address_line_2)
      updateData.address_line2 = updateAddressDto.address_line_2;
    if (updateAddressDto.city) updateData.city = updateAddressDto.city;
    if (updateAddressDto.state)
      updateData.state_province = updateAddressDto.state;
    if (updateAddressDto.postal_code)
      updateData.postal_code = updateAddressDto.postal_code;
    if (updateAddressDto.country)
      updateData.country_code = updateAddressDto.country;
    if (updateAddressDto.type) updateData.type = updateAddressDto.type as any;
    if (updateAddressDto.is_default !== undefined)
      updateData.is_primary = updateAddressDto.is_default;

    try {
      return await this.prisma.addresses.update({
        where: { id },
        data: updateData,
        include: {
          stores: { select: { id: true, name: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid store reference');
        }
      }
      throw error;
    }
  }

  async remove(id: number, user: any) {
    await this.findOne(id, user);

    const orderCount = await this.prisma.orders.count({
      where: {
        OR: [{ billing_address_id: id }, { shipping_address_id: id }],
      },
    });

    if (orderCount > 0) {
      throw new BadRequestException(
        'Cannot delete address that is used in orders',
      );
    }

    try {
      await this.prisma.addresses.delete({ where: { id } });
      return { message: 'Address deleted successfully' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Cannot delete address due to related data constraints',
          );
        }
      }
      throw error;
    }
  }

  private async validateStoreAccess(storeId: number, user: any) {
    // TODO: Re-implement this logic based on the new user/role/store relationship
    const store = await this.prisma.stores.findUnique({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    // Assuming for now that if the user's organization matches the store's organization, they have access.
    // This is a simplified placeholder.
    if (store.organization_id !== user.organizationId && user.role !== 'super_admin') {
       throw new ForbiddenException('Access denied to this store');
    }
  }

  private async unsetOtherDefaults(
    criteria: { store_id?: number },
    excludeId?: number,
  ) {
    const where: Prisma.addressesWhereInput = {
      is_primary: true,
    };

    if (criteria.store_id) where.store_id = criteria.store_id;
    if (excludeId) where.id = { not: excludeId };

    await this.prisma.addresses.updateMany({
      where,
      data: { is_primary: false },
    });
  }
}
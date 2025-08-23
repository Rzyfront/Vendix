import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import {
  Injectable,
  NotFoundException,
  ConflictException,
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
    // Validate that either customer_id or store_id is provided
    if (!createAddressDto.customer_id && !createAddressDto.store_id) {
      throw new BadRequestException('Either customer_id or store_id must be provided');
    }

    // Validate access
    if (createAddressDto.customer_id) {
      await this.validateCustomerAccess(createAddressDto.customer_id, user);
    }
    if (createAddressDto.store_id) {
      await this.validateStoreAccess(createAddressDto.store_id, user);
    }

    // Handle default address logic
    if (createAddressDto.is_default) {
      await this.unsetOtherDefaults(createAddressDto);
    }    // Map DTO fields to schema fields
    const addressData: Prisma.addressesUncheckedCreateInput = {
      address_line1: createAddressDto.address_line_1,
      address_line2: createAddressDto.address_line_2,
      city: createAddressDto.city,
      state_province: createAddressDto.state,
      postal_code: createAddressDto.postal_code,
      country_code: createAddressDto.country,
      type: createAddressDto.type as any,
      is_primary: createAddressDto.is_default,
      latitude: createAddressDto.latitude ? parseFloat(createAddressDto.latitude) : null,
      longitude: createAddressDto.longitude ? parseFloat(createAddressDto.longitude) : null,
      customer_id: createAddressDto.customer_id,
      store_id: createAddressDto.store_id,
    };

    try {
      return await this.prisma.addresses.create({
        data: addressData,
        include: {
          customers: { select: { id: true, first_name: true, last_name: true, email: true } },
          stores: { select: { id: true, name: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid customer or store reference');
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
      customer_id,
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

    if (customer_id) {
      where.customer_id = customer_id;
      await this.validateCustomerAccess(customer_id, user);
    }
    if (store_id) {
      where.store_id = store_id;
      await this.validateStoreAccess(store_id, user);
    }
    if (type) where.type = type as any;
    if (is_default !== undefined) where.is_primary = is_default;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state_province = { contains: state, mode: 'insensitive' };
    if (country) where.country_code = { contains: country, mode: 'insensitive' };

    const [addresses, total] = await Promise.all([
      this.prisma.addresses.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          customers: { select: { id: true, first_name: true, last_name: true, email: true } },
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
        customers: { select: { id: true, first_name: true, last_name: true, email: true } },
        stores: { select: { id: true, name: true } },
      },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // Validate access
    if (address.customer_id) {
      await this.validateCustomerAccess(address.customer_id, user);
    }
    if (address.store_id) {
      await this.validateStoreAccess(address.store_id, user);
    }

    return address;
  }

  async findByCustomer(customerId: number, user: any) {
    await this.validateCustomerAccess(customerId, user);

    return await this.prisma.addresses.findMany({
      where: { customer_id: customerId },
      include: {
        customers: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
      orderBy: { is_primary: 'desc' },
    });
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

  async getDefaultAddress(customerId?: number, storeId?: number, user?: any) {
  const where: Prisma.addressesWhereInput = {
      is_primary: true,
    };

    if (customerId) {
      where.customer_id = customerId;
      if (user) await this.validateCustomerAccess(customerId, user);
    }
    if (storeId) {
      where.store_id = storeId;
      if (user) await this.validateStoreAccess(storeId, user);
    }

    const address = await this.prisma.addresses.findFirst({
      where,
      include: {
        customers: { select: { id: true, first_name: true, last_name: true, email: true } },
        stores: { select: { id: true, name: true } },
      },
    });

    if (!address) {
      throw new NotFoundException('Default address not found');
    }

    return address;
  }

  async update(id: number, updateAddressDto: UpdateAddressDto, user: any) {
    const address = await this.findOne(id, user);

    // Handle default address logic
    if (updateAddressDto.is_default) {
      await this.unsetOtherDefaults({
        customer_id: address.customer_id || undefined,
        store_id: address.store_id || undefined,
      }, id);
    }    // Map DTO fields to schema fields
    const updateData: any = {};
    if (updateAddressDto.address_line_1) updateData.address_line1 = updateAddressDto.address_line_1;
    if (updateAddressDto.address_line_2) updateData.address_line2 = updateAddressDto.address_line_2;
    if (updateAddressDto.city) updateData.city = updateAddressDto.city;
    if (updateAddressDto.state) updateData.state_province = updateAddressDto.state;
    if (updateAddressDto.postal_code) updateData.postal_code = updateAddressDto.postal_code;
    if (updateAddressDto.country) updateData.country_code = updateAddressDto.country;
    if (updateAddressDto.type) updateData.type = updateAddressDto.type;
    if (updateAddressDto.is_default !== undefined) updateData.is_primary = updateAddressDto.is_default;

    try {
      return await this.prisma.addresses.update({
        where: { id },
        data: updateData,
        include: {
          customers: { select: { id: true, first_name: true, last_name: true, email: true } },
          stores: { select: { id: true, name: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid customer or store reference');
        }
      }
      throw error;
    }
  }

  async updateGPSCoordinates(id: number, gpsData: UpdateGPSCoordinatesDto, user: any) {
    await this.findOne(id, user); // Validates access

    return await this.prisma.addresses.update({
      where: { id },
      data: {
        latitude: gpsData.latitude,
        longitude: gpsData.longitude,
      },
    });
  }

  async setAsDefault(id: number, user: any) {
    const address = await this.findOne(id, user);

    // Unset other defaults
    await this.unsetOtherDefaults({
      customer_id: address.customer_id || undefined,
      store_id: address.store_id || undefined,
    }, id);

    return await this.prisma.addresses.update({
      where: { id },
      data: { is_primary: true },
    });
  }
  async activate(id: number, user: any) {
    const address = await this.findOne(id, user);

    // Since addresses don't have a status field, we'll just return the address
    // In a real implementation, you might want to add a status field to the schema
    return address;
  }

  async deactivate(id: number, user: any) {
    const address = await this.findOne(id, user);

    // Since addresses don't have a status field, we'll just return the address
    // In a real implementation, you might want to add a status field to the schema
    return address;
  }

  async remove(id: number, user: any) {
    const address = await this.findOne(id, user);

    // Check if address is used in orders
    const orderCount = await this.prisma.orders.count({
      where: {
        OR: [
          { billing_address_id: id },
          { shipping_address_id: id },
        ],
      },
    });

    if (orderCount > 0) {
      throw new BadRequestException('Cannot delete address that is used in orders');
    }

    try {
      await this.prisma.addresses.delete({ where: { id } });
      return { message: 'Address deleted successfully' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException('Cannot delete address due to related data constraints');
        }
      }
      throw error;
    }
  }

  private async validateCustomerAccess(customerId: number, user: any) {
    const customer = await this.prisma.customers.findUnique({
      where: { id: customerId },
      select: { store_id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.store_id) {
      await this.validateStoreAccess(customer.store_id, user);
    }
  }

  private async validateStoreAccess(storeId: number, user: any) {
    const storeAccess = await this.prisma.store_staff.findFirst({
      where: { 
        store_id: storeId, 
        user_id: user.id, 
        is_active: true 
      },
    });

    if (!storeAccess && user.role !== 'system_admin') {
      throw new ForbiddenException('Access denied to this store');
    }
  }

  private async unsetOtherDefaults(
    criteria: { customer_id?: number; store_id?: number },
    excludeId?: number,
  ) {
  const where: Prisma.addressesWhereInput = {
      is_primary: true,
    };

    if (criteria.customer_id) where.customer_id = criteria.customer_id;
    if (criteria.store_id) where.store_id = criteria.store_id;
    if (excludeId) where.id = { not: excludeId };

    await this.prisma.addresses.updateMany({
      where,
      data: { is_primary: false },
    });
  }
}

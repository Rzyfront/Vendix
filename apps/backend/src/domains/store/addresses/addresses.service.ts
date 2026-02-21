import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  AddressQueryDto,
  UpdateGPSCoordinatesDto,
} from './dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AddressesService {
  constructor(
    private prisma: StorePrismaService,
    private accessValidation: AccessValidationService,
  ) { }

  async create(createAddressDto: CreateAddressDto, user: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required for this operation');
    }

    // Force store_id from context
    createAddressDto.store_id = store_id;

    // Block direct organization_id or user_id — use customer_id instead
    if (createAddressDto.organization_id) {
      throw new BadRequestException('Cannot create organization addresses in Store domain');
    }
    if (createAddressDto.user_id) {
      throw new BadRequestException('Use customer_id instead of user_id to associate addresses with customers');
    }

    // If customer_id is provided, resolve the user_id from the customer in this store
    let resolvedUserId: number | null = null;
    if (createAddressDto.customer_id) {
      const customer = await this.prisma.users.findFirst({
        where: {
          id: createAddressDto.customer_id,
          store_users: { some: { store_id: store_id } },
        },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer not found in this store');
      }
      resolvedUserId = customer.id;
    }

    if (createAddressDto.is_primary) {
      const unsetCriteria: { store_id?: number; user_id?: number } = { store_id: store_id };
      if (resolvedUserId) {
        unsetCriteria.user_id = resolvedUserId;
      }
      await this.unsetOtherDefaults(unsetCriteria);
    }

    const address_data: Prisma.addressesUncheckedCreateInput = {
      address_line1: createAddressDto.address_line_1,
      address_line2: createAddressDto.address_line_2,
      city: createAddressDto.city,
      state_province: createAddressDto.state,
      postal_code: createAddressDto.postal_code,
      country_code: createAddressDto.country,
      type: createAddressDto.type as any,
      is_primary: createAddressDto.is_primary,
      latitude: createAddressDto.latitude
        ? parseFloat(createAddressDto.latitude)
        : null,
      longitude: createAddressDto.longitude
        ? parseFloat(createAddressDto.longitude)
        : null,
      store_id: store_id,
      organization_id: null,
      user_id: resolvedUserId,
    };

    try {
      return await this.prisma.addresses.create({
        data: address_data,
        include: {
          stores: { select: { id: true, name: true } },
        },
      });
    } catch (error) {
      throw error;
    }
  }

  async findAll(query: AddressQueryDto, user: any) {
    const {
      page = 1,
      limit = 10,
      search,
      type,
      is_primary,
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

    // Auto-scoped by StorePrismaService via store_id in context
    if (type) where.type = type as any;
    if (is_primary !== undefined) where.is_primary = is_primary;
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
    // Auto-scoped by StorePrismaService
    const address = await this.prisma.addresses.findFirst({
      where: { id },
      include: {
        stores: { select: { id: true, name: true } },
      },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }

  async findByStore(storeId: number, user: any) {
    // Check context matches storeId derived from param? 
    // Or just ignore param and use context? 
    // To be safe and compliant with "always use prisma store service", 
    // we lean on the service's automatic filtering. 
    return this.prisma.addresses.findMany({
      orderBy: { is_primary: 'desc' },
      include: {
        stores: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: number, updateAddressDto: UpdateAddressDto, user: any) {
    // Ensure existence and access via scoped findOne
    const address = await this.findOne(id, user);

    if (updateAddressDto.is_primary) {
      await this.unsetOtherDefaults(
        {
          store_id: address.store_id!,
        },
        id,
      );
    }

    const update_data: Prisma.addressesUpdateInput = {};
    if (updateAddressDto.address_line_1)
      update_data.address_line1 = updateAddressDto.address_line_1;
    if (updateAddressDto.address_line_2)
      update_data.address_line2 = updateAddressDto.address_line_2;
    if (updateAddressDto.city) update_data.city = updateAddressDto.city;
    if (updateAddressDto.state)
      update_data.state_province = updateAddressDto.state;
    if (updateAddressDto.postal_code)
      update_data.postal_code = updateAddressDto.postal_code;
    if (updateAddressDto.country)
      update_data.country_code = updateAddressDto.country;
    if (updateAddressDto.type) update_data.type = updateAddressDto.type as any;
    if (updateAddressDto.is_primary !== undefined)
      update_data.is_primary = updateAddressDto.is_primary;

    try {
      return await this.prisma.addresses.update({
        where: { id },
        data: update_data,
        include: {
          stores: { select: { id: true, name: true } },
        },
      });
    } catch (error) {
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

  private async unsetOtherDefaults(
    criteria: { store_id?: number; organization_id?: number; user_id?: number },
    excludeId?: number,
  ) {
    const where: Prisma.addressesWhereInput = {
      is_primary: true,
    };

    if (criteria.store_id) where.store_id = criteria.store_id;
    if (criteria.organization_id)
      where.organization_id = criteria.organization_id;
    if (criteria.user_id) where.user_id = criteria.user_id;
    if (excludeId) where.id = { not: excludeId };

    await this.prisma.addresses.updateMany({
      where,
      data: { is_primary: false },
    });
  }
}

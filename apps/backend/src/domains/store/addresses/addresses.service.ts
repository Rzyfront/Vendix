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
  CreateCustomerLocationDto,
  UpdateAddressDto,
  AddressQueryDto,
  UpdateGPSCoordinatesDto,
} from './dto';
import { Prisma, address_type_enum } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
// Función pura del catálogo Divipola (sin DI): valida que el código exista de
// verdad en la lista que la DIAN acepta, no solo que tenga 5 dígitos.
import { findDianMunicipality } from '../invoicing/providers/dian-direct/constants/dian-geography';

@Injectable()
export class AddressesService {
  constructor(
    private prisma: StorePrismaService,
    private accessValidation: AccessValidationService,
  ) {}

  /**
   * Normaliza y VERIFICA el código DANE contra el catálogo Divipola.
   *
   * El DTO ya garantiza la forma (5 dígitos); aquí se comprueba la pertenencia,
   * que es lo que de verdad importa: `99999` pasa el regex y sin embargo no es
   * un municipio, y la DIAN rechazaría el documento con ese código. Es
   * preferible un 400 al capturar la dirección que un rechazo al emitir.
   *
   * `null`/`undefined` pasan tal cual: el campo es opcional (direcciones no
   * fiscales e históricas conviven con la columna en NULL).
   */
  private normalizeMunicipalityCode(
    code: string | null | undefined,
  ): string | null | undefined {
    if (code === undefined) return undefined;
    if (code === null) return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    if (!findDianMunicipality(trimmed)) {
      throw new BadRequestException(
        `El código DANE «${trimmed}» no corresponde a ningún municipio de la lista Divipola que la DIAN acepta.`,
      );
    }
    return trimmed;
  }

  async create(createAddressDto: CreateAddressDto, user: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Force store_id from context
    createAddressDto.store_id = store_id;

    // Block direct organization_id or user_id — use customer_id instead
    if (createAddressDto.organization_id) {
      throw new BadRequestException(
        'Este endpoint crea direcciones de la TIENDA. Una dirección de la organización se registra desde Organización → Configuración → Datos generales; quita «organization_id» del envío.',
      );
    }
    if (createAddressDto.user_id) {
      throw new BadRequestException(
        'Para asociar una dirección a un cliente usa «customer_id», no «user_id»: la dirección se resuelve contra los clientes de esta tienda y «user_id» apuntaría a un usuario del panel.',
      );
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
        throw new VendixHttpException(
          ErrorCodes.ADDR_CUSTOMER_NOT_IN_STORE_001,
          `El cliente #${createAddressDto.customer_id} no pertenece a esta tienda, así que no se le puede registrar una dirección aquí. Verifica el cliente en Clientes o crea primero su ficha en esta tienda.`,
        );
      }
      resolvedUserId = customer.id;
    }

    if (createAddressDto.is_primary) {
      if (!resolvedUserId) {
        throw new VendixHttpException(
          ErrorCodes.ADDR_PRIMARY_REQUIRES_CUSTOMER_001,
          'Selecciona un cliente antes de marcar esta dirección como predeterminada.',
        );
      }
    }

    const address_data: Prisma.addressesUncheckedCreateInput = {
      address_line1: createAddressDto.address_line_1,
      address_line2: createAddressDto.address_line_2,
      city: createAddressDto.city,
      state_province: createAddressDto.state,
      postal_code: createAddressDto.postal_code,
      country_code: createAddressDto.country,
      municipality_code: this.normalizeMunicipalityCode(
        createAddressDto.municipality_code,
      ),
      type: createAddressDto.type as any,
      is_primary: createAddressDto.is_primary,
      label: this.normalizeText(createAddressDto.label),
      phone_number: this.normalizeText(createAddressDto.phone_number),
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

    const createAddress = (tx: Prisma.TransactionClient) =>
      tx.addresses.create({
        data: address_data,
        include: {
          stores: { select: { id: true, name: true } },
        },
      });

    if (createAddressDto.is_primary && resolvedUserId) {
      // Clearing the old default and inserting its replacement are one write.
      // If the insert fails, rollback must preserve the previous default.
      return this.prisma.$transaction(async (tx) => {
        await this.unsetOtherDefaults(tx, store_id, resolvedUserId);
        return createAddress(tx);
      });
    }
    return this.prisma.addresses.create({
      data: address_data,
      include: { stores: { select: { id: true, name: true } } },
    });
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
    if (query.customer_id) where.user_id = query.customer_id;
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
      if (!address.user_id) {
        throw new VendixHttpException(
          ErrorCodes.ADDR_PRIMARY_REQUIRES_CUSTOMER_001,
          'Selecciona un cliente antes de marcar esta dirección como predeterminada.',
        );
      }
    }

    const update_data: Prisma.addressesUpdateInput = {};
    if (updateAddressDto.address_line_1)
      update_data.address_line1 = updateAddressDto.address_line_1;
    if (updateAddressDto.address_line_2 !== undefined)
      update_data.address_line2 = this.normalizeText(
        updateAddressDto.address_line_2,
      );
    if (updateAddressDto.label !== undefined)
      update_data.label = this.normalizeText(updateAddressDto.label);
    if (updateAddressDto.phone_number !== undefined)
      update_data.phone_number = this.normalizeText(
        updateAddressDto.phone_number,
      );
    if (updateAddressDto.latitude !== undefined)
      update_data.latitude = updateAddressDto.latitude
        ? parseFloat(updateAddressDto.latitude)
        : null;
    if (updateAddressDto.longitude !== undefined)
      update_data.longitude = updateAddressDto.longitude
        ? parseFloat(updateAddressDto.longitude)
        : null;
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
    // `!== undefined` y no truthy: `null` es una orden legítima («este cliente
    // ya no tiene municipio capturado») y un truthy check la descartaría en
    // silencio, dejando un código viejo pegado a una dirección que cambió.
    if (updateAddressDto.municipality_code !== undefined)
      update_data.municipality_code = this.normalizeMunicipalityCode(
        updateAddressDto.municipality_code,
      );

    if (updateAddressDto.is_primary && address.user_id) {
      // The scoped findOne above proves ownership; keep an explicit store
      // predicate inside the raw transaction client and rollback both writes
      // together if updating the target address fails.
      return this.prisma.$transaction(async (tx) => {
        await this.unsetOtherDefaults(tx, address.store_id!, address.user_id, id);
        return tx.addresses.update({
          where: { id, store_id: address.store_id! },
          data: update_data,
          include: { stores: { select: { id: true, name: true } } },
        });
      });
    }
    return this.prisma.addresses.update({
      where: { id },
      data: update_data,
      include: { stores: { select: { id: true, name: true } } },
    });
  }

  async remove(id: number, user: any) {
    const address = await this.findOne(id, user);

    // `orders`, `sales_orders` y `bookings` apuntan a la dirección con FK
    // Restrict (sin snapshot completo): borrarla rompería esa historia.
    const [orderCount, salesOrderCount, bookingCount] = await Promise.all([
      this.prisma.orders.count({
        where: {
          OR: [{ billing_address_id: id }, { shipping_address_id: id }],
        },
      }),
      this.prisma.sales_orders.count({ where: { shipping_address_id: id } }),
      this.prisma.bookings.count({ where: { service_address_id: id } }),
    ]);

    if (orderCount + salesOrderCount + bookingCount > 0) {
      throw new BadRequestException(
        'Esta ubicación está usada en órdenes o reservas; no se puede eliminar. Puedes editarla o marcar otra como principal.',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.addresses.delete({
          where: { id, store_id: address.store_id! },
        });
        // Si era la principal del cliente, la más reciente del mismo tipo
        // hereda la marca: el cliente nunca queda sin ubicación por defecto.
        if (address.is_primary && address.user_id && address.store_id) {
          const next = await tx.addresses.findFirst({
            where: {
              store_id: address.store_id,
              user_id: address.user_id,
              type: address.type,
            },
            orderBy: { id: 'desc' },
            select: { id: true },
          });
          if (next) {
            await tx.addresses.update({
              where: { id: next.id, store_id: address.store_id },
              data: { is_primary: true },
            });
          }
        }
      });
      return { message: 'Dirección eliminada' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Esta ubicación está usada en otros documentos; no se puede eliminar.',
          );
        }
      }
      throw error;
    }
  }

  /**
   * Registra una nueva ubicación (establecimiento) de un cliente existente de
   * la organización. Si el cliente aún no está enlazado a esta tienda, lo
   * enlaza. Una dirección idéntica (misma línea 1 y ciudad) ya registrada en
   * la tienda no se duplica: se devuelve con `created: false`.
   *
   * La primera ubicación del cliente en la tienda queda como principal.
   */
  async addCustomerLocation(
    customerId: number,
    dto: CreateCustomerLocationDto,
  ): Promise<{
    address: Prisma.addressesGetPayload<object>;
    created: boolean;
  }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const organization_id = context?.organization_id;
    if (!store_id || !organization_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const customer = await this.prisma.users.findFirst({
      where: {
        id: customerId,
        organization_id,
        user_roles: { some: { roles: { name: 'customer' } } },
      },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.ADDR_CUSTOMER_NOT_IN_STORE_001,
        `El cliente #${customerId} no existe en esta organización.`,
      );
    }

    const line1Key = this.addressKey(dto.address_line_1);
    const cityKey = this.addressKey(dto.city);

    return this.prisma.$transaction(async (tx) => {
      // Mismo candado que `unsetOtherDefaults`: serializa altas concurrentes
      // del mismo cliente (carga masiva + UI) para que solo una sea principal.
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `address_primary:${store_id}:${customer.id}`,
      );

      await tx.store_users.upsert({
        where: {
          store_id_user_id: { store_id, user_id: customer.id },
        },
        create: { store_id, user_id: customer.id },
        update: {},
      });

      const existing = await tx.addresses.findMany({
        where: {
          store_id,
          user_id: customer.id,
          type: address_type_enum.shipping,
        },
      });
      const duplicate = existing.find(
        (a) =>
          this.addressKey(a.address_line1) === line1Key &&
          this.addressKey(a.city) === cityKey,
      );
      if (duplicate) {
        return { address: duplicate, created: false };
      }

      const makePrimary = existing.length === 0 || dto.is_primary === true;
      if (makePrimary && existing.length > 0) {
        await tx.addresses.updateMany({
          where: {
            store_id,
            user_id: customer.id,
            is_primary: true,
          },
          data: { is_primary: false },
        });
      }

      const address = await tx.addresses.create({
        data: {
          address_line1: dto.address_line_1.trim(),
          address_line2: this.normalizeText(dto.address_line_2),
          city: dto.city.trim(),
          state_province: this.normalizeText(dto.state),
          postal_code: this.normalizeText(dto.postal_code),
          country_code: dto.country,
          municipality_code: this.normalizeMunicipalityCode(
            dto.municipality_code,
          ),
          label: this.normalizeText(dto.label),
          phone_number: this.normalizeText(dto.phone_number),
          latitude: dto.latitude ? parseFloat(dto.latitude) : null,
          longitude: dto.longitude ? parseFloat(dto.longitude) : null,
          type: address_type_enum.shipping,
          is_primary: makePrimary,
          store_id,
          user_id: customer.id,
        },
      });
      return { address, created: true };
    });
  }

  private normalizeText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private addressKey(value: string | null | undefined): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private async unsetOtherDefaults(
    tx: Prisma.TransactionClient,
    storeId: number,
    userId: number,
    excludeId?: number,
  ) {
    if (!userId) {
      throw new VendixHttpException(
        ErrorCodes.ADDR_PRIMARY_REQUIRES_CUSTOMER_001,
        'Selecciona un cliente antes de marcar esta dirección como predeterminada.',
      );
    }
    // Serialize competing primary replacements for THIS customer's address
    // book. A transaction alone cannot prevent two concurrent INSERTs from
    // both leaving is_primary=true when no unique partial index exists.
    // The lock is transaction-scoped and never touches another customer.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `address_primary:${storeId}:${userId}`,
    );
    const where: Prisma.addressesWhereInput = {
      is_primary: true,
      store_id: storeId,
      user_id: userId,
    };

    if (excludeId) where.id = { not: excludeId };

    await tx.addresses.updateMany({
      where,
      data: { is_primary: false },
    });
  }
}

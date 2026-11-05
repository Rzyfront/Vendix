import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';

@Injectable()
export class ProvidersService {
  constructor(private readonly prisma: StorePrismaService) {}

  private get storeId(): number {
    const context = RequestContextService.getContext();
    return context!.store_id!;
  }

  /** Public projection of the store user behind a provider. */
  static readonly PROVIDER_USER_SELECT = {
    id: true,
    first_name: true,
    last_name: true,
    email: true,
    avatar_url: true,
  } as const;

  /**
   * A store user that may provide services: active, linked to the store, and
   * holding at least one role that is NOT `customer` — the same predicate as
   * `StoreUsersService.staffLookup` (ecommerce customers are also
   * `store_users` rows, so `state: 'active'` alone would let them in).
   */
  private staffUserWhere(storeId: number) {
    return {
      state: 'active' as const,
      store_users: { some: { store_id: storeId } },
      // The staff role must apply to THIS store (or org-wide, store_id null):
      // a staff member of another store who is only a customer here is out.
      user_roles: {
        some: {
          OR: [{ store_id: null }, { store_id: storeId }],
          roles: { name: { not: 'customer' } },
        },
      },
    };
  }

  private readonly PROVIDER_INCLUDE = {
    employee: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
        position: true,
        status: true,
      },
    },
    user: { select: ProvidersService.PROVIDER_USER_SELECT },
    services: {
      include: {
        product: {
          select: {
            id: true,
            name: true,
            base_price: true,
            service_duration_minutes: true,
            buffer_minutes: true,
            booking_mode: true,
          },
        },
      },
    },
  };

  async findAll() {
    return this.prisma.service_providers.findMany({
      where: { store_id: this.storeId },
      include: this.PROVIDER_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
    });
  }

  async findOne(id: number) {
    const provider = await this.prisma.service_providers.findFirst({
      where: { id, store_id: this.storeId },
      include: {
        ...this.PROVIDER_INCLUDE,
        schedules: { orderBy: { day_of_week: 'asc' } },
        exceptions: { orderBy: { date: 'asc' } },
      },
    });

    if (!provider) {
      throw new NotFoundException(`Proveedor #${id} no encontrado`);
    }

    return provider;
  }

  async create(dto: CreateProviderDto) {
    if (dto.user_id != null && dto.employee_id != null) {
      throw new BadRequestException(
        'Envía user_id o employee_id, no ambos',
      );
    }
    if (dto.user_id == null && dto.employee_id == null) {
      throw new BadRequestException(
        'Selecciona el usuario de la tienda que prestará el servicio',
      );
    }
    const stationId = dto.default_station_id ?? null;
    // A new provider has no station links yet: the preferred station only has to belong
    // to the store, and the link is created together with the provider (invariant S10).
    if (stationId != null) await this.assertStationInStore(stationId);
    const created =
      dto.user_id != null
        ? await this.createForUser(dto.user_id, dto)
        : await this.createForEmployee(dto.employee_id!, dto);
    if (stationId != null) {
      await this.prisma.service_station_providers.create({
        data: { store_id: this.storeId, provider_id: created.id, station_id: stationId },
      });
    }
    return created;
  }

  private async assertStationInStore(stationId: number): Promise<void> {
    const station = await this.prisma.service_stations.findFirst({
      where: { id: stationId, store_id: this.storeId },
      select: { id: true },
    });
    if (!station) throw new VendixHttpException(ErrorCodes.STATION_004);
  }

  /** Preferred station invariant: it belongs to the store AND is linked to that provider. */
  private async assertPreferredStation(providerId: number, stationId: number): Promise<void> {
    await this.assertStationInStore(stationId);
    const link = await this.prisma.service_station_providers.findFirst({
      where: { store_id: this.storeId, provider_id: providerId, station_id: stationId },
      select: { id: true },
    });
    if (!link) throw new VendixHttpException(ErrorCodes.STATION_001);
  }

  /** Clears `default_station_id` (the column joins the generated client with 20261115090000). */
  private clearPreferredStation(client: any, providerId: number) {
    return client.service_providers.update({
      where: { id: providerId },
      data: { default_station_id: null } as Prisma.service_providersUncheckedUpdateInput,
    });
  }

  /**
   * Provider backed by a store user (any non-customer user of the store).
   * `display_name` defaults to the user's full name.
   */
  private async createForUser(userId: number, dto: CreateProviderDto) {
    const user = await this.prisma.users.findFirst({
      where: { id: userId, ...this.staffUserWhere(this.storeId) },
      select: { id: true, first_name: true, last_name: true },
    });
    if (!user) {
      throw new NotFoundException(
        'El usuario no pertenece a esta tienda o es un cliente',
      );
    }

    const existing = await this.prisma.service_providers.findFirst({
      where: { store_id: this.storeId, user_id: userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('El usuario ya es un proveedor de servicios');
    }

    const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    try {
      return await this.prisma.service_providers.create({
        data: {
          store_id: this.storeId,
          user_id: userId,
          display_name: dto.display_name || fullName || null,
          avatar_url: dto.avatar_url,
          bio: dto.bio,
          ...(dto.default_station_id != null && { default_station_id: dto.default_station_id }),
        } as Prisma.service_providersUncheckedCreateInput,
        include: this.PROVIDER_INCLUDE,
      });
    } catch (error: any) {
      // Concurrent double-submit: the (store_id, user_id) unique index wins.
      if (error?.code === 'P2002') {
        throw new ConflictException('El usuario ya es un proveedor de servicios');
      }
      throw error;
    }
  }

  /** Legacy path: provider backed by a payroll employee (kept for back-compat). */
  private async createForEmployee(employeeId: number, dto: CreateProviderDto) {
    // Verify employee exists and belongs to store
    const employee = await this.prisma.employees.findFirst({
      where: {
        id: employeeId,
        employee_stores: {
          some: { store_id: this.storeId, status: 'active' },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Empleado #${employeeId} no encontrado en esta tienda`,
      );
    }

    // Check if provider already exists for this employee
    const existing = await this.prisma.service_providers.findFirst({
      where: { store_id: this.storeId, employee_id: employeeId },
    });

    if (existing) {
      throw new ConflictException(
        `El empleado ya es un proveedor de servicios`,
      );
    }

    return this.prisma.service_providers.create({
      data: {
        store_id: this.storeId,
        employee_id: employeeId,
        display_name:
          dto.display_name || `${employee.first_name} ${employee.last_name}`,
        avatar_url: dto.avatar_url,
        bio: dto.bio,
        ...(dto.default_station_id != null && { default_station_id: dto.default_station_id }),
      } as Prisma.service_providersUncheckedCreateInput,
      include: this.PROVIDER_INCLUDE,
    });
  }

  async update(id: number, dto: UpdateProviderDto) {
    await this.findOne(id); // validate exists
    // S10: undefined = untouched, null = clear, number = must be a linked station.
    if (dto.default_station_id != null) await this.assertPreferredStation(id, dto.default_station_id);

    return this.prisma.service_providers.update({
      where: { id },
      data: {
        ...(dto.default_station_id !== undefined && { default_station_id: dto.default_station_id }),
        ...(dto.display_name !== undefined && {
          display_name: dto.display_name,
        }),
        ...(dto.avatar_url !== undefined && { avatar_url: dto.avatar_url }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        updated_at: new Date(),
      } as Prisma.service_providersUncheckedUpdateInput,
      include: this.PROVIDER_INCLUDE,
    });
  }

  async assignService(providerId: number, productId: number) {
    await this.findOne(providerId);

    // Verify product exists in the store.
    // Intentionally do NOT require `requires_booking = true`: provider assignment is
    // configuration and may happen before the flag is toggled (progressive setup).
    const product = await this.prisma.products.findFirst({
      where: { id: productId, store_id: this.storeId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(`Servicio #${productId} no encontrado`);
    }

    const existing = await this.prisma.provider_services.findFirst({
      where: { provider_id: providerId, product_id: productId },
    });

    if (existing) {
      throw new ConflictException(
        `El proveedor ya tiene asignado este servicio`,
      );
    }

    return this.prisma.provider_services.create({
      data: { provider_id: providerId, product_id: productId },
      include: { product: { select: { id: true, name: true } } },
    });
  }

  async removeService(providerId: number, productId: number) {
    await this.findOne(providerId);

    const assignment = await this.prisma.provider_services.findFirst({
      where: { provider_id: providerId, product_id: productId },
    });

    if (!assignment) {
      throw new NotFoundException(`Asignacion no encontrada`);
    }

    await this.prisma.provider_services.delete({
      where: { id: assignment.id },
    });
  }

  async getProvidersForService(productId: number) {
    return this.prisma.service_providers.findMany({
      where: {
        store_id: this.storeId,
        is_active: true,
        services: { some: { product_id: productId } },
      },
      include: {
        employee: {
          select: { id: true, first_name: true, last_name: true },
        },
        user: { select: ProvidersService.PROVIDER_USER_SELECT },
      },
      orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
    });
  }

  /**
   * Store users (non-customers) not yet linked as providers of this store —
   * backs the "Agregar proveedor" picker.
   */
  async getAvailableUsers() {
    const linked = await this.prisma.service_providers.findMany({
      where: { store_id: this.storeId, user_id: { not: null } },
      select: { user_id: true },
    });
    const linkedIds = linked
      .map((p) => p.user_id)
      .filter((id): id is number => id != null);

    return this.prisma.users.findMany({
      where: {
        ...this.staffUserWhere(this.storeId),
        ...(linkedIds.length > 0 && { id: { notIn: linkedIds } }),
      },
      select: ProvidersService.PROVIDER_USER_SELECT,
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    });
  }

  async getAvailableEmployees() {
    // Get employees NOT yet linked as providers
    const existingProviderEmployeeIds =
      await this.prisma.service_providers.findMany({
        where: { store_id: this.storeId },
        select: { employee_id: true },
      });

    const linkedIds = existingProviderEmployeeIds
      .map((p) => p.employee_id)
      .filter((id): id is number => id != null);

    // employees is org-scoped automatically by StorePrismaService middleware.
    // Filter by store assignment via employee_stores junction table.
    return this.prisma.employees.findMany({
      where: {
        status: 'active',
        employee_stores: {
          some: { store_id: this.storeId, status: 'active' },
        },
        ...(linkedIds.length > 0 && { id: { notIn: linkedIds } }),
      },
      select: { id: true, first_name: true, last_name: true, position: true },
      orderBy: { first_name: 'asc' },
    });
  }

  // --- Stations ---

  async getStations(providerId: number): Promise<number[]> {
    await this.findOne(providerId);

    const assignments = await this.prisma.service_station_providers.findMany({
      where: {
        store_id: this.storeId,
        provider_id: providerId,
      },
      select: { station_id: true },
    });

    return assignments.map((a) => a.station_id);
  }

  async setStations(providerId: number, stationIds: number[]): Promise<number[]> {
    const provider = await this.findOne(providerId);
    const preferredId = (provider as { default_station_id?: number | null }).default_station_id ?? null;

    if (stationIds.length > 0) {
      const stations = await this.prisma.service_stations.findMany({
        where: {
          store_id: this.storeId,
          id: { in: stationIds },
        },
        select: { id: true },
      });

      if (stations.length !== stationIds.length) {
        throw new NotFoundException('Una o más estaciones no pertenecen a esta tienda');
      }
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.service_station_providers.deleteMany({
        where: {
          store_id: this.storeId,
          provider_id: providerId,
        },
      });

      if (stationIds.length > 0) {
        await tx.service_station_providers.createMany({
          data: stationIds.map((stationId) => ({
            store_id: this.storeId,
            station_id: stationId,
            provider_id: providerId,
          })),
          skipDuplicates: true,
        });
      }
      // The preferred station must stay linked: drop it with its link.
      if (preferredId != null && !stationIds.includes(preferredId)) {
        await this.clearPreferredStation(tx, providerId);
      }
    });

    return stationIds;
  }

  async assignStation(providerId: number, stationId: number) {
    await this.findOne(providerId);

    const station = await this.prisma.service_stations.findFirst({
      where: { id: stationId, store_id: this.storeId },
      select: { id: true },
    });

    if (!station) {
      throw new NotFoundException(`Estación #${stationId} no encontrada`);
    }

    const existing = await this.prisma.service_station_providers.findFirst({
      where: {
        store_id: this.storeId,
        provider_id: providerId,
        station_id: stationId,
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.service_station_providers.create({
      data: {
        store_id: this.storeId,
        provider_id: providerId,
        station_id: stationId,
      },
    });
  }

  async removeStation(providerId: number, stationId: number): Promise<void> {
    const provider = await this.findOne(providerId);

    await this.prisma.service_station_providers.deleteMany({
      where: {
        store_id: this.storeId,
        provider_id: providerId,
        station_id: stationId,
      },
    });
    if ((provider as { default_station_id?: number | null }).default_station_id === stationId) {
      await this.clearPreferredStation(this.prisma, providerId);
    }
  }
}


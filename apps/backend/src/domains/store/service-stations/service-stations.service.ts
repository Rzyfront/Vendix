import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateServiceStationDto,
  CreateStationExceptionDto,
  SetProductStationsDto,
  SetStationProvidersDto,
  SetStationSchedulesDto,
  SetStationServicesDto,
  UpdateServiceStationDto,
} from './dto/station.dto';
import { StationListQueryDto } from './dto/station-list-query.dto';

@Injectable()
export class ServiceStationsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private get storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new BadRequestException('No se encontró contexto de tienda');
    return store_id;
  }

  async findAll(query: StationListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = {
      store_id: this.storeId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [stations, total] = await Promise.all([
      this.prisma.service_stations.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.service_stations.count({ where }),
    ]);
    return {
      data: await Promise.all(stations.map((station) => this.withCapabilities(station))),
      total,
      page,
      limit,
    };
  }

  private async withCapabilities(station: any) {
    const [services, assignments] = await Promise.all([
      this.prisma.service_station_services.findMany({
        where: { store_id: this.storeId, station_id: station.id },
        orderBy: { product_id: 'asc' },
      }),
      this.prisma.service_station_providers.findMany({
        where: { store_id: this.storeId, station_id: station.id },
        orderBy: { provider_id: 'asc' },
      }),
    ]);
    const [products, providers] = await Promise.all([
      services.length
        ? this.prisma.products.findMany({
            where: { store_id: this.storeId, id: { in: services.map((item) => item.product_id) } },
            select: { id: true, name: true, base_price: true, service_duration_minutes: true },
          })
        : [],
      assignments.length
        ? this.prisma.service_providers.findMany({
            where: { store_id: this.storeId, id: { in: assignments.map((item) => item.provider_id) } },
            select: {
              id: true,
              display_name: true,
              is_active: true,
              employee: { select: { first_name: true, last_name: true } },
            },
          })
        : [],
    ]);
    const productById = new Map<number, (typeof products)[number]>(
      products.map((product) => [product.id, product] as const),
    );
    const providerById = new Map<number, (typeof providers)[number]>(
      providers.map((provider) => [provider.id, provider] as const),
    );
    return {
      ...station,
      qr_status: station.public_id ? 'ready' : 'unavailable',
      services: services.map((item) => ({ ...item, product: productById.get(item.product_id) ?? null })),
      providers: assignments.map((item) => ({ ...item, provider: providerById.get(item.provider_id) ?? null })),
    };
  }

  async findOne(id: number) {
    const station = await this.prisma.service_stations.findFirst({
      where: { id, store_id: this.storeId },
    });
    if (!station) throw new NotFoundException('Estación no encontrada');
    // public_id only identifies the physical station. Never include session or
    // session-token data in this administrative/QR-identifier response.
    return this.withCapabilities(station);
  }

  async getPublicUrl(id: number): Promise<string> {
    const station = await this.findOne(id);
    // app_type is the source of truth for app selection (domain_type is
    // legacy). Same fallback as the session access URL: any active ecommerce
    // domain first (primary preferred), then any primary active domain — the
    // /estacion page also ships in the landing app, so either host works.
    const domain = await this.prisma.domain_settings.findFirst({
      where: { store_id: this.storeId, app_type: 'STORE_ECOMMERCE', status: 'active' },
      orderBy: [{ is_primary: 'desc' }, { updated_at: 'desc' }],
      select: { hostname: true },
    }) ?? await this.prisma.domain_settings.findFirst({
      where: { store_id: this.storeId, is_primary: true, status: 'active' },
      orderBy: { updated_at: 'desc' },
      select: { hostname: true },
    });
    if (!domain?.hostname) {
      throw new VendixHttpException(
        ErrorCodes.STATION_014,
        'Configura y activa un dominio para tu tienda (Configuración > Dominios) para usar el QR público.',
      );
    }
    const base = /^https?:\/\//i.test(domain.hostname) ? domain.hostname : `https://${domain.hostname}`;
    if (!station?.public_id) throw new NotFoundException('Estación no encontrada');
    return `${base}/estacion/${station.public_id}`;
  }

  /** El formulario debe ser de esta tienda y no estar archivado. */
  private async assertIntakeTemplate(templateId: number | null | undefined) {
    if (!templateId) return;
    const template = await this.prisma.data_collection_templates.findFirst({
      where: { id: templateId, store_id: this.storeId, status: { not: 'archived' } },
      select: { id: true },
    });
    if (!template) throw new VendixHttpException(ErrorCodes.DCOL_FIND_001);
  }

  async create(dto: CreateServiceStationDto) {
    // Cada estación nace con su plantilla: define qué se pide al ingresar un cliente.
    if (!dto.intake_template_id) {
      throw new BadRequestException('Elige la plantilla de la estación (o diséñala primero).');
    }
    await this.assertIntakeTemplate(dto.intake_template_id);
    // Sin tipo explícito, la estación toma el tipo para el que se diseñó su plantilla.
    const template = !dto.station_type && dto.intake_template_id
      ? await this.prisma.data_collection_templates.findFirst({
          where: { id: dto.intake_template_id, store_id: this.storeId },
          select: { station_type: true },
        })
      : null;
    try {
      const station = await this.prisma.service_stations.create({
        data: {
          store_id: this.storeId,
          name: dto.name.trim(),
          station_type: dto.station_type ?? (template?.station_type as CreateServiceStationDto['station_type']) ?? 'general',
          capacity: dto.capacity ?? 1,
          status: dto.status ?? 'active',
          track_time: dto.track_time ?? false,
          target_minutes: dto.target_minutes ?? null,
          rental_block_minutes: dto.rental_block_minutes ?? null,
          rental_block_price: dto.rental_block_price ?? null,
          intake_template_id: dto.intake_template_id ?? null,
        },
      });
      return this.findOne(station.id);
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Ya existe una estación con ese nombre en esta tienda');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateServiceStationDto) {
    await this.findOne(id);
    await this.assertIntakeTemplate(dto.intake_template_id);
    try {
      await this.prisma.service_stations.updateMany({
        where: { id, store_id: this.storeId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.station_type !== undefined && { station_type: dto.station_type }),
          ...(dto.capacity !== undefined && { capacity: dto.capacity }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.track_time !== undefined && { track_time: dto.track_time }),
          ...(dto.target_minutes !== undefined && { target_minutes: dto.target_minutes }),
          ...(dto.rental_block_minutes !== undefined && { rental_block_minutes: dto.rental_block_minutes }),
          ...(dto.rental_block_price !== undefined && { rental_block_price: dto.rental_block_price }),
          ...(dto.intake_template_id !== undefined && { intake_template_id: dto.intake_template_id }),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Ya existe una estación con ese nombre en esta tienda');
      }
      throw error;
    }
    return this.findOne(id);
  }

  /** Estaciones de la tienda que prestan este servicio. */
  async getProductStations(productId: number) {
    await this.assertServiceProduct(productId);
    const links = await this.prisma.service_station_services.findMany({
      where: { store_id: this.storeId, product_id: productId },
      select: { station_id: true },
    });
    return { station_ids: links.map((link) => link.station_id) };
  }

  /**
   * Reemplaza en qué estaciones se presta el servicio, sin tocar los demás
   * servicios de cada estación (a diferencia de `setServices`, que reemplaza la
   * lista completa de UNA estación).
   */
  async setProductStations(productId: number, dto: SetProductStationsDto) {
    await this.assertServiceProduct(productId);
    const ids = dto.station_ids;
    if (ids.length) {
      const count = await this.prisma.service_stations.count({ where: { id: { in: ids }, store_id: this.storeId } });
      if (count !== ids.length) throw new NotFoundException('Una o más estaciones no pertenecen a esta tienda');
    }
    await this.prisma.$transaction(async (tx: any) => {
      await tx.service_station_services.deleteMany({
        where: { store_id: this.storeId, product_id: productId, ...(ids.length ? { station_id: { notIn: ids } } : {}) },
      });
      if (ids.length) {
        await tx.service_station_services.createMany({
          data: ids.map((station_id) => ({ store_id: this.storeId, station_id, product_id: productId })),
          skipDuplicates: true,
        });
      }
    });
    return this.getProductStations(productId);
  }

  private async assertServiceProduct(productId: number) {
    const product = await this.prisma.products.findFirst({
      where: { id: productId, store_id: this.storeId },
      select: { product_type: true },
    });
    if (!product) throw new NotFoundException('Servicio no encontrado');
    if (product.product_type !== 'service') {
      throw new BadRequestException('Las estaciones solo pueden asignarse a productos de tipo servicio');
    }
  }

  async setServices(id: number, dto: SetStationServicesDto) {
    const station = await this.findOne(id);
    const ids = dto.product_ids;
    const products = ids.length
      ? await this.prisma.products.findMany({
          where: { id: { in: ids }, store_id: this.storeId },
          select: { id: true, product_type: true },
        })
      : [];
    if (products.length !== ids.length) {
      throw new NotFoundException('Uno o más servicios no pertenecen a esta tienda');
    }
    if (products.some((product) => product.product_type !== 'service')) {
      throw new BadRequestException('Las estaciones solo pueden asignarse a productos de tipo servicio');
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.service_station_services.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      if (ids.length) {
        await tx.service_station_services.createMany({
          data: ids.map((product_id) => ({ store_id: this.storeId, station_id: id, product_id })),
        });
      }
    });
    return this.findOne(id);
  }

  async setProviders(id: number, dto: SetStationProvidersDto) {
    await this.findOne(id);
    const ids = dto.provider_ids;
    const providers = ids.length
      ? await this.prisma.service_providers.findMany({
          where: { id: { in: ids }, store_id: this.storeId, is_active: true },
          select: { id: true },
        })
      : [];
    if (providers.length !== ids.length) {
      throw new NotFoundException('Uno o más proveedores activos no pertenecen a esta tienda');
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.service_station_providers.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      if (ids.length) {
        await tx.service_station_providers.createMany({
          data: ids.map((provider_id) => ({ store_id: this.storeId, station_id: id, provider_id })),
        });
      }
    });
    return this.findOne(id);
  }

  async deactivate(id: number) {
    await this.findOne(id);
    await this.prisma.service_stations.updateMany({
      where: { id, store_id: this.storeId },
      data: { status: 'inactive', updated_at: new Date() },
    });
    return this.findOne(id);
  }

  /**
   * Hard delete. Only stations without operational history can be removed:
   * any recorded session blocks it (billing history must be preserved), as do
   * active holds and pending reschedule requests. Pure config children
   * (schedules, exceptions, assignments) and terminal holds are cleaned up.
   */
  async destroy(id: number) {
    const station = await this.findOne(id);
    const [sessions, activeHolds, pendingReschedules] = await Promise.all([
      this.prisma.service_sessions.count({ where: { store_id: this.storeId, station_id: id } }),
      this.prisma.service_allocations.count({
        where: { store_id: this.storeId, station_id: id, state: { in: ['held', 'confirmed', 'in_service'] } },
      }),
      this.prisma.booking_reschedule_requests.count({
        where: { store_id: this.storeId, requested_station_id: id, status: 'pending' },
      }),
    ]);
    if (sessions > 0) {
      throw new ConflictException(
        `No se puede eliminar: la estación tiene ${sessions} atención(es) registrada(s). Desactívala si ya no la usas.`,
      );
    }
    if (activeHolds > 0) {
      throw new ConflictException('No se puede eliminar: la estación tiene reservas o turnos activos.');
    }
    if (pendingReschedules > 0) {
      throw new ConflictException('No se puede eliminar: la estación tiene solicitudes de reprogramación pendientes.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.service_allocations.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      await tx.booking_reschedule_requests.updateMany({
        where: { store_id: this.storeId, requested_station_id: id },
        data: { requested_station_id: null },
      });
      await tx.service_station_exceptions.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      await tx.service_station_schedules.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      await tx.service_station_services.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      await tx.service_station_providers.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      await tx.service_stations.delete({ where: { store_id_id: { store_id: this.storeId, id } } });
    });
    return station;
  }

  async getSchedules(id: number) {
    await this.findOne(id);
    return this.prisma.service_station_schedules.findMany({
      where: { store_id: this.storeId, station_id: id },
      orderBy: [{ weekday: 'asc' }, { block_order: 'asc' }],
    });
  }

  async setSchedules(id: number, dto: SetStationSchedulesDto) {
    await this.findOne(id);
    const byWeekday = new Map<number, typeof dto.schedules>();
    for (const block of dto.schedules) {
      if (block.start_time >= block.end_time) {
        throw new BadRequestException('Cada bloque debe terminar después de su hora de inicio');
      }
      const day = byWeekday.get(block.weekday) ?? [];
      day.push(block);
      byWeekday.set(block.weekday, day);
    }

    const rows: Array<{
      store_id: number;
      station_id: number;
      weekday: number;
      block_order: number;
      start_time: string;
      end_time: string;
      is_active: boolean;
    }> = [];
    for (const [weekday, blocks] of byWeekday) {
      blocks.sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 0; i < blocks.length; i++) {
        if (i > 0 && blocks[i].start_time < blocks[i - 1].end_time) {
          throw new BadRequestException(`Los bloques del día ${weekday} no pueden superponerse`);
        }
        rows.push({
          store_id: this.storeId,
          station_id: id,
          weekday,
          block_order: i,
          start_time: blocks[i].start_time,
          end_time: blocks[i].end_time,
          is_active: blocks[i].is_active ?? true,
        });
      }
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.service_station_schedules.deleteMany({
        where: { store_id: this.storeId, station_id: id },
      });
      if (rows.length) await tx.service_station_schedules.createMany({ data: rows });
    });
    return this.getSchedules(id);
  }

  async getExceptions(id: number) {
    await this.findOne(id);
    return this.prisma.service_station_exceptions.findMany({
      where: { store_id: this.storeId, station_id: id },
      orderBy: { start_at: 'asc' },
    });
  }

  async createException(id: number, dto: CreateStationExceptionDto) {
    await this.findOne(id);
    const start_at = new Date(dto.start_at);
    const end_at = new Date(dto.end_at);
    if (end_at <= start_at) {
      throw new BadRequestException('La excepción debe terminar después de su inicio');
    }
    return this.prisma.service_station_exceptions.create({
      data: {
        store_id: this.storeId,
        station_id: id,
        start_at,
        end_at,
        reason: dto.reason?.trim() || null,
      },
    });
  }

  async deleteException(id: number, exceptionId: number) {
    await this.findOne(id);
    const deleted = await this.prisma.service_station_exceptions.deleteMany({
      where: { id: exceptionId, station_id: id, store_id: this.storeId },
    });
    if (deleted.count !== 1) throw new NotFoundException('Excepción de estación no encontrada');
    return { id: exceptionId, deleted: true };
  }
}

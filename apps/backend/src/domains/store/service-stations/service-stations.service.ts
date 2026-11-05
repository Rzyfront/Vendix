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
  StationDepositRulesDto,
  UpdateServiceStationDto,
} from './dto/station.dto';
import { validateWeeklyBlocks } from '../../../common/utils/schedule-window.util';
import { StationListQueryDto } from './dto/station-list-query.dto';
import { ACTIVE_ALLOCATION_STATES, NEXT_RESERVATION_SELECT, toNextReservation } from '../service-sessions/utils/next-reservation.util';
import {
  assertDurationFitsBlocks,
  assertStationFitsLinkedServices,
} from './station-duration-block.util';
import { ShippingTaxService } from '../shipping/services/shipping-tax.service';

@Injectable()
export class ServiceStationsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly shippingTax: ShippingTaxService,
  ) {}

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
    const [withCaps, liveState] = await Promise.all([
      Promise.all(stations.map((station) => this.withCapabilities(station))),
      this.liveStateByStation(stations.map((station) => station.id)),
    ]);
    return {
      data: withCaps.map((station) => ({
        ...station,
        next_reservation: liveState.next.get(station.id) ?? null,
        active_session: liveState.session.get(station.id) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /** Next reservation and active session per station, in three batched queries. */
  private async liveStateByStation(stationIds: number[]) {
    const next = new Map<number, ReturnType<typeof toNextReservation>>();
    const session = new Map<number, { id: number; opened_at: Date; planned_end_at: string | null; status: string }>();
    if (!stationIds.length) return { next, session };
    const [upcoming, sessions] = await Promise.all([
      this.prisma.service_allocations.findMany({
        // An allocation already attached to a session (early arrival) is the
        // current session, not the next reservation.
        where: {
          store_id: this.storeId,
          station_id: { in: stationIds },
          state: { in: ACTIVE_ALLOCATION_STATES.filter((state) => state !== 'in_service') },
          session_id: null,
          start_at: { gte: new Date() },
        },
        orderBy: [{ station_id: 'asc' }, { start_at: 'asc' }],
        distinct: ['station_id'],
        select: NEXT_RESERVATION_SELECT,
      }),
      this.prisma.service_sessions.findMany({
        where: { store_id: this.storeId, station_id: { in: stationIds }, status: { in: ['open', 'paused'] } },
        orderBy: { id: 'desc' },
        select: { id: true, station_id: true, opened_at: true, status: true },
      }),
    ]);
    for (const row of upcoming) next.set(row.station_id, toNextReservation(row));
    const inService = sessions.length
      ? await this.prisma.service_allocations.findMany({
          where: { store_id: this.storeId, session_id: { in: sessions.map((row) => row.id) }, state: 'in_service' },
          select: { session_id: true, end_at: true },
        })
      : [];
    const endBySession = new Map<number | null, Date>(inService.map((row) => [row.session_id, row.end_at] as [number | null, Date]));
    for (const row of sessions) {
      if (session.has(row.station_id)) continue;
      const end = endBySession.get(row.id);
      session.set(row.station_id, { id: row.id, opened_at: row.opened_at, planned_end_at: end ? end.toISOString() : null, status: row.status });
    }
    return { next, session };
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
              user: { select: { first_name: true, last_name: true } },
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
    // legacy). Only the apps that route /estacion may host the QR: an active
    // ecommerce domain first, then an active landing domain (primary preferred
    // in both). Any other host (e.g. the store admin) would print a broken QR.
    let domain: { hostname: string | null } | null = null;
    for (const appType of ['STORE_ECOMMERCE', 'STORE_LANDING'] as const) {
      domain = await this.prisma.domain_settings.findFirst({
        where: { store_id: this.storeId, app_type: appType, status: 'active' },
        orderBy: [{ is_primary: 'desc' }, { updated_at: 'desc' }],
        select: { hostname: true },
      });
      if (domain?.hostname) break;
    }
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
    // Impuesto del alquiler: misma validación que la tarifa de envío.
    await this.shippingTax.assertCategoryAssignable(dto.rental_tax_category_id, 'station_rental');
    await this.shippingTax.assertCategoryAssignable(dto.reservation_fee_tax_category_id, 'station_rental');
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
          rental_tax_category_id: dto.rental_tax_category_id ?? null,
          rental_tax_is_inclusive: dto.rental_tax_is_inclusive ?? true,
          intake_template_id: dto.intake_template_id ?? null,
          ...this.depositRulesData(dto),
          // A new station books free-length by default; an explicit value wins.
          booking_duration_mode: dto.booking_duration_mode ?? 'free',
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
    const current = await this.findOne(id);
    await this.assertIntakeTemplate(dto.intake_template_id);
    await this.shippingTax.assertCategoryAssignable(dto.rental_tax_category_id, 'station_rental');
    await this.shippingTax.assertCategoryAssignable(dto.reservation_fee_tax_category_id, 'station_rental');
    // The effective rule (what is stored plus what changes) must stay coherent.
    const policy = dto.deposit_policy ?? current.deposit_policy ?? 'none';
    const amount = dto.deposit_amount !== undefined ? dto.deposit_amount : current.deposit_amount;
    const touchesDeposit = dto.deposit_policy !== undefined || dto.deposit_amount !== undefined;
    if (touchesDeposit && policy !== 'none' && (amount === null || amount === undefined)) {
      throw new BadRequestException('Indica el monto del anticipo para esta estación.');
    }
    this.assertPrepayCoherent(current, dto);
    // A new block must keep every station_rate service linked here a whole number of blocks.
    if (dto.rental_block_minutes) {
      await assertStationFitsLinkedServices(this.prisma, this.storeId, {
        id,
        name: dto.name?.trim() || current.name,
        rental_block_minutes: dto.rental_block_minutes,
      });
    }
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
          ...(dto.rental_tax_category_id !== undefined && { rental_tax_category_id: dto.rental_tax_category_id }),
          ...(dto.rental_tax_is_inclusive !== undefined && { rental_tax_is_inclusive: dto.rental_tax_is_inclusive }),
          ...(dto.intake_template_id !== undefined && { intake_template_id: dto.intake_template_id }),
          ...this.depositRulesData(dto),
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

  /**
   * Deposit and booking rules to persist: only what the request carries, so a
   * station saved without them keeps the column defaults. A policy of `none`
   * never keeps an amount.
   */
  private depositRulesData(dto: Partial<StationDepositRulesDto>) {
    return {
      ...(dto.deposit_policy !== undefined && { deposit_policy: dto.deposit_policy }),
      ...(dto.deposit_policy === 'none'
        ? { deposit_amount: null }
        : dto.deposit_amount !== undefined && { deposit_amount: dto.deposit_amount }),
      ...(dto.deposit_exhausted_policy !== undefined && { deposit_exhausted_policy: dto.deposit_exhausted_policy }),
      ...(dto.leftover_policy !== undefined && { leftover_policy: dto.leftover_policy }),
      ...(dto.booking_duration_mode !== undefined && { booking_duration_mode: dto.booking_duration_mode }),
      ...(dto.hold_minutes !== undefined && { hold_minutes: dto.hold_minutes }),
      ...(dto.open_end_block_minutes !== undefined && { open_end_block_minutes: dto.open_end_block_minutes }),
      ...(dto.cancel_refund_hours !== undefined && { cancel_refund_hours: dto.cancel_refund_hours }),
      ...(dto.reservation_fee_tax_category_id !== undefined && { reservation_fee_tax_category_id: dto.reservation_fee_tax_category_id }),
      ...(dto.rental_block_unit !== undefined && { rental_block_unit: dto.rental_block_unit }),
      ...(dto.rental_billing_mode !== undefined && { rental_billing_mode: dto.rental_billing_mode }),
      ...(dto.rental_charge_timing !== undefined && { rental_charge_timing: dto.rental_charge_timing }),
      ...this.prepayData(dto),
    };
  }

  /**
   * Charge-to-book columns (S17). A mode in the body rewrites both values, so a
   * partial rule never keeps the other kind and `none`/`full` keep neither.
   */
  private prepayData(dto: Partial<StationDepositRulesDto>) {
    if (dto.booking_prepay_mode === 'partial') {
      return {
        booking_prepay_mode: dto.booking_prepay_mode,
        booking_prepay_percent: dto.booking_prepay_percent ?? null,
        booking_prepay_amount: dto.booking_prepay_amount ?? null,
      };
    }
    if (dto.booking_prepay_mode !== undefined) {
      return { booking_prepay_mode: dto.booking_prepay_mode, booking_prepay_percent: null, booking_prepay_amount: null };
    }
    return {
      ...(dto.booking_prepay_percent !== undefined && { booking_prepay_percent: dto.booking_prepay_percent }),
      ...(dto.booking_prepay_amount !== undefined && { booking_prepay_amount: dto.booking_prepay_amount }),
    };
  }

  /** On update without a mode, loose percent/amount must fit the stored mode (the DTO checks the rest). */
  private assertPrepayCoherent(
    current: { booking_prepay_mode?: string | null; booking_prepay_percent?: unknown; booking_prepay_amount?: unknown },
    dto: Partial<StationDepositRulesDto>,
  ): void {
    if (dto.booking_prepay_mode !== undefined) return;
    if (dto.booking_prepay_percent === undefined && dto.booking_prepay_amount === undefined) return;
    const percent = dto.booking_prepay_percent !== undefined ? dto.booking_prepay_percent : current.booking_prepay_percent;
    const amount = dto.booking_prepay_amount !== undefined ? dto.booking_prepay_amount : current.booking_prepay_amount;
    const mode = current.booking_prepay_mode ?? 'none';
    const ok = mode === 'partial' ? (percent != null) !== (amount != null) : percent == null && amount == null;
    if (!ok) {
      throw new BadRequestException(
        'El cobro parcial lleva un porcentaje o un monto (solo uno); el total o ninguno no llevan ninguno de los dos.',
      );
    }
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
    const product = await this.assertServiceProduct(productId);
    const ids = dto.station_ids;
    if (ids.length) {
      const stations = await this.prisma.service_stations.findMany({
        where: { id: { in: ids }, store_id: this.storeId },
        select: { id: true, name: true, rental_block_minutes: true },
      });
      if (stations.length !== ids.length) throw new NotFoundException('Una o más estaciones no pertenecen a esta tienda');
      assertDurationFitsBlocks(product, stations);
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
      select: { product_type: true, service_duration_minutes: true, rental_pricing_mode: true },
    });
    if (!product) throw new NotFoundException('Servicio no encontrado');
    if (product.product_type !== 'service') {
      throw new BadRequestException('Las estaciones solo pueden asignarse a productos de tipo servicio');
    }
    return product;
  }

  async setServices(id: number, dto: SetStationServicesDto) {
    const station = await this.findOne(id);
    const ids = dto.product_ids;
    const products = ids.length
      ? await this.prisma.products.findMany({
          where: { id: { in: ids }, store_id: this.storeId },
          select: { id: true, product_type: true, service_duration_minutes: true, rental_pricing_mode: true },
        })
      : [];
    if (products.length !== ids.length) {
      throw new NotFoundException('Uno o más servicios no pertenecen a esta tienda');
    }
    if (products.some((product) => product.product_type !== 'service')) {
      throw new BadRequestException('Las estaciones solo pueden asignarse a productos de tipo servicio');
    }
    for (const product of products) {
      assertDurationFitsBlocks(product, [station]);
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
      // Both FKs are RESTRICT: rate windows are config of this station; a series keeps its history without it.
      await tx.service_station_rate_windows.deleteMany({ where: { store_id: this.storeId, station_id: id } });
      await tx.booking_series.updateMany({
        where: { store_id: this.storeId, station_id: id },
        data: { station_id: null },
      });
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
    // S21: end <= start means the block ends the next day (00:00-00:00 = 24 h).
    // Overlaps are checked on spans, including the previous day's overnight spill.
    const invalid = validateWeeklyBlocks(dto.schedules.map((b) => ({ day: b.weekday, start_time: b.start_time, end_time: b.end_time })));
    if (invalid) {
      throw new BadRequestException(
        invalid.reason === 'overlap'
          ? `Los bloques del día ${invalid.day} no pueden superponerse`
          : 'Cada bloque debe tener horas con formato HH:mm',
      );
    }
    for (const block of dto.schedules) {
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

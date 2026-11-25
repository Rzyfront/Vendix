import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { resolveStoreTimezone, localDateString } from '@common/utils/store-timezone.util';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import {
  CreatePlanActivityDto,
  CreatePlanDepartureDto,
  PlanPaxTierDto,
  UpdatePlanActivityDto,
  UpdatePlanDepartureDto,
} from './dto/service-plan.dto';
import { assertPlanDurationKeepsActivities } from './service-plan-duration.util';
import { supplierContactLine } from './service-plan-tasks.util';
import { buildPublicItinerary, compareActivities, type PublicItineraryDay } from './service-plan-itinerary.util';
import {
  findOverlappingTiers,
  isPlanProduct,
  planReturnDate,
  resolvePlanPrice,
  type PlanPaxTier,
} from './service-plan-pricing.util';

/** Campos del producto que la reserva de un plan necesita. */
export interface PlanBookingProduct {
  id: number;
  service_pricing_type: string | null;
  plan_duration_days: number | null;
  plan_departure_mode: 'fixed' | 'on_demand' | 'both' | null;
  plan_min_pax: number | null;
  plan_max_pax: number | null;
}

/** Lo que la reserva de un plan guarda: fechas, salida, grupo y precio del paquete. */
export interface PlanBookingResolution {
  date: string;
  /** `YYYY-MM-DD` del regreso; null cuando el plan dura un día (mismo día). */
  endDate: string | null;
  departureId: number | null;
  paxAdults: number;
  paxChildren: number;
  totalPax: number;
  price: number;
  priceSource: 'tier' | 'departure_override';
}

const PLAN_PRODUCT_SELECT = {
  id: true,
  product_type: true,
  service_pricing_type: true,
  plan_duration_days: true,
  plan_duration_nights: true,
  plan_departure_mode: true,
  plan_min_pax: true,
  plan_max_pax: true,
} as const;

type ActivityRow = {
  id: number;
  product_id: number;
  day_number: number;
  start_time: string | null;
  title: string;
  description: string | null;
  sort_order: number;
  provider_id: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  supplier_id: number | null;
  cost: Prisma.Decimal | number | null;
  creates_task: boolean;
  is_public: boolean;
};

type ActivityOwner = {
  provider_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
};

/** Comprobante de una reserva de plan: evento, ida y regreso, grupo e itinerario público. */
export interface PlanBookingItinerary {
  booking_id: number;
  product_id: number;
  departure_id: number | null;
  start_date: string;
  end_date: string;
  duration_days: number;
  duration_nights: number | null;
  pax_adults: number | null;
  pax_children: number | null;
  total_pax: number | null;
  itinerary: PublicItineraryDay[];
}

type DepartureRow = {
  id: number;
  product_id: number;
  departure_date: Date;
  capacity: number;
  seats_sold: number;
  price_override: Prisma.Decimal | null;
  status: 'open' | 'closed' | 'cancelled';
  notes: string | null;
};

@Injectable()
export class ServicePlansService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  /** Configuración del plan, sus tramos y sus salidas (desde hoy, salvo `includePast`). */
  async getPlan(productId: number, includePast = false) {
    const product = await this.findServiceProduct(productId);
    const today = await this.storeToday();
    const [tiers, departures, activities] = await Promise.all([
      this.prisma.service_plan_pax_prices.findMany({
        where: { product_id: productId },
        orderBy: { min_pax: 'asc' },
      }),
      this.prisma.service_plan_departures.findMany({
        where: {
          product_id: productId,
          ...(includePast ? {} : { departure_date: { gte: new Date(`${today}T00:00:00.000Z`) } }),
        },
        orderBy: [{ departure_date: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.service_plan_activities.findMany({ where: { product_id: productId } }),
    ]);
    return {
      product_id: product.id,
      is_plan: isPlanProduct(product),
      plan_duration_days: product.plan_duration_days,
      plan_duration_nights: product.plan_duration_nights,
      plan_departure_mode: product.plan_departure_mode,
      plan_min_pax: product.plan_min_pax,
      plan_max_pax: product.plan_max_pax,
      pax_prices: tiers.map((t) => this.mapTier(t)),
      departures: departures.map((d) => this.mapDeparture(d as DepartureRow)),
      activities: (activities as ActivityRow[]).sort(compareActivities).map((a) => this.mapActivity(a)),
    };
  }

  // ---------------------------------------------------------------------------
  // Tramos de precio por tamaño de grupo
  // ---------------------------------------------------------------------------

  /** Reemplaza todos los tramos del plan. Valida min ≤ max y que no se solapen. */
  async replacePaxPrices(productId: number, tiers: PlanPaxTierDto[]) {
    await this.findPackageProduct(productId);
    for (const tier of tiers) {
      if (tier.min_pax > tier.max_pax) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_003);
    }
    const overlap = findOverlappingTiers(tiers);
    if (overlap) {
      const [a, b] = overlap;
      throw new VendixHttpException(
        ErrorCodes.SERVICE_PLAN_002,
        `Los tramos ${tiers[a].min_pax}-${tiers[a].max_pax} y ${tiers[b].min_pax}-${tiers[b].max_pax} personas se solapan.`,
      );
    }
    const storeId = this.requireStoreId();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.service_plan_pax_prices.deleteMany({ where: { store_id: storeId, product_id: productId } });
      if (tiers.length > 0) {
        await tx.service_plan_pax_prices.createMany({
          data: tiers.map((t) => ({
            store_id: storeId,
            product_id: productId,
            min_pax: t.min_pax,
            max_pax: t.max_pax,
            price: new Prisma.Decimal(t.price),
            created_at: now,
            updated_at: now,
          })),
        });
      }
    });
    const saved = await this.prisma.service_plan_pax_prices.findMany({
      where: { product_id: productId },
      orderBy: { min_pax: 'asc' },
    });
    return saved.map((t) => this.mapTier(t));
  }

  // ---------------------------------------------------------------------------
  // Salidas fijas
  // ---------------------------------------------------------------------------

  async createDeparture(productId: number, dto: CreatePlanDepartureDto) {
    await this.findPackageProduct(productId);
    const date = dto.departure_date.slice(0, 10);
    await this.assertNotPast(date);
    const storeId = this.requireStoreId();
    const created = await this.prisma.service_plan_departures.create({
      data: {
        store_id: storeId,
        product_id: productId,
        departure_date: new Date(`${date}T00:00:00.000Z`),
        capacity: dto.capacity,
        price_override: dto.price_override != null ? new Prisma.Decimal(dto.price_override) : null,
        notes: dto.notes ?? null,
      },
    });
    return this.mapDeparture(created as DepartureRow);
  }

  /**
   * Cupo ≥ vendidos; cambiar la fecha exige fecha no pasada y cero vendidos;
   * cancelar exige cero vendidos (las reservas quedarían sin salida).
   */
  async updateDeparture(productId: number, departureId: number, dto: UpdatePlanDepartureDto) {
    await this.findPackageProduct(productId);
    const current = await this.findDeparture(productId, departureId);
    const data: Prisma.service_plan_departuresUpdateManyMutationInput = { updated_at: new Date() };

    if (dto.departure_date !== undefined) {
      const date = dto.departure_date.slice(0, 10);
      if (date !== this.dateOnly(current.departure_date)) {
        if (current.seats_sold > 0) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_013);
        await this.assertNotPast(date);
        data.departure_date = new Date(`${date}T00:00:00.000Z`);
      }
    }
    if (dto.status !== undefined && dto.status !== current.status) {
      if (dto.status === 'cancelled' && current.seats_sold > 0) {
        throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_013);
      }
      data.status = dto.status;
    }
    if (dto.price_override !== undefined) {
      data.price_override = dto.price_override === null ? null : new Prisma.Decimal(dto.price_override);
    }
    if (dto.notes !== undefined) data.notes = dto.notes;

    const storeId = this.requireStoreId();
    if (dto.capacity !== undefined) {
      // Condicional: una reserva concurrente pudo vender cupos después de la lectura.
      const result = await this.prisma.service_plan_departures.updateMany({
        where: { id: departureId, store_id: storeId, product_id: productId, seats_sold: { lte: dto.capacity } },
        data: { ...data, capacity: dto.capacity },
      });
      if (result.count === 0) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_005);
    } else {
      await this.prisma.service_plan_departures.updateMany({
        where: { id: departureId, store_id: storeId, product_id: productId },
        data,
      });
    }
    return this.mapDeparture(await this.findDeparture(productId, departureId));
  }

  // ---------------------------------------------------------------------------
  // Itinerario (QUI-1060 F2)
  // ---------------------------------------------------------------------------

  /** Agrega una actividad al final de su día. */
  async createActivity(productId: number, dto: CreatePlanActivityDto) {
    const product = await this.findPackageProduct(productId);
    this.assertActivityDay(dto.day_number, product.plan_duration_days);
    const title = this.requireTitle(dto.title);
    const owner = await this.resolveActivityOwner(dto, null);
    const storeId = this.requireStoreId();
    const now = new Date();
    const created = await this.prisma.service_plan_activities.create({
      data: {
        store_id: storeId,
        product_id: productId,
        day_number: dto.day_number,
        start_time: dto.start_time ?? null,
        title,
        description: dto.description ?? null,
        sort_order: await this.nextSortOrder(productId, dto.day_number),
        ...owner,
        cost: dto.cost != null ? new Prisma.Decimal(dto.cost) : null,
        creates_task: dto.creates_task ?? false,
        is_public: dto.is_public ?? true,
        created_at: now,
        updated_at: now,
      },
    });
    return this.mapActivity(created as ActivityRow);
  }

  /** Edita una actividad; cambiar de día la manda al final del nuevo día. */
  async updateActivity(productId: number, activityId: number, dto: UpdatePlanActivityDto) {
    const product = await this.findPackageProduct(productId);
    const current = await this.findActivity(productId, activityId);
    const data: Prisma.service_plan_activitiesUpdateManyMutationInput = { updated_at: new Date() };

    if (dto.day_number !== undefined && dto.day_number !== current.day_number) {
      this.assertActivityDay(dto.day_number, product.plan_duration_days);
      data.day_number = dto.day_number;
      data.sort_order = await this.nextSortOrder(productId, dto.day_number);
    }
    if (dto.title !== undefined) data.title = this.requireTitle(dto.title);
    if (dto.start_time !== undefined) data.start_time = dto.start_time;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.cost !== undefined) data.cost = dto.cost === null ? null : new Prisma.Decimal(dto.cost);
    if (dto.creates_task !== undefined) data.creates_task = dto.creates_task;
    if (dto.is_public !== undefined) data.is_public = dto.is_public;
    if (
      dto.provider_id !== undefined ||
      dto.supplier_id !== undefined ||
      dto.supplier_name !== undefined ||
      dto.supplier_contact !== undefined
    ) {
      Object.assign(data, await this.resolveActivityOwner(dto, current));
    }

    const storeId = this.requireStoreId();
    await this.prisma.service_plan_activities.updateMany({
      where: { id: activityId, store_id: storeId, product_id: productId },
      data,
    });
    return this.mapActivity(await this.findActivity(productId, activityId));
  }

  async deleteActivity(productId: number, activityId: number): Promise<{ id: number }> {
    await this.findPackageProduct(productId);
    await this.findActivity(productId, activityId);
    const storeId = this.requireStoreId();
    await this.prisma.service_plan_activities.deleteMany({
      where: { id: activityId, store_id: storeId, product_id: productId },
    });
    return { id: activityId };
  }

  /** Reordena un día: `activityIds` debe ser exactamente el conjunto de actividades de ese día. */
  async reorderActivities(productId: number, dayNumber: number, activityIds: number[]) {
    await this.findPackageProduct(productId);
    const dayRows = await this.prisma.service_plan_activities.findMany({
      where: { product_id: productId, day_number: dayNumber },
      select: { id: true },
    });
    const expected = new Set(dayRows.map((r) => r.id));
    const unique = new Set(activityIds);
    if (unique.size !== activityIds.length || unique.size !== expected.size || activityIds.some((id) => !expected.has(id))) {
      throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_024);
    }
    const storeId = this.requireStoreId();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of activityIds.entries()) {
        await tx.service_plan_activities.updateMany({
          where: { id, store_id: storeId, product_id: productId, day_number: dayNumber },
          data: { sort_order: index, updated_at: now },
        });
      }
    });
    const rows = await this.prisma.service_plan_activities.findMany({
      where: { product_id: productId, day_number: dayNumber },
    });
    return (rows as ActivityRow[]).sort(compareActivities).map((a) => this.mapActivity(a));
  }

  /**
   * Comprobante de una reserva de plan: evento, ida y regreso, grupo e itinerario
   * público con fechas reales (día 1 = fecha de inicio). null si no es de un plan.
   */
  async getBookingItinerary(bookingId: number): Promise<PlanBookingItinerary | null> {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId },
      select: {
        id: true,
        product_id: true,
        date: true,
        end_date: true,
        departure_id: true,
        pax_adults: true,
        pax_children: true,
        product: { select: PLAN_PRODUCT_SELECT },
      },
    });
    if (!booking) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_026);
    const product = booking.product;
    if (!product || !isPlanProduct(product)) return null;

    const days = product.plan_duration_days as number;
    const start = this.dateOnly(booking.date);
    const end = booking.end_date ? this.dateOnly(booking.end_date) : planReturnDate(start, days);
    const activities = await this.prisma.service_plan_activities.findMany({
      where: { product_id: product.id, is_public: true },
    });
    const adults = booking.pax_adults ?? null;
    const children = booking.pax_children ?? null;
    return {
      booking_id: booking.id,
      product_id: product.id,
      departure_id: booking.departure_id ?? null,
      start_date: start,
      end_date: end,
      duration_days: days,
      duration_nights: product.plan_duration_nights ?? null,
      pax_adults: adults,
      pax_children: children,
      total_pax: adults == null && children == null ? null : (adults ?? 0) + (children ?? 0),
      itinerary: buildPublicItinerary(activities as ActivityRow[], days, start),
    };
  }

  /** Ver `assertPlanDurationKeepsActivities`. */
  async assertDurationKeepsActivities(productId: number, durationDays: number): Promise<void> {
    await assertPlanDurationKeepsActivities(this.prisma, productId, durationDays);
  }

  // ---------------------------------------------------------------------------
  // Reserva de un plan
  // ---------------------------------------------------------------------------

  /**
   * Valida modo de salida, salida (lectura), grupo y precio de una reserva de plan.
   * No toca cupos: `reserveSeatsInTx` los toma dentro de la transacción de la reserva.
   */
  async resolveBooking(
    product: PlanBookingProduct,
    input: {
      date: string;
      end_date?: string | null;
      departure_id?: number | null;
      pax_adults?: number | null;
      pax_children?: number | null;
    },
  ): Promise<PlanBookingResolution> {
    const mode = product.plan_departure_mode ?? 'on_demand';
    const departureId = input.departure_id ?? null;
    if (mode === 'fixed' && departureId == null) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_011);
    if (mode === 'on_demand' && departureId != null) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_012);

    const paxAdults = input.pax_adults ?? 1;
    const paxChildren = input.pax_children ?? 0;
    const totalPax = paxAdults + paxChildren;
    // Un grupo viaja con al menos un adulto (el modal de reserva exige lo mismo).
    if (paxAdults < 1) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_010, 'Indica al menos un adulto en el grupo.');

    let date = input.date.slice(0, 10);
    let override: number | null = null;
    if (departureId != null) {
      const departure = await this.findDeparture(product.id, departureId);
      if (departure.status !== 'open') throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_007);
      const departureDate = this.dateOnly(departure.departure_date);
      if (date !== departureDate) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_014);
      date = departureDate;
      override = departure.price_override != null ? Number(departure.price_override) : null;
    }

    const tiers = await this.prisma.service_plan_pax_prices.findMany({
      where: { product_id: product.id },
      orderBy: { min_pax: 'asc' },
    });
    const priced = resolvePlanPrice({
      tiers: tiers.map((t) => this.mapTier(t)),
      totalPax,
      minPax: product.plan_min_pax,
      maxPax: product.plan_max_pax,
      departureOverride: override,
    });
    if (!priced.ok) {
      if (priced.reason === 'no_tier') {
        throw new VendixHttpException(
          ErrorCodes.SERVICE_PLAN_009,
          `No hay una tarifa del plan para ${totalPax} ${totalPax === 1 ? 'persona' : 'personas'}.`,
        );
      }
      throw new VendixHttpException(
        ErrorCodes.SERVICE_PLAN_010,
        this.paxRangeMessage(totalPax, product.plan_min_pax, product.plan_max_pax),
      );
    }

    const returnDate = planReturnDate(date, product.plan_duration_days ?? 1);
    const endDate = returnDate === date ? null : returnDate;
    const sentEnd = input.end_date ? input.end_date.slice(0, 10) : null;
    if (sentEnd && sentEnd !== returnDate) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_015);

    return {
      date,
      endDate,
      departureId,
      paxAdults,
      paxChildren,
      totalPax,
      price: priced.price,
      priceSource: priced.source,
    };
  }

  /**
   * Toma `pax` cupos de la salida con UNA actualización condicional: solo pasa si la
   * salida es de esta tienda y plan, está abierta, no salió aún y le caben. Dos
   * reservas simultáneas por el último cupo: Postgres serializa el UPDATE sobre la
   * fila y la segunda ya no cumple `seats_sold + pax <= capacity`.
   */
  async reserveSeatsInTx(
    tx: Prisma.TransactionClient,
    args: { storeId: number; productId: number; departureId: number; pax: number },
  ): Promise<void> {
    const today = await this.storeToday(args.storeId);
    const updated = await tx.$executeRaw`
      UPDATE "service_plan_departures"
         SET "seats_sold" = "seats_sold" + ${args.pax}, "updated_at" = NOW()
       WHERE "id" = ${args.departureId}
         AND "store_id" = ${args.storeId}
         AND "product_id" = ${args.productId}
         AND "status" = 'open'
         AND "departure_date" >= ${today}::date
         AND "seats_sold" + ${args.pax} <= "capacity"`;
    if (updated === 1) return;

    // Diagnóstico del rechazo (la escritura ya no ocurrió).
    const departure = await tx.service_plan_departures.findFirst({
      where: { id: args.departureId, store_id: args.storeId, product_id: args.productId },
      select: { status: true, departure_date: true, capacity: true, seats_sold: true },
    });
    if (!departure) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_006);
    if (departure.status !== 'open' || this.dateOnly(departure.departure_date) < today) {
      throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_007);
    }
    const left = Math.max(departure.capacity - departure.seats_sold, 0);
    throw new VendixHttpException(
      ErrorCodes.SERVICE_PLAN_008,
      `No quedan cupos suficientes en este evento: ${left === 1 ? 'queda 1 cupo' : `quedan ${left} cupos`}.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findServiceProduct(productId: number) {
    const product = await this.prisma.products.findFirst({
      where: { id: productId, state: { not: 'archived' } },
      select: PLAN_PRODUCT_SELECT,
    });
    if (!product) throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    return product;
  }

  /** Tramos y salidas solo existen en servicios con precio tipo paquete. */
  private async findPackageProduct(productId: number) {
    const product = await this.findServiceProduct(productId);
    if (product.product_type !== 'service' || product.service_pricing_type !== 'package') {
      throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_001);
    }
    return product;
  }

  private async findDeparture(productId: number, departureId: number): Promise<DepartureRow> {
    const departure = await this.prisma.service_plan_departures.findFirst({
      where: { id: departureId, product_id: productId },
    });
    if (!departure) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_006);
    return departure as DepartureRow;
  }

  private async findActivity(productId: number, activityId: number): Promise<ActivityRow> {
    const activity = await this.prisma.service_plan_activities.findFirst({
      where: { id: activityId, product_id: productId },
    });
    if (!activity) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_022);
    return activity as ActivityRow;
  }

  private assertActivityDay(day: number, durationDays: number | null): void {
    if (durationDays == null || durationDays < 1) {
      throw new VendixHttpException(
        ErrorCodes.SERVICE_PLAN_019,
        'Define la duración del plan (días) antes de cargar el itinerario.',
      );
    }
    if (!Number.isInteger(day) || day < 1 || day > durationDays) {
      throw new VendixHttpException(
        ErrorCodes.SERVICE_PLAN_019,
        `El plan dura ${durationDays} ${durationDays === 1 ? 'día' : 'días'}: elige un día entre 1 y ${durationDays}.`,
      );
    }
  }

  private requireTitle(title: string | null | undefined): string {
    const value = typeof title === 'string' ? title.trim() : '';
    if (!value) {
      throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_025);
    }
    return value;
  }

  /**
   * Responsable efectivo (lo enviado sobre lo guardado): interno XOR tercero. El
   * interno es un prestador de esta tienda; el tercero registrado es un proveedor
   * activo de la organización (general o de esta tienda) y su nombre y contacto se
   * copian como respaldo (QUI-1060 F3).
   */
  private async resolveActivityOwner(
    dto: {
      provider_id?: number | null;
      supplier_id?: number | null;
      supplier_name?: string | null;
      supplier_contact?: string | null;
    },
    current: Pick<ActivityRow, 'provider_id' | 'supplier_id' | 'supplier_name' | 'supplier_contact'> | null,
  ): Promise<ActivityOwner> {
    const pick = <K extends keyof ActivityOwner>(key: K) =>
      dto[key] !== undefined ? (dto[key] ?? null) : (current?.[key] ?? null);
    const owner: ActivityOwner = {
      provider_id: pick('provider_id') as number | null,
      supplier_id: pick('supplier_id') as number | null,
      supplier_name: pick('supplier_name') as string | null,
      supplier_contact: pick('supplier_contact') as string | null,
    };
    if (
      owner.provider_id != null &&
      (owner.supplier_id != null || owner.supplier_name != null || owner.supplier_contact != null)
    ) {
      throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_020);
    }
    const storeId = this.requireStoreId();
    if (owner.provider_id != null && owner.provider_id !== current?.provider_id) {
      const provider = await this.prisma.service_providers.findFirst({
        where: { id: owner.provider_id, store_id: storeId },
        select: { id: true },
      });
      if (!provider) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_021);
    }
    // Con proveedor registrado, nombre y contacto salen de su ficha. Elegirlo exige que
    // esté activo; conservar el ya guardado (otro proveedor inactivado después) no
    // bloquea la edición: refresca la copia si sigue activo y si no deja la guardada.
    if (owner.supplier_id != null) {
      const changed = owner.supplier_id !== current?.supplier_id;
      const supplier = changed
        ? await this.findSelectableSupplier(owner.supplier_id, storeId)
        : await this.findSelectableSupplier(owner.supplier_id, storeId).catch(() => null);
      owner.supplier_name = supplier ? supplier.name.slice(0, 200) : (current?.supplier_name ?? null);
      owner.supplier_contact = supplier ? supplierContactLine(supplier) : (current?.supplier_contact ?? null);
    }
    return owner;
  }

  /** Proveedor activo de la organización de la tienda: general (sin tienda) o de esta tienda. */
  private async findSelectableSupplier(supplierId: number, storeId: number) {
    // El cliente de tienda ya filtra `suppliers` por la organización del contexto.
    const supplier = await this.prisma.suppliers.findFirst({
      where: {
        id: supplierId,
        state: 'active',
        OR: [{ store_id: null }, { store_id: storeId }],
      },
      select: { id: true, name: true, contact_person: true, mobile: true, phone: true, email: true },
    });
    if (!supplier) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_027);
    return supplier;
  }

  private async nextSortOrder(productId: number, dayNumber: number): Promise<number> {
    const last = await this.prisma.service_plan_activities.findFirst({
      where: { product_id: productId, day_number: dayNumber },
      orderBy: { sort_order: 'desc' },
      select: { sort_order: true },
    });
    return last ? last.sort_order + 1 : 0;
  }

  private mapActivity(a: ActivityRow) {
    return {
      id: a.id,
      product_id: a.product_id,
      day_number: a.day_number,
      start_time: a.start_time,
      title: a.title,
      description: a.description,
      sort_order: a.sort_order,
      provider_id: a.provider_id,
      supplier_name: a.supplier_name,
      supplier_contact: a.supplier_contact,
      supplier_id: a.supplier_id ?? null,
      cost: a.cost != null ? Number(a.cost) : null,
      creates_task: a.creates_task,
      is_public: a.is_public,
    };
  }

  private async assertNotPast(date: string): Promise<void> {
    if (date < (await this.storeToday())) throw new VendixHttpException(ErrorCodes.SERVICE_PLAN_004);
  }

  /** Hoy (`YYYY-MM-DD`) en la zona horaria de la tienda. */
  private async storeToday(storeId?: number): Promise<string> {
    const id = storeId ?? this.requireStoreId();
    const tz = await resolveStoreTimezone(this.prisma, id);
    return localDateString(new Date(), tz);
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  private dateOnly(value: Date | string): string {
    return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  }

  private paxRangeMessage(total: number, min: number | null, max: number | null): string {
    const range =
      min != null && max != null
        ? `entre ${min} y ${max}`
        : min != null
          ? `desde ${min}`
          : `hasta ${max}`;
    return `El plan admite grupos ${range} personas; el grupo tiene ${total}.`;
  }

  private mapTier(t: { id?: number; min_pax: number; max_pax: number; price: Prisma.Decimal | number }): PlanPaxTier & { id?: number } {
    return { ...(t.id != null ? { id: t.id } : {}), min_pax: t.min_pax, max_pax: t.max_pax, price: Number(t.price) };
  }

  private mapDeparture(d: DepartureRow) {
    return {
      id: d.id,
      product_id: d.product_id,
      departure_date: this.dateOnly(d.departure_date),
      capacity: d.capacity,
      seats_sold: d.seats_sold,
      seats_available: Math.max(d.capacity - d.seats_sold, 0),
      price_override: d.price_override != null ? Number(d.price_override) : null,
      status: d.status,
      notes: d.notes,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { industryAllowsKey } from '../../../common/access/module-industries';
import {
  daysBetweenDateStrings,
  localDateString,
  resolveTimezoneCascade,
} from '../../../common/utils/store-timezone.util';
import { BookingSchedulingSource } from './sources/booking-scheduling.source';
import { ScheduledOrderSchedulingSource } from './sources/scheduled-order-scheduling.source';
import { loadProviderAvailability } from './sources/provider-availability';
import {
  SCHEDULING_SOURCES,
  SCHEDULING_STATUS_GROUPS,
  SCHEDULING_STATUS_GROUP_LABELS,
  SchedulingEvent,
  SchedulingEventType,
  SchedulingFilters,
  SchedulingSource,
  SchedulingStoreContext,
  compareSchedulingEvents,
} from './scheduling.types';

/** Página máxima que se arma mezclando fuentes (`page * limit`). */
export const SCHEDULING_MAX_WINDOW = 5000;
/** Rango máximo del calendario (un mes visible + bordes de semana). */
export const SCHEDULING_CALENDAR_MAX_DAYS = 62;
/** Tope de eventos por fuente en el calendario. */
export const SCHEDULING_CALENDAR_CAP = 1000;

export interface SchedulingAccess {
  store_id: number;
  timezone: string;
  /** Fuentes que la tienda y el usuario pueden ver, en orden fijo. */
  types: SchedulingEventType[];
}

export interface SchedulingListResult {
  data: SchedulingEvent[];
  total: number;
  truncated: boolean;
  types: SchedulingEventType[];
}

interface StoreSettingsRow {
  settings: unknown;
  stores?: { industries?: string[] | null; timezone?: string | null } | null;
}

/**
 * Programación y Agenda (agenda-unificada F1): mezcla las fuentes habilitadas
 * en una lista paginada y en eventos de calendario.
 *
 * Una fuente entra solo si (1) la industria de la tienda habilita su módulo
 * (`MODULE_INDUSTRIES`), (2) el usuario tiene el permiso de lectura del módulo
 * dueño y (3) para pedidos programados, la tienda los tiene activos. Si falta
 * algo la fuente se omite; nunca responde 403 por una sola fuente.
 */
@Injectable()
export class SchedulingService {
  private readonly sources: Record<SchedulingEventType, SchedulingSource>;

  constructor(
    private readonly prisma: StorePrismaService,
    bookings: BookingSchedulingSource,
    scheduledOrders: ScheduledOrderSchedulingSource,
  ) {
    this.sources = { booking: bookings, scheduled_order: scheduledOrders };
  }

  async resolveAccess(): Promise<SchedulingAccess> {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const row = (await this.prisma.store_settings.findFirst({
      where: { store_id: ctx.store_id },
      select: { settings: true, stores: { select: { industries: true, timezone: true } } },
    })) as StoreSettingsRow | null;
    const settings = (row?.settings ?? {}) as {
      general?: { timezone?: string | null };
      scheduled_orders?: { enabled?: boolean };
    };
    const industries = row?.stores?.industries ?? [];
    const permissions = ctx.permissions ?? [];
    const canRead = (permission: string) =>
      ctx.is_super_admin === true || permissions.includes(permission);

    const types = (Object.keys(SCHEDULING_SOURCES) as SchedulingEventType[]).filter((type) => {
      const source = SCHEDULING_SOURCES[type];
      if (!industryAllowsKey(source.module_key, industries)) return false;
      if (!canRead(source.permission)) return false;
      if (type === 'scheduled_order' && settings.scheduled_orders?.enabled !== true) return false;
      return true;
    });

    return {
      store_id: ctx.store_id,
      timezone: resolveTimezoneCascade(row?.stores?.timezone, settings.general?.timezone),
      types,
    };
  }

  /** Lo que la pantalla necesita para armar filtros: tipos, estados y personal. */
  async getSources() {
    const access = await this.resolveAccess();
    const staff = access.types.includes('booking')
      ? await this.prisma.service_providers.findMany({
          where: { is_active: true },
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            display_name: true,
            user: { select: { first_name: true, last_name: true } },
          },
        })
      : [];
    return {
      timezone: access.timezone,
      today: localDateString(new Date(), access.timezone),
      types: access.types.map((type) => ({
        value: type,
        label: SCHEDULING_SOURCES[type].label,
      })),
      status_groups: SCHEDULING_STATUS_GROUPS.map((value) => ({
        value,
        label: SCHEDULING_STATUS_GROUP_LABELS[value],
      })),
      staff: staff.map((provider) => ({
        id: provider.id,
        name:
          provider.display_name?.trim() ||
          [provider.user?.first_name, provider.user?.last_name].filter(Boolean).join(' ').trim() ||
          `Proveedor ${provider.id}`,
      })),
    };
  }

  /**
   * Lista paginada en servidor sobre varias fuentes: cada fuente devuelve su
   * total y sus primeras `page * limit` filas ya ordenadas; se mezclan y se
   * corta la página pedida. Exacto mientras `page * limit` no supere
   * `SCHEDULING_MAX_WINDOW`.
   */
  async list(
    filters: SchedulingFilters,
    page: number,
    limit: number,
  ): Promise<SchedulingListResult> {
    const window = page * limit;
    if (window > SCHEDULING_MAX_WINDOW) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La página pedida está muy lejos: acota la búsqueda con fechas o filtros.',
      );
    }
    const access = await this.resolveAccess();
    const types = this.selectedTypes(access, filters);
    const ctx: SchedulingStoreContext = { store_id: access.store_id, timezone: access.timezone };
    const pages = await Promise.all(
      types.map((type) => this.sources[type].fetch(ctx, filters, window)),
    );
    const merged = pages
      .flatMap((p) => p.events)
      .sort((a, b) => compareSchedulingEvents(a, b, filters.order));
    return {
      data: merged.slice((page - 1) * limit, window),
      total: pages.reduce((sum, p) => sum + p.total, 0),
      truncated: pages.some((p) => p.truncated),
      types: access.types,
    };
  }

  /** Eventos de un rango local (calendario), sin paginar y con tope por fuente. */
  async calendar(filters: SchedulingFilters & { from: string; to: string }) {
    const span = daysBetweenDateStrings(filters.from, filters.to);
    if (span < 0 || span > SCHEDULING_CALENDAR_MAX_DAYS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El rango del calendario debe tener entre 1 y ${SCHEDULING_CALENDAR_MAX_DAYS + 1} días.`,
      );
    }
    const access = await this.resolveAccess();
    const types = this.selectedTypes(access, filters);
    const ctx: SchedulingStoreContext = { store_id: access.store_id, timezone: access.timezone };
    const pages = await Promise.all(
      types.map((type) =>
        this.sources[type].fetch(ctx, { ...filters, order: 'asc' }, SCHEDULING_CALENDAR_CAP),
      ),
    );
    // Requisito de prestadores: con el filtro de personal, la Agenda pinta el
    // horario de cada prestador, sus bloqueos y excepciones (mismas reglas que
    // Reservas). Solo si las reservas están habilitadas para la tienda.
    const availability =
      filters.staff_ids?.length && access.types.includes('booking')
        ? await loadProviderAvailability(this.prisma, filters.staff_ids, filters.from, filters.to)
        : [];
    return {
      data: pages
        .flatMap((p) => p.events)
        .sort((a, b) => compareSchedulingEvents(a, b, 'asc')),
      truncated: pages.some((p) => p.truncated || p.total > p.events.length),
      types: access.types,
      availability,
    };
  }

  /** Tipos pedidos ∩ tipos habilitados. Sin filtro = todos los habilitados. */
  private selectedTypes(
    access: SchedulingAccess,
    filters: SchedulingFilters,
  ): SchedulingEventType[] {
    if (!filters.types?.length) return access.types;
    return access.types.filter((type) => filters.types!.includes(type));
  }
}

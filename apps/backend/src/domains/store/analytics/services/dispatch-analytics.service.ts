import { BadRequestException, Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { parseDateRange } from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  DispatchPlanillasQueryDto,
  DispatchRemisionesQueryDto,
  DispatchVehiculosQueryDto,
} from '../dto/dispatch-report-query.dto';

/**
 * Error code for an invalid dispatch-report range (ERR-02). Thrown as a plain
 * `BadRequestException` (HTTP 400); `AllExceptionsFilter` propagates the
 * `error_code` verbatim, so no new shared `ErrorCodes` entry is needed.
 */
export const DISPATCH_REPORT_BAD_RANGE = 'DISPATCH_REPORT_BAD_RANGE';

/**
 * Tope documentado del dataset de export (skill vendix-report-xlsx, regla 4).
 * El export trae TODO el rango hasta este techo; si se alcanza, el servicio
 * lo señala con `truncated: true` en vez de recortar en silencio.
 */
export const DISPATCH_EXPORT_LIMIT = 10000;

/** Rango máximo aceptado para los reportes de despacho (ERR-02). */
const DISPATCH_RANGE_MAX_DAYS = 366;

/** Valores de `portador_tipo` (ADR-01): explican de dónde salió el nombre. */
export type PortadorTipo =
  | 'conductor_interno'
  | 'conductor_externo'
  | 'auxiliar'
  | 'domiciliario'
  | 'registrado_por';

export interface ResolvedCarrier {
  nombre: string | null;
  tipo: PortadorTipo | null;
}

// ---------------------------------------------------------------------------
// Helpers puros compartidos por pantalla y export (ADR-01 / ADR-02).
// Viven aquí —única fuente— para que pantalla == archivo por construcción.
// ---------------------------------------------------------------------------

/** Entrada mínima que `pickActiveStop` necesita de una parada. */
export interface StopPickInput {
  status: string;
  settled_at: Date | string | null;
  id: number;
}

/**
 * Elige la parada que representa a la remisión (ADR-02): una línea por
 * `dispatch_note`. Gana la activa o la última terminal
 * (`delivered|rejected` > `in_progress` > `pending`); `released` solo cuando
 * no hay otra parada. `reasignada` = la remisión pasó por más de una parada
 * (release + reasignación vía el índice parcial).
 */
export function pickActiveStop<T extends StopPickInput>(
  stops: readonly T[],
): { stop: T | null; reasignada: boolean } {
  const reasignada = stops.length > 1;
  if (stops.length === 0) return { stop: null, reasignada };
  if (stops.length === 1) return { stop: stops[0], reasignada };

  const rank = (status: string): number => {
    if (
      status === 'delivered' ||
      status === 'rejected' ||
      status === 'partial'
    )
      return 3;
    if (status === 'in_progress') return 2;
    if (status === 'pending') return 1;
    return 0; // released (y cualquier otro): solo si no hay otra
  };

  const timeOf = (s: T): number => {
    if (!s.settled_at) return -1;
    const t = s.settled_at instanceof Date ? s.settled_at.getTime() : 0;
    return Number.isFinite(t) ? t : -1;
  };

  let best = stops[0];
  for (const s of stops.slice(1)) {
    const rBest = rank(best.status);
    const rCur = rank(s.status);
    if (
      rCur > rBest ||
      (rCur === rBest &&
        (timeOf(s) > timeOf(best) ||
          (timeOf(s) === timeOf(best) && s.id > best.id)))
    ) {
      best = s;
    }
  }
  return { stop: best, reasignada };
}

/** Entrada mínima de ruta que `resolveCarrier` necesita (ADR-01, pasos 1-2). */
export interface CarrierRouteInput {
  is_primary_driver_external: boolean | null;
  external_driver_name: string | null;
  /** Nombre ya compuesto del conductor interno ("Nombre Apellido"). */
  driver_name: string | null;
  /** Nombres de auxiliares resueltos, en orden; null = sin nombre. */
  assistant_names: (string | null)[];
}

/**
 * Fila de parada tal como la devuelve el include de `buildRemisionRows`.
 * Se declara explícita porque `StorePrismaService.scoped_client` es `any` y
 * el genérico de `pickActiveStop` colapsaría al constraint sin ella.
 */
export interface DispatchStopRow extends StopPickInput {
  route: {
    is_primary_driver_external: boolean | null;
    external_driver_name: string | null;
    driver_user: { first_name: string; last_name: string } | null;
    assistants: unknown;
    route_number: string;
    vehicle: { plate: string | null } | null;
  } | null;
  settled_by_user: { first_name: string; last_name: string } | null;
}

/** Entrada mínima de remisión/parada (ADR-01, pasos 3-5). */
export interface CarrierNoteInput {
  courier_name: string | null;
  delivered_by_name: string | null;
  settled_by_name: string | null;
}

/**
 * Cascada del portador — "quién la llevó" (ADR-01):
 * 1) ruta con conductor externo primario → `external_driver_name`
 *    (`conductor_externo`), si no → `driver_user` (`conductor_interno`);
 * 2) ruta sin conductor → primer auxiliar con nombre (`auxiliar`);
 * 3) remisión sin ruta (directa) → `courier_name` (`domiciliario`);
 * 4) fallback → `delivered_by_user` (`registrado_por`);
 * 5) último → `settled_by_user` (`registrado_por`).
 */
export function resolveCarrier(
  route: CarrierRouteInput | null,
  note: CarrierNoteInput,
): ResolvedCarrier {
  if (route) {
    if (route.is_primary_driver_external && route.external_driver_name) {
      return {
        nombre: route.external_driver_name,
        tipo: 'conductor_externo',
      };
    }
    if (!route.is_primary_driver_external && route.driver_name) {
      return { nombre: route.driver_name, tipo: 'conductor_interno' };
    }
    const assistant = route.assistant_names.find(
      (n): n is string => !!n && n.trim().length > 0,
    );
    if (assistant) return { nombre: assistant, tipo: 'auxiliar' };
  }
  if (note.courier_name) {
    return { nombre: note.courier_name, tipo: 'domiciliario' };
  }
  if (note.delivered_by_name) {
    return { nombre: note.delivered_by_name, tipo: 'registrado_por' };
  }
  if (note.settled_by_name) {
    return { nombre: note.settled_by_name, tipo: 'registrado_por' };
  }
  return { nombre: null, tipo: null };
}

/** "Nombre Apellido" o null cuando no hay usuario / ambos vacíos. */
export function fullName(
  user: { first_name: string; last_name: string } | null | undefined,
): string | null {
  if (!user) return null;
  const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return name.length > 0 ? name : null;
}

// ---------------------------------------------------------------------------
// Filas crudas: Date + números sin formatear. El formato vive en las columnas
// del controller / ReportBuilder (skill vendix-report-xlsx, regla 3).
// ---------------------------------------------------------------------------

/** Una línea por `dispatch_note` del rango (ADR-02). */
export interface RemisionRow {
  /** PK de `dispatch_notes`: alimenta el `trackKey: 'id'` del viewer. */
  id: number;
  dispatch_number: string;
  /** Instante crudo de emisión. La fase de emisión lo pinta en TZ tienda. */
  emission_date: Date | null;
  status: string;
  subtype: string;
  customer_name: string | null;
  grand_total: number;
  numero_ruta: string | null;
  placa_vehiculo: string | null;
  portador_nombre: string | null;
  portador_tipo: PortadorTipo | null;
  reasignada: boolean;
  parada_estado: string | null;
  /** Derivado de `invoice.payment_date IS NOT NULL` (sin crédito en ruta). */
  is_prepaid: boolean;
  delivered_at: Date | null;
}

/** Una línea por `dispatch_route` (B.2). Varianza SOLO lectura. */
export interface PlanillaRow {
  route_number: string;
  route_code: string | null;
  status: string;
  /** Instante crudo de fecha planeada (TZ tienda en emisión). */
  planned_date: Date | null;
  conductor_nombre: string | null;
  conductor_tipo: PortadorTipo | null;
  placa_vehiculo: string | null;
  vehiculo: string | null;
  paradas_total: number;
  paradas_entregadas: number;
  paradas_rechazadas: number;
  paradas_liberadas: number;
  paradas_pendientes: number;
  total_to_collect: number;
  total_collected: number;
  total_prepaid: number;
  total_changes: number;
  total_withholdings: number;
  /** Efectivo que el conductor trajo físicamente (fijado al cierre). */
  declared_cash: number | null;
  /** `declared_cash - cash_collected`: se MUESTRA, nunca se recalcula. */
  cash_variance: number | null;
  closed_at: Date | null;
}

/** Una línea por `vehicle`: foto actual con uso agregado (B.2). */
export interface VehiculoRow {
  plate: string;
  type: string;
  brand: string | null;
  model_name: string | null;
  conductor_principal: string | null;
  rutas_activas: number;
  rutas_cerradas: number;
  rutas_total: number;
  ultimo_uso: Date | null;
  is_active: boolean;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  truncated: boolean;
}

const USER_NAME_SELECT = { first_name: true, last_name: true } as const;

@Injectable()
export class DispatchAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) return DEFAULT_STORE_TIMEZONE;
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  /** ERR-02: rango inválido o más amplio que el tope → 400 con código. */
  private validateRange(startDate: Date, endDate: Date): void {
    if (startDate.getTime() > endDate.getTime()) {
      throw new BadRequestException({
        error_code: DISPATCH_REPORT_BAD_RANGE,
        message: 'Rango de fechas inválido: date_from es posterior a date_to.',
      });
    }
    const days =
      (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    if (days > DISPATCH_RANGE_MAX_DAYS) {
      throw new BadRequestException({
        error_code: DISPATCH_REPORT_BAD_RANGE,
        message: `Rango demasiado amplio: máximo ${DISPATCH_RANGE_MAX_DAYS} días.`,
      });
    }
  }

  // ==================== B.1 — REMISIONES ====================

  async getRemisiones(
    query: DispatchRemisionesQueryDto,
  ): Promise<PagedResult<RemisionRow>> {
    const { rows, truncated } = await this.buildRemisionRows(query);
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : rows.length;
    const offset = (page - 1) * limit;
    return {
      data: rows.slice(offset, offset + limit),
      total: rows.length,
      page,
      limit: limit || 1,
      truncated,
    };
  }

  async getRemisionesForExport(
    query: DispatchRemisionesQueryDto,
  ): Promise<{ rows: RemisionRow[]; truncated: boolean }> {
    return this.buildRemisionRows(query);
  }

  /**
   * Única fuente de remisiones para pantalla y export (ADR-03): el mismo
   * array alimenta la lista paginada y el XLSX completo.
   */
  private async buildRemisionRows(
    query: DispatchRemisionesQueryDto,
  ): Promise<{ rows: RemisionRow[]; truncated: boolean }> {
    this.requireStoreId();
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    this.validateRange(startDate, endDate);

    const storeId = this.requireStoreId();
    const notes = await this.prisma.dispatch_notes.findMany({
      where: {
        store_id: storeId,
        emission_date: { gte: startDate, lte: endDate }, // tz-audit:ignore — TIMESTAMP real, ventana de parseDateRange en TZ tienda
        ...(query.status && { status: query.status as never }),
        ...(query.subtype && { subtype: query.subtype as never }),
        ...(query.search && {
          OR: [
            { dispatch_number: { contains: query.search } },
            { customer_name: { contains: query.search } },
          ],
        }),
      },
      include: {
        dispatch_route_stops: {
          include: {
            route: {
              include: {
                driver_user: { select: USER_NAME_SELECT },
                vehicle: { select: { plate: true } },
              },
            },
            settled_by_user: { select: USER_NAME_SELECT },
          },
          orderBy: { id: 'desc' },
        },
        delivered_by_user: { select: USER_NAME_SELECT },
        invoice: { select: { payment_date: true } },
      },
      orderBy: [{ emission_date: 'desc' }, { id: 'desc' }],
      take: DISPATCH_EXPORT_LIMIT + 1,
    });

    const truncated = notes.length > DISPATCH_EXPORT_LIMIT;
    const capped = truncated ? notes.slice(0, DISPATCH_EXPORT_LIMIT) : notes;

    // Nombres de auxiliares (`assistants[].user_id`) en UNA query, acotada a
    // la organización del contexto (`users` es baseClient: sin scope auto).
    const assistantIds = new Set<number>();
    for (const n of capped) {
      for (const s of n.dispatch_route_stops) {
        const assistants = asAssistantArray(s.route?.assistants);
        for (const a of assistants) {
          if (typeof a?.user_id === 'number') assistantIds.add(a.user_id);
        }
      }
    }
    const assistantNames = await this.resolveAssistantNames(
      [...assistantIds],
    );

    const rows: RemisionRow[] = capped.map((n) => {
      const stops = n.dispatch_route_stops as DispatchStopRow[];
      const { stop, reasignada } = pickActiveStop(stops);
      const route = stop?.route ?? null;
      const carrier = resolveCarrier(
        route
          ? {
              is_primary_driver_external:
                route.is_primary_driver_external ?? false,
              external_driver_name: route.external_driver_name,
              driver_name: fullName(route.driver_user),
              assistant_names: asAssistantArray(route.assistants).map((a) =>
                assistantDisplayName(a, assistantNames),
              ),
            }
          : null,
        {
          courier_name: n.courier_name,
          delivered_by_name: fullName(n.delivered_by_user),
          settled_by_name: fullName(stop?.settled_by_user),
        },
      );
      return {
        id: n.id,
        dispatch_number: n.dispatch_number,
        emission_date: n.emission_date,
        status: n.status,
        subtype: n.subtype,
        customer_name: n.customer_name,
        grand_total: toNumber(n.grand_total),
        numero_ruta: route?.route_number ?? null,
        placa_vehiculo: route?.vehicle?.plate ?? null,
        portador_nombre: carrier.nombre,
        portador_tipo: carrier.tipo,
        reasignada,
        parada_estado: stop?.status ?? null,
        is_prepaid: !!n.invoice?.payment_date,
        delivered_at: n.delivered_at,
      };
    });

    return { rows, truncated };
  }

  // ==================== B.2 — PLANILLAS ====================

  async getPlanillas(
    query: DispatchPlanillasQueryDto,
  ): Promise<PagedResult<PlanillaRow>> {
    const { rows, truncated } = await this.buildPlanillaRows(query);
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : rows.length;
    const offset = (page - 1) * limit;
    return {
      data: rows.slice(offset, offset + limit),
      total: rows.length,
      page,
      limit: limit || 1,
      truncated,
    };
  }

  async getPlanillasForExport(
    query: DispatchPlanillasQueryDto,
  ): Promise<{ rows: PlanillaRow[]; truncated: boolean }> {
    return this.buildPlanillaRows(query);
  }

  /**
   * Única fuente de planillas para pantalla y export. `cash_variance` y
   * `declared_cash` se LEEN del cierre (`route-flow.service`); este reporte
   * jamás los recalcula ni los escribe (B.2).
   */
  private async buildPlanillaRows(
    query: DispatchPlanillasQueryDto,
  ): Promise<{ rows: PlanillaRow[]; truncated: boolean }> {
    this.requireStoreId();
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    this.validateRange(startDate, endDate);

    const storeId = this.requireStoreId();
    const routes = await this.prisma.dispatch_routes.findMany({
      where: {
        store_id: storeId,
        planned_date: { gte: startDate, lte: endDate }, // tz-audit:ignore — TIMESTAMP real, ventana de parseDateRange en TZ tienda
        ...(query.status && { status: query.status as never }),
        ...(query.search && {
          OR: [
            { route_number: { contains: query.search } },
            { route_code: { contains: query.search } },
          ],
        }),
      },
      include: {
        driver_user: { select: USER_NAME_SELECT },
        vehicle: {
          select: {
            plate: true,
            brand: true,
            model_name: true,
            primary_driver: { select: USER_NAME_SELECT },
          },
        },
        stops: { select: { status: true } },
      },
      orderBy: [{ planned_date: 'desc' }, { id: 'desc' }],
      take: DISPATCH_EXPORT_LIMIT + 1,
    });

    const truncated = routes.length > DISPATCH_EXPORT_LIMIT;
    const capped = truncated ? routes.slice(0, DISPATCH_EXPORT_LIMIT) : routes;

    const assistantIds = new Set<number>();
    for (const r of capped) {
      for (const a of asAssistantArray(r.assistants)) {
        if (typeof a?.user_id === 'number') assistantIds.add(a.user_id);
      }
    }
    const assistantNames = await this.resolveAssistantNames([...assistantIds]);

    const rows: PlanillaRow[] = capped.map((r) => {
      const counts = countStops(r.stops);
      const driverName = r.is_primary_driver_external
        ? (r.external_driver_name ?? null)
        : fullName(r.driver_user);
      const conductor =
        driverName ??
        asAssistantArray(r.assistants)
          .map((a) => assistantDisplayName(a, assistantNames))
          .find((n): n is string => !!n && n.trim().length > 0) ??
        null;
      const conductor_tipo: PortadorTipo | null = r.is_primary_driver_external
        ? r.external_driver_name
          ? 'conductor_externo'
          : conductor
            ? 'auxiliar'
            : null
        : fullName(r.driver_user)
          ? 'conductor_interno'
          : conductor
            ? 'auxiliar'
            : null;
      const vehiculo =
        [r.vehicle?.brand, r.vehicle?.model_name].filter(Boolean).join(' ') ||
        null;
      return {
        route_number: r.route_number,
        route_code: r.route_code,
        status: r.status,
        planned_date: r.planned_date,
        conductor_nombre: conductor,
        conductor_tipo,
        placa_vehiculo: r.vehicle?.plate ?? null,
        vehiculo,
        paradas_total: r.stops.length,
        paradas_entregadas: counts.delivered,
        paradas_rechazadas: counts.rejected,
        paradas_liberadas: counts.released,
        paradas_pendientes: counts.pending,
        total_to_collect: toNumber(r.total_to_collect),
        total_collected: toNumber(r.total_collected),
        total_prepaid: toNumber(r.total_prepaid),
        total_changes: toNumber(r.total_changes),
        total_withholdings: toNumber(r.total_withholdings),
        declared_cash: toNullableNumber(r.declared_cash),
        cash_variance: toNullableNumber(r.cash_variance),
        closed_at: r.closed_at,
      };
    });

    return { rows, truncated };
  }

  // ==================== B.2 — VEHÍCULOS ====================

  async getVehiculos(
    query: DispatchVehiculosQueryDto,
  ): Promise<PagedResult<VehiculoRow>> {
    const { rows, truncated } = await this.buildVehiculoRows(query);
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : rows.length;
    const offset = (page - 1) * limit;
    return {
      data: rows.slice(offset, offset + limit),
      total: rows.length,
      page,
      limit: limit || 1,
      truncated,
    };
  }

  async getVehiculosForExport(
    query: DispatchVehiculosQueryDto,
  ): Promise<{ rows: VehiculoRow[]; truncated: boolean }> {
    return this.buildVehiculoRows(query);
  }

  /**
   * Foto actual de la flota con uso agregado de por vida (DB-04). No es serie
   * temporal: el rango de fechas no filtra ni el roster ni los agregados.
   */
  private async buildVehiculoRows(
    query: DispatchVehiculosQueryDto,
  ): Promise<{ rows: VehiculoRow[]; truncated: boolean }> {
    this.requireStoreId();

    const storeId = this.requireStoreId();
    const vehicles = await this.prisma.vehicles.findMany({
      where: {
        store_id: storeId,
        ...(query.is_active !== undefined && { is_active: query.is_active }),
        ...(query.search && {
          OR: [
            { plate: { contains: query.search } },
            { brand: { contains: query.search } },
            { model_name: { contains: query.search } },
          ],
        }),
      },
      include: {
        primary_driver: { select: USER_NAME_SELECT },
      },
      orderBy: [{ plate: 'asc' }],
      take: DISPATCH_EXPORT_LIMIT + 1,
    });

    const truncated = vehicles.length > DISPATCH_EXPORT_LIMIT;
    const capped = truncated
      ? vehicles.slice(0, DISPATCH_EXPORT_LIMIT)
      : vehicles;

    // Agregado de uso por vehículo en UNA query (respeta `UNIQUE(store_id,
    // plate)` solo leyendo; nunca escribe).
    const routeUsage = await this.prisma.dispatch_routes.findMany({
      where: { store_id: storeId },
      select: { vehicle_id: true, status: true, planned_date: true },
    });
    const usageByVehicle = new Map<
      number,
      { activas: number; cerradas: number; total: number; ultimo: Date | null }
    >();
    for (const r of routeUsage) {
      if (r.vehicle_id == null) continue;
      let acc = usageByVehicle.get(r.vehicle_id);
      if (!acc) {
        acc = { activas: 0, cerradas: 0, total: 0, ultimo: null };
        usageByVehicle.set(r.vehicle_id, acc);
      }
      acc.total += 1;
      if (
        r.status === 'draft' ||
        r.status === 'dispatched' ||
        r.status === 'in_transit'
      ) {
        acc.activas += 1;
      }
      if (r.status === 'closed') acc.cerradas += 1;
      if (r.planned_date && (!acc.ultimo || r.planned_date > acc.ultimo)) {
        acc.ultimo = r.planned_date;
      }
    }

    const rows: VehiculoRow[] = capped.map((v) => {
      const usage = usageByVehicle.get(v.id);
      return {
        plate: v.plate,
        type: v.type,
        brand: v.brand,
        model_name: v.model_name,
        conductor_principal: fullName(v.primary_driver),
        rutas_activas: usage?.activas ?? 0,
        rutas_cerradas: usage?.cerradas ?? 0,
        rutas_total: usage?.total ?? 0,
        ultimo_uso: usage?.ultimo ?? null,
        is_active: v.is_active,
      };
    });

    return { rows, truncated };
  }

  /**
   * Resuelve `assistants[].user_id` → nombre en UNA query acotada a la
   * organización del contexto (`users` es baseClient, sin scope automático).
   */
  private async resolveAssistantNames(ids: number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (ids.length === 0) return names;
    const organizationId =
      RequestContextService.getContext()?.organization_id;
    const users = await this.prisma.users.findMany({
      where: {
        id: { in: ids },
        ...(organizationId !== undefined &&
          organizationId !== null && { organization_id: organizationId }),
      },
      select: { id: true, first_name: true, last_name: true },
    });
    for (const u of users) {
      const name = fullName(u);
      if (name) names.set(u.id, name);
    }
    return names;
  }
}

// ---------------------------------------------------------------------------
// Coerciones y formas defensivas (assistants es Json libre).
// ---------------------------------------------------------------------------

/** Prisma Decimal|string|number|null → number (0 cuando nulo). */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as { toNumber: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Decimal nullable → number|null (p.ej. declared_cash / cash_variance). */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as { toNumber: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface AssistantEntry {
  user_id?: number;
  external_name?: string;
  name?: string;
}

/** `assistants` es Json libre: array, null o forma inesperada → siempre array. */
function asAssistantArray(value: unknown): AssistantEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is AssistantEntry => typeof a === 'object' && a !== null,
  );
}

/** Nombre visible de un auxiliar: externo primero, luego lookup por user_id. */
function assistantDisplayName(
  entry: AssistantEntry,
  lookup: Map<number, string>,
): string | null {
  const external = entry.external_name ?? entry.name;
  if (external && external.trim().length > 0) return external.trim();
  if (typeof entry.user_id === 'number') {
    return lookup.get(entry.user_id) ?? null;
  }
  return null;
}

function countStops(stops: readonly { status: string }[]): {
  delivered: number;
  rejected: number;
  released: number;
  pending: number;
} {
  let delivered = 0;
  let rejected = 0;
  let released = 0;
  let pending = 0;
  for (const s of stops) {
    if (s.status === 'delivered' || s.status === 'partial') delivered += 1;
    else if (s.status === 'rejected') rejected += 1;
    else if (s.status === 'released') released += 1;
    else pending += 1; // pending | in_progress
  }
  return { delivered, rejected, released, pending };
}
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { parseDateRange, getPreviousPeriod, formatPeriodFromDate } from '../utils/date.util';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
  localPeriodSql,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  DispatchAnalyticsQueryDto,
  DispatchPlanillasQueryDto,
  DispatchRemisionesQueryDto,
  DispatchRouteTypeFilter,
  DispatchVehiculosQueryDto,
} from '../dto/dispatch-report-query.dto';
import { Granularity } from '../dto/analytics-query.dto';
import {
  countDispatchStops,
  computeCashCollected,
  computeDeliveredValue,
  computeFulfillmentRate,
  computeGrowth,
  round2,
  sqlStateList,
  DISPATCH_ACTIVE_ROUTE_STATE_SET,
  DISPATCH_CLOSED_ROUTE_STATES,
  DISPATCH_EXCLUDED_ROUTE_STATES,
  DISPATCH_OUTBOUND_SUBTYPES,
  DispatchCashStopInput,
  DispatchDeliveredValueStopInput,
  DispatchFulfillmentStopInput,
} from '../analytics-metrics.contract';
import {
  ORDER_PAYMENT_MEANS_INCLUDE,
  resolveOrderPaymentLabel,
} from '../../payments/order-payment-means.contract';

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
  /** Medio con el que se recaudó la parada al liquidarla (VarChar libre). */
  payment_method: string | null;
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

/**
 * Etiquetas del recaudo capturado al liquidar la parada
 * (`dispatch_route_stops.payment_method`). Mismo vocabulario que el selector
 * del modal de liquidación (`stop-settle-modal`), más `credit` para la parada
 * que se entregó a plazo.
 */
const STOP_PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  credit: 'Crédito',
};

/**
 * Etiqueta legible del recaudo de la parada, o `null` si la parada no declaró
 * ninguno.
 *
 * La columna es un `VarChar(40)` libre —el DTO de liquidación sólo valida
 * `@IsString()` + `@MaxLength(40)`— así que un valor fuera del vocabulario
 * canónico es posible. Se devuelve TAL CUAL en vez de tragarlo: una celda
 * vacía diría «no se recaudó», que es una afirmación distinta y falsa, y
 * escondería justo el dato que hay que corregir en el origen.
 */
export function resolveStopPaymentLabel(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  return STOP_PAYMENT_METHOD_LABELS[raw.toLowerCase()] ?? raw;
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
  /**
   * Etiqueta del método de pago, ya legible (es texto, no hay formato que
   * delegar a la columna). Manda el recaudo de la parada; si la remisión no
   * pasó por ruta, cae al método de la orden asociada; `null` si ninguno.
   */
  metodo_pago: string | null;
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

// ---------------------------------------------------------------------------
// Agregados de despacho (KPIs/serie/carriers/recaudo) —
// PLAN-analytics-despachos-2026-09-12 Paso 2. Comparten un único grano
// (ADR-02: una fila por `dispatch_note`, parada activa via `pickActiveStop`)
// para que `summary`, `trends` y `fulfillment` reconcilien entre sí.
// ---------------------------------------------------------------------------

/** `withholding_breakdown` (JSONB) tal como lo describe la skill dispatch-routes. */
export interface WithholdingBreakdown {
  retefuente?: number;
  reteiva?: number;
  reteica?: number;
}

/**
 * Fila de parada usada por los 4 agregados: extiende {@link StopPickInput}
 * (lo que `pickActiveStop` necesita) con los campos de dinero/portador que
 * las fórmulas del contrato y `resolveCarrier` sí necesitan.
 */
export interface DispatchAggStopRow extends StopPickInput {
  is_prepaid: boolean;
  payment_method: string | null;
  collected_amount: unknown;
  anticipo_amount: unknown;
  withholding_amount: unknown;
  withholding_breakdown: unknown;
  route: {
    id: number;
    is_carrier_route: boolean;
    is_primary_driver_external: boolean | null;
    external_driver_name: string | null;
    driver_user: { first_name: string; last_name: string } | null;
    assistants: unknown;
  } | null;
  settled_by_user: { first_name: string; last_name: string } | null;
}

/**
 * Una fila por `dispatch_note` (ADR-02): la parada activa elegida por
 * `pickActiveStop`, ya filtrada por rutas `voided` y por `route_type`, más
 * los campos que `summary`/`fulfillment` necesitan. Único grano que
 * alimenta ambos — nunca se cuenta directo desde `dispatch_route_stops`.
 */
export interface DispatchNoteAggRow {
  note_id: number;
  route_id: number | null;
  is_carrier_route: boolean | null;
  emission_date: Date | null;
  grand_total: number;
  stop_status: string;
  is_prepaid: boolean;
  payment_method: string | null;
  collected_amount: number;
  anticipo_amount: number;
  withholding_amount: number;
  withholding_breakdown: WithholdingBreakdown;
  portador_nombre: string | null;
  portador_tipo: PortadorTipo | null;
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
        // Fallback del método de pago para la remisión que nunca pasó por una
        // ruta (venta en mostrador que se despacha directo): el recaudo vive
        // en los pagos de la orden. Contrato compartido, no una lectura
        // propia: `take: 1` perdería la mitad de un pago mixto.
        order: { include: { payments: ORDER_PAYMENT_MEANS_INCLUDE } },
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
        // Precedencia: manda el recaudo de la parada ACTIVA —la misma que ya
        // define `parada_estado` y `numero_ruta`, no otra— porque en DSD el
        // dinero entra en la calle y no en caja. Sólo si esa parada no declaró
        // método (o la remisión nunca pasó por ruta) se cae a la orden.
        metodo_pago:
          resolveStopPaymentLabel(stop?.payment_method) ??
          resolveOrderPaymentLabel(n.order?.payments) ??
          null,
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
      const counts = countDispatchStops(r.stops);
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
      if (DISPATCH_ACTIVE_ROUTE_STATE_SET.has(r.status)) {
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

  // ==================== C — DESPACHO ANALYTICS (KPIs) ====================
  // PLAN-analytics-despachos-2026-09-12 Paso 2.

  /**
   * Único fetch de grano ADR-02 detrás de `summary` y `fulfillment` (y de la
   * base conceptual de `trends`, replicada en SQL). Filtra rutas `voided` y
   * `route_type` DESPUÉS de `pickActiveStop` (nunca antes): filtrar la
   * relación antes rompería el desempate de `pickActiveStop` cuando una
   * remisión fue reasignada entre una ruta DSD y una de carrier.
   *
   * `store_id` se repite explícito en la nota Y en la ruta anidada —
   * `dispatch_routes`/`dispatch_route_stops` NO están en
   * `store_scoped_models` (causa raíz de F-001).
   */
  private async fetchDispatchNoteAggRows(
    storeId: number,
    startDate: Date,
    endDate: Date,
    routeType: DispatchRouteTypeFilter,
  ): Promise<{ rows: DispatchNoteAggRow[]; truncated: boolean }> {
    const notes = await this.prisma.dispatch_notes.findMany({
      where: {
        store_id: storeId,
        status: { not: 'voided' },
        subtype: { in: DISPATCH_OUTBOUND_SUBTYPES as unknown as string[] },
        emission_date: { gte: startDate, lte: endDate }, // tz-audit:ignore — TIMESTAMP real, ventana de parseDateRange en TZ tienda
        dispatch_route_stops: {
          some: {
            route: {
              store_id: storeId,
              status: { notIn: DISPATCH_EXCLUDED_ROUTE_STATES as unknown as string[] },
            },
          },
        },
      },
      include: {
        dispatch_route_stops: {
          where: {
            route: {
              store_id: storeId,
              status: { notIn: DISPATCH_EXCLUDED_ROUTE_STATES as unknown as string[] },
            },
          },
          include: {
            route: {
              select: {
                id: true,
                is_carrier_route: true,
                is_primary_driver_external: true,
                external_driver_name: true,
                driver_user: { select: USER_NAME_SELECT },
                assistants: true,
              },
            },
            settled_by_user: { select: USER_NAME_SELECT },
          },
        },
        delivered_by_user: { select: USER_NAME_SELECT },
      },
      orderBy: [{ emission_date: 'desc' }, { id: 'desc' }],
      take: DISPATCH_EXPORT_LIMIT + 1,
    });

    const truncated = notes.length > DISPATCH_EXPORT_LIMIT;
    const capped = truncated ? notes.slice(0, DISPATCH_EXPORT_LIMIT) : notes;

    const assistantIds = new Set<number>();
    for (const n of capped) {
      for (const s of n.dispatch_route_stops as DispatchAggStopRow[]) {
        for (const a of asAssistantArray(s.route?.assistants)) {
          if (typeof a?.user_id === 'number') assistantIds.add(a.user_id);
        }
      }
    }
    const assistantNames = await this.resolveAssistantNames([...assistantIds]);

    const rows: DispatchNoteAggRow[] = [];
    for (const n of capped) {
      const stops = n.dispatch_route_stops as DispatchAggStopRow[];
      const { stop } = pickActiveStop(stops);
      if (!stop) continue; // sin parada en ruta no-voided: nada que agregar

      const route = stop.route;
      if (routeType !== 'all') {
        const wantsCarrier = routeType === 'carrier';
        if (!route || route.is_carrier_route !== wantsCarrier) continue;
      }

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
          settled_by_name: fullName(stop.settled_by_user),
        },
      );

      rows.push({
        note_id: n.id,
        route_id: route?.id ?? null,
        is_carrier_route: route?.is_carrier_route ?? null,
        emission_date: n.emission_date,
        grand_total: toNumber(n.grand_total),
        stop_status: stop.status,
        is_prepaid: stop.is_prepaid,
        payment_method: stop.payment_method,
        collected_amount: toNumber(stop.collected_amount),
        anticipo_amount: toNumber(stop.anticipo_amount),
        withholding_amount: toNumber(stop.withholding_amount),
        withholding_breakdown: toWithholdingBreakdown(
          stop.withholding_breakdown,
        ),
        portador_nombre: carrier.nombre,
        portador_tipo: carrier.tipo,
      });
    }

    return { rows, truncated };
  }

  /**
   * KPIs de despacho + delta vs período anterior (`getPreviousPeriod`).
   * Grano ADR-02 sobre `emission_date` (ventana de remisiones) para
   * entregas/recaudo; las rutas tocadas por esas remisiones (`totalRoutes`)
   * se resuelven aparte contra `dispatch_routes` (con `store_id` explícito —
   * F-001) para las métricas de flota (`active_routes`/`closed_routes`/
   * `avg_stops_per_route`/`avg_cycle_hours`/`cash_variance`), que no viven en
   * el grano de remisión.
   *
   * Contrato con el frontend (`DispatchSummary`,
   * `dispatch-analytics.interface.ts`): `total_dispatch_notes` es el conteo
   * crudo de remisiones (`current.length`); `total_deliveries` es semántico
   * — entregas CUMPLIDAS (`counts.delivered`) — nunca el conteo de
   * remisiones.
   */
  async getDispatchSummary(query: DispatchAnalyticsQueryDto) {
    this.requireStoreId();
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    this.validateRange(startDate, endDate);
    const storeId = this.requireStoreId();
    const routeType: DispatchRouteTypeFilter = query.route_type ?? 'all';

    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    const [{ rows: current }, { rows: previous }] = await Promise.all([
      this.fetchDispatchNoteAggRows(storeId, startDate, endDate, routeType),
      this.fetchDispatchNoteAggRows(
        storeId,
        previousStartDate,
        previousEndDate,
        routeType,
      ),
    ]);

    const counts = countDispatchStops(
      current.map((r) => ({ status: r.stop_status })),
    );
    const previousCounts = countDispatchStops(
      previous.map((r) => ({ status: r.stop_status })),
    );
    const cashCollected = round2(computeCashCollected(current.map(toCashInput)));
    const deliveredValue = round2(
      computeDeliveredValue(current.map(toValueInput)),
    );
    const fulfillmentRate = round2(
      computeFulfillmentRate(current.map(toFulfillmentInput)),
    );
    const totalWithholdings = round2(
      current.reduce((sum, r) => sum + r.withholding_amount, 0),
    );
    const routeIds = [
      ...new Set(
        current.map((r) => r.route_id).filter((id): id is number => id !== null),
      ),
    ];

    const previousCashCollected = round2(
      computeCashCollected(previous.map(toCashInput)),
    );
    const previousDeliveredValue = round2(
      computeDeliveredValue(previous.map(toValueInput)),
    );
    const previousFulfillmentRate = round2(
      computeFulfillmentRate(previous.map(toFulfillmentInput)),
    );

    // Fleet metrics: rutas TOCADAS por las remisiones del período actual.
    // `dispatch_routes` no está en `store_scoped_models` (F-001) — store_id
    // explícito en el where, igual que `fetchDispatchNoteAggRows`.
    let activeRoutes = 0;
    let closedRoutes = 0;
    let avgStopsPerRoute = 0;
    let avgCycleHours: number | null = null;
    let cashVarianceSum = 0;

    if (routeIds.length > 0) {
      const routes = await this.prisma.dispatch_routes.findMany({
        where: { store_id: storeId, id: { in: routeIds } },
        select: {
          id: true,
          status: true,
          dispatch_started_at: true,
          closed_at: true,
          cash_variance: true,
          stops: { select: { id: true } },
        },
      });

      const closedStateList = DISPATCH_CLOSED_ROUTE_STATES as readonly string[];
      let totalStops = 0;
      const cycleHours: number[] = [];
      for (const r of routes) {
        totalStops += r.stops.length;
        if (DISPATCH_ACTIVE_ROUTE_STATE_SET.has(r.status)) activeRoutes += 1;
        if (closedStateList.includes(r.status)) {
          closedRoutes += 1;
          cashVarianceSum += toNumber(r.cash_variance);
          if (r.dispatch_started_at && r.closed_at) {
            const hours =
              (r.closed_at.getTime() - r.dispatch_started_at.getTime()) /
              (1000 * 60 * 60);
            cycleHours.push(hours);
          }
        }
      }
      avgStopsPerRoute = routes.length > 0 ? totalStops / routes.length : 0;
      avgCycleHours =
        cycleHours.length > 0
          ? cycleHours.reduce((a, b) => a + b, 0) / cycleHours.length
          : null;
    }

    return {
      total_dispatch_notes: current.length,
      total_deliveries: counts.delivered,
      total_rejected: counts.rejected,
      total_released: counts.released,
      fulfillment_rate: fulfillmentRate,
      total_routes: routeIds.length,
      active_routes: activeRoutes,
      closed_routes: closedRoutes,
      avg_stops_per_route: round2(avgStopsPerRoute),
      avg_cycle_hours: avgCycleHours === null ? null : round2(avgCycleHours),
      delivered_value: deliveredValue,
      cash_collected: cashCollected,
      total_withholdings: totalWithholdings,
      cash_variance: round2(cashVarianceSum),
      deliveries_growth: computeGrowth(counts.delivered, previousCounts.delivered),
      delivered_value_growth: computeGrowth(
        deliveredValue,
        previousDeliveredValue,
      ),

      // --- Extras conservados (no declarados en DispatchSummary, no rompen
      // al frontend — vendix-analytics-metrics: "añadir de más no rompe"). ---
      pending: counts.pending,
      cash_collected_growth: computeGrowth(cashCollected, previousCashCollected),
      fulfillment_rate_growth: computeGrowth(
        fulfillmentRate,
        previousFulfillmentRate,
      ),
      route_type: routeType,
    };
  }

  /**
   * Serie temporal por `localPeriodSql` sobre `withoutScope().$queryRaw`
   * (patrón de `sales-analytics.service.ts:696-790`) + `fillTimeSeries`. La
   * CTE `active_stops` replica en SQL el ranking de `pickActiveStop`
   * (terminal > in_progress > pending > released, desempate por
   * `settled_at DESC NULLS LAST, id DESC`) para mantener el grano ADR-02.
   */
  async getDispatchTrends(query: DispatchAnalyticsQueryDto) {
    const storeId = this.requireStoreId();
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    this.validateRange(startDate, endDate);
    const granularity = query.granularity || Granularity.DAY;
    const routeType: DispatchRouteTypeFilter = query.route_type ?? 'all';

    // withoutScope() needed: $queryRaw no está disponible en el scoped
    // client. storeId se valida arriba y se repite en CADA subquery (nota Y
    // ruta) — mismo motivo que fetchDispatchNoteAggRows (F-001).
    const periodSql = localPeriodSql(
      'active_stops.emission_date',
      tz,
      granularity,
    );

    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        total_deliveries: bigint;
        delivered: bigint;
        rejected: bigint;
        released: bigint;
        cash_collected: any;
        delivered_value: any;
      }>
    >`
      WITH active_stops AS (
        SELECT DISTINCT ON (s.dispatch_note_id)
          s.dispatch_note_id,
          s.status,
          s.is_prepaid,
          s.payment_method,
          s.collected_amount,
          s.anticipo_amount,
          s.withholding_amount,
          r.is_carrier_route,
          n.emission_date,
          n.grand_total
        FROM dispatch_route_stops s
        JOIN dispatch_routes r ON r.id = s.route_id
        JOIN dispatch_notes n ON n.id = s.dispatch_note_id
        WHERE r.store_id = ${storeId}
          AND n.store_id = ${storeId}
          AND r.status NOT IN (${sqlStateList(DISPATCH_EXCLUDED_ROUTE_STATES)})
          AND n.status <> 'voided'
          AND n.subtype IN (${sqlStateList(DISPATCH_OUTBOUND_SUBTYPES)})
          AND n.emission_date >= ${startDate}
          AND n.emission_date <= ${endDate}
          ${
            routeType !== 'all'
              ? Prisma.sql`AND r.is_carrier_route = ${routeType === 'carrier'}`
              : Prisma.empty
          }
        ORDER BY s.dispatch_note_id,
          (CASE WHEN s.status IN ('delivered','rejected','partial') THEN 3
                WHEN s.status = 'in_progress' THEN 2
                WHEN s.status = 'pending' THEN 1
                ELSE 0 END) DESC,
          s.settled_at DESC NULLS LAST,
          s.id DESC
      )
      SELECT
        ${periodSql} AS period,
        COUNT(*) AS total_deliveries,
        COUNT(*) FILTER (WHERE status IN ('delivered','partial')) AS delivered,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'released') AS released,
        COALESCE(SUM(CASE WHEN NOT is_prepaid AND (payment_method IS NULL OR payment_method = 'cash')
          THEN collected_amount + anticipo_amount ELSE 0 END), 0) AS cash_collected,
        COALESCE(SUM(CASE WHEN status IN ('delivered','partial')
          THEN collected_amount + anticipo_amount + withholding_amount +
            (CASE WHEN is_prepaid THEN grand_total ELSE 0 END)
          ELSE 0 END), 0) AS delivered_value
      FROM active_stops
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const mapped = results.map((r) => ({
      period: r.period,
      deliveries: Number(r.delivered),
      rejected: Number(r.rejected),
      released: Number(r.released),
      cash_collected: round2(Number(r.cash_collected)),
      delivered_value: round2(Number(r.delivered_value)),
      // Extra conservado: total de remisiones con parada activa en el
      // período (superconjunto de `deliveries`, no declarado en
      // DispatchTrendPoint — no rompe al frontend).
      total_deliveries: Number(r.total_deliveries),
    }));

    const points = fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      {
        deliveries: 0,
        rejected: 0,
        released: 0,
        cash_collected: 0,
        delivered_value: 0,
        total_deliveries: 0,
      },
      formatPeriodFromDate,
      tz,
    );

    // Contrato DispatchTrends: { granularity, points } — el servicio
    // devolvía el array crudo, que el frontend nunca esperó (leía
    // `trends.data.points`/`trends.data.granularity`).
    return { granularity, points };
  }

  /**
   * Cumplimiento agregado por `portador_nombre` + `portador_tipo` (nunca
   * solo por nombre: dos portadores homónimos con tipo distinto — p.ej.
   * `auxiliar` vs `registrado_por` — son entidades distintas). Grano ADR-02
   * sobre `emission_date`.
   */
  async getDispatchFulfillment(query: DispatchAnalyticsQueryDto) {
    this.requireStoreId();
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    this.validateRange(startDate, endDate);
    const storeId = this.requireStoreId();
    const routeType: DispatchRouteTypeFilter = query.route_type ?? 'all';

    const { rows, truncated } = await this.fetchDispatchNoteAggRows(
      storeId,
      startDate,
      endDate,
      routeType,
    );

    const byCarrier = new Map<
      string,
      {
        portador_nombre: string | null;
        portador_tipo: PortadorTipo | null;
        rows: DispatchNoteAggRow[];
      }
    >();
    for (const r of rows) {
      const key = `${r.portador_nombre ?? ''}__${r.portador_tipo ?? ''}`;
      let bucket = byCarrier.get(key);
      if (!bucket) {
        bucket = {
          portador_nombre: r.portador_nombre,
          portador_tipo: r.portador_tipo,
          rows: [],
        };
        byCarrier.set(key, bucket);
      }
      bucket.rows.push(r);
    }

    const carriers = [...byCarrier.values()]
      .map((bucket) => {
        const counts = countDispatchStops(
          bucket.rows.map((r) => ({ status: r.stop_status })),
        );
        const routesForCarrier = new Set(
          bucket.rows
            .map((r) => r.route_id)
            .filter((id): id is number => id !== null),
        ).size;
        return {
          portador_nombre: bucket.portador_nombre,
          portador_tipo: bucket.portador_tipo,
          deliveries: counts.delivered,
          rejected: counts.rejected,
          released: counts.released,
          fulfillment_rate: round2(
            computeFulfillmentRate(bucket.rows.map(toFulfillmentInput)),
          ),
          delivered_value: round2(
            computeDeliveredValue(bucket.rows.map(toValueInput)),
          ),
          routes: routesForCarrier,

          // --- Extras conservados (no declarados en
          // DispatchFulfillmentCarrier, no rompen al frontend). ---
          total_notes: bucket.rows.length,
          cash_collected: round2(
            computeCashCollected(bucket.rows.map(toCashInput)),
          ),
        };
      })
      .sort((a, b) => b.deliveries - a.deliveries);

    const overallCounts = countDispatchStops(
      rows.map((r) => ({ status: r.stop_status })),
    );

    return {
      carriers,
      totals: {
        deliveries: overallCounts.delivered,
        rejected: overallCounts.rejected,
        released: overallCounts.released,
        fulfillment_rate: round2(
          computeFulfillmentRate(rows.map(toFulfillmentInput)),
        ),
      },

      // --- Extras conservados (no declarados en DispatchFulfillment). ---
      total_deliveries: rows.length,
      route_type: routeType,
      truncated,
    };
  }

  /**
   * Recaudo en caja, valor entregado, retenciones desglosadas y varianza por
   * ruta (B.2-style, grano `dispatch_route`). Ventana en `planned_date`
   * (ventana de rutas, no de remisiones). `cash_collected`/`delivered_value`
   * se recalculan SIEMPRE frescos desde `route.stops` (mismo contrato que
   * `route-flow.service.ts`) para poder reconciliar contra
   * `declared_cash - cash_variance`, que se LEE, nunca se recalcula.
   */
  async getDispatchCollections(query: DispatchAnalyticsQueryDto) {
    this.requireStoreId();
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    this.validateRange(startDate, endDate);
    const storeId = this.requireStoreId();
    const routeType: DispatchRouteTypeFilter = query.route_type ?? 'all';

    const routes = await this.prisma.dispatch_routes.findMany({
      where: {
        store_id: storeId,
        planned_date: { gte: startDate, lte: endDate }, // tz-audit:ignore — TIMESTAMP real, ventana de parseDateRange en TZ tienda
        status: { notIn: DISPATCH_EXCLUDED_ROUTE_STATES as unknown as string[] },
        ...(routeType !== 'all' && {
          is_carrier_route: routeType === 'carrier',
        }),
      },
      include: {
        driver_user: { select: USER_NAME_SELECT },
        vehicle: { select: { plate: true } },
        stops: {
          select: {
            status: true,
            is_prepaid: true,
            payment_method: true,
            collected_amount: true,
            anticipo_amount: true,
            withholding_amount: true,
            withholding_breakdown: true,
            dispatch_note: { select: { grand_total: true } },
          },
        },
      },
      orderBy: [{ planned_date: 'desc' }, { id: 'desc' }],
      take: DISPATCH_EXPORT_LIMIT + 1,
    });

    const truncated = routes.length > DISPATCH_EXPORT_LIMIT;
    const capped = truncated ? routes.slice(0, DISPATCH_EXPORT_LIMIT) : routes;

    // Nombres de auxiliares (fallback de conductor) en UNA query — mismo
    // patrón que `buildPlanillaRows` (`users` es baseClient, sin scope auto).
    const assistantIds = new Set<number>();
    for (const r of capped) {
      for (const a of asAssistantArray(r.assistants)) {
        if (typeof a?.user_id === 'number') assistantIds.add(a.user_id);
      }
    }
    const assistantNames = await this.resolveAssistantNames([...assistantIds]);

    const routeRows = capped.map((r) => {
      const cashInputs: DispatchCashStopInput[] = r.stops.map((s: any) => ({
        is_prepaid: s.is_prepaid,
        payment_method: s.payment_method,
        collected_amount: toNumber(s.collected_amount),
        anticipo_amount: toNumber(s.anticipo_amount),
      }));
      const valueInputs: DispatchDeliveredValueStopInput[] = r.stops.map(
        (s: any) => ({
          status: s.status,
          is_prepaid: s.is_prepaid,
          collected_amount: toNumber(s.collected_amount),
          anticipo_amount: toNumber(s.anticipo_amount),
          withholding_amount: toNumber(s.withholding_amount),
          grand_total: toNumber(s.dispatch_note?.grand_total),
        }),
      );
      const breakdown = (r.stops as any[]).reduce(
        (acc, s) => {
          const b = toWithholdingBreakdown(s.withholding_breakdown);
          acc.retefuente += b.retefuente ?? 0;
          acc.reteiva += b.reteiva ?? 0;
          acc.reteica += b.reteica ?? 0;
          return acc;
        },
        { retefuente: 0, reteiva: 0, reteica: 0 },
      );
      const totalWithholdings = (r.stops as any[]).reduce(
        (sum, s) => sum + toNumber(s.withholding_amount),
        0,
      );

      // Portador de la ruta — mismo patrón que `buildPlanillaRows` (B.2):
      // conductor interno/externo, luego primer auxiliar con nombre.
      const driverName = r.is_primary_driver_external
        ? (r.external_driver_name ?? null)
        : fullName(r.driver_user);
      const conductorNombre =
        driverName ??
        asAssistantArray(r.assistants)
          .map((a) => assistantDisplayName(a, assistantNames))
          .find((n): n is string => !!n && n.trim().length > 0) ??
        null;
      const conductorTipo: PortadorTipo | null = r.is_primary_driver_external
        ? r.external_driver_name
          ? 'conductor_externo'
          : conductorNombre
            ? 'auxiliar'
            : null
        : fullName(r.driver_user)
          ? 'conductor_interno'
          : conductorNombre
            ? 'auxiliar'
            : null;

      return {
        route_number: r.route_number,
        status: r.status,
        planned_date: r.planned_date,
        conductor_nombre: conductorNombre,
        conductor_tipo: conductorTipo,
        placa_vehiculo: r.vehicle?.plate ?? null,
        is_carrier_route: r.is_carrier_route ?? false,
        delivered_value: round2(computeDeliveredValue(valueInputs)),
        cash_collected: round2(computeCashCollected(cashInputs)),
        total_prepaid: toNumber(r.total_prepaid),
        total_withholdings: round2(totalWithholdings),
        withholding_breakdown: {
          retefuente: round2(breakdown.retefuente),
          reteiva: round2(breakdown.reteiva),
          reteica: round2(breakdown.reteica),
        },
        declared_cash: toNullableNumber(r.declared_cash),
        cash_variance: toNullableNumber(r.cash_variance),

        // Extra conservado (no declarado en DispatchCollectionsRoute).
        route_id: r.id,
      };
    });

    const totals = routeRows.reduce(
      (acc, row) => {
        acc.delivered_value += row.delivered_value;
        acc.cash_collected += row.cash_collected;
        acc.total_prepaid += row.total_prepaid;
        acc.total_withholdings += row.total_withholdings;
        // `cash_variance` SOLO existe (no-null) en rutas cerradas —
        // sumar `?? 0` la excluye naturalmente de las rutas aún abiertas,
        // igual que `getDispatchSummary`. Nunca se recalcula: es el valor
        // PERSISTIDO por el cierre (route-flow.service.ts).
        acc.cash_variance += row.cash_variance ?? 0;
        acc.retefuente += row.withholding_breakdown.retefuente;
        acc.reteiva += row.withholding_breakdown.reteiva;
        acc.reteica += row.withholding_breakdown.reteica;
        return acc;
      },
      {
        delivered_value: 0,
        cash_collected: 0,
        total_prepaid: 0,
        total_withholdings: 0,
        cash_variance: 0,
        retefuente: 0,
        reteiva: 0,
        reteica: 0,
      },
    );

    return {
      routes: routeRows,
      totals: {
        delivered_value: round2(totals.delivered_value),
        cash_collected: round2(totals.cash_collected),
        total_prepaid: round2(totals.total_prepaid),
        total_withholdings: round2(totals.total_withholdings),
        cash_variance: round2(totals.cash_variance),
        retefuente: round2(totals.retefuente),
        reteiva: round2(totals.reteiva),
        reteica: round2(totals.reteica),
      },

      // --- Extras conservados (no declarados en DispatchCollections). ---
      route_type: routeType,
      truncated,
    };
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

// countStops migrated to the contract as `countDispatchStops`
// (analytics-metrics.contract.ts) — PLAN-analytics-despachos-2026-09-12 Paso 1.

/** `withholding_breakdown` es Json libre: forma inesperada → objeto vacío. */
function toWithholdingBreakdown(value: unknown): WithholdingBreakdown {
  if (typeof value !== 'object' || value === null) return {};
  const v = value as Record<string, unknown>;
  const result: WithholdingBreakdown = {};
  if (typeof v.retefuente === 'number') result.retefuente = v.retefuente;
  if (typeof v.reteiva === 'number') result.reteiva = v.reteiva;
  if (typeof v.reteica === 'number') result.reteica = v.reteica;
  return result;
}

/** `DispatchNoteAggRow` → entrada de `computeCashCollected` (contrato). */
function toCashInput(r: DispatchNoteAggRow): DispatchCashStopInput {
  return {
    is_prepaid: r.is_prepaid,
    payment_method: r.payment_method,
    collected_amount: r.collected_amount,
    anticipo_amount: r.anticipo_amount,
  };
}

/** `DispatchNoteAggRow` → entrada de `computeDeliveredValue` (contrato). */
function toValueInput(r: DispatchNoteAggRow): DispatchDeliveredValueStopInput {
  return {
    status: r.stop_status,
    is_prepaid: r.is_prepaid,
    collected_amount: r.collected_amount,
    anticipo_amount: r.anticipo_amount,
    withholding_amount: r.withholding_amount,
    grand_total: r.grand_total,
  };
}

/** `DispatchNoteAggRow` → entrada de `computeFulfillmentRate` (contrato). */
function toFulfillmentInput(
  r: DispatchNoteAggRow,
): DispatchFulfillmentStopInput {
  return { status: r.stop_status };
}
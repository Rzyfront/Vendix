/**
 * Programación y Agenda (agenda-unificada F1).
 *
 * Una sola lectura de lo que la tienda tiene programado: reservas de servicio
 * (`bookings`) y pedidos programados (`order_fulfillment_schedules`). Cada
 * fuente tiene un adaptador que normaliza sus filas a `SchedulingEvent`; la
 * lógica de negocio (confirmar, reprogramar, enviar a cocina…) sigue en el
 * módulo dueño de cada fuente.
 */

export const SCHEDULING_EVENT_TYPES = ['booking', 'scheduled_order'] as const;
export type SchedulingEventType = (typeof SCHEDULING_EVENT_TYPES)[number];

/**
 * Estado común para filtrar y colorear. Cada evento conserva además su estado
 * nativo (`status`) y su etiqueta (`status_label`).
 */
export const SCHEDULING_STATUS_GROUPS = [
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type SchedulingStatusGroup = (typeof SCHEDULING_STATUS_GROUPS)[number];

export const SCHEDULING_STATUS_GROUP_LABELS: Record<SchedulingStatusGroup, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No asistió / vencido',
};

/** Fuente: módulo del panel, permiso de lectura y etiqueta visible. */
export interface SchedulingSourceDescriptor {
  type: SchedulingEventType;
  label: string;
  /** Key de `MODULE_INDUSTRIES` que habilita la fuente por industria. */
  module_key: string;
  /** Permiso de lectura del módulo dueño. */
  permission: string;
}

export const SCHEDULING_SOURCES: Record<SchedulingEventType, SchedulingSourceDescriptor> = {
  booking: {
    type: 'booking',
    label: 'Reserva de servicio',
    module_key: 'orders_reservations',
    permission: 'store:reservations:read',
  },
  scheduled_order: {
    type: 'scheduled_order',
    label: 'Pedido programado',
    module_key: 'orders_scheduled',
    permission: 'store:scheduled_orders:read',
  },
};

/** Evento normalizado que devuelven `/store/scheduling/events` y `/calendar`. */
export interface SchedulingEvent {
  /** `${type}:${source_id}` */
  id: string;
  type: SchedulingEventType;
  type_label: string;
  /** Id del registro origen (booking o order_fulfillment_schedule). */
  source_id: number;
  /** Número visible (reserva o pedido). */
  reference: string;
  title: string;
  /** Instante ISO UTC. */
  start: string;
  end: string;
  /** Fecha y hora locales de la tienda (`YYYY-MM-DD`, `HH:mm`). */
  date: string;
  local_start: string;
  end_date: string;
  local_end: string;
  status: string;
  status_label: string;
  status_group: SchedulingStatusGroup;
  staff: { id: number; name: string } | null;
  customer: { id: number | null; name: string } | null;
  /** Orden de venta asociada, si existe. */
  order_id: number | null;
  /** Detalle propio de la fuente (servicio, recogida/domicilio…). */
  detail: string | null;
}

export interface SchedulingFilters {
  types?: SchedulingEventType[];
  status_groups?: SchedulingStatusGroup[];
  staff_ids?: number[];
  search?: string;
  /** `YYYY-MM-DD` locales de la tienda, inclusivos. */
  from?: string;
  to?: string;
  order: 'asc' | 'desc';
}

/** Contexto ya resuelto de la tienda que reciben los adaptadores. */
export interface SchedulingStoreContext {
  store_id: number;
  timezone: string;
}

export interface SchedulingSourcePage {
  total: number;
  /** Primeras `take` filas ya normalizadas, en el orden pedido. */
  events: SchedulingEvent[];
  /** La fuente cortó su lectura en memoria (rango demasiado grande). */
  truncated: boolean;
}

/** Contrato de cada adaptador. */
export interface SchedulingSource {
  readonly type: SchedulingEventType;
  fetch(
    ctx: SchedulingStoreContext,
    filters: SchedulingFilters,
    take: number,
  ): Promise<SchedulingSourcePage>;
}

/** Orden total y estable entre fuentes: inicio, luego tipo, luego id. */
export function compareSchedulingEvents(
  a: SchedulingEvent,
  b: SchedulingEvent,
  order: 'asc' | 'desc' = 'asc',
): number {
  const sign = order === 'desc' ? -1 : 1;
  const byStart = a.start.localeCompare(b.start);
  if (byStart !== 0) return byStart * sign;
  const byType = a.type.localeCompare(b.type);
  if (byType !== 0) return byType;
  return (a.source_id - b.source_id) * sign;
}

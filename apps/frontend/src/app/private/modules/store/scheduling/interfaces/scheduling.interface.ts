/**
 * Órdenes → Programación y Agenda (agenda-unificada F1). Contrato de
 * `GET /store/scheduling/{sources,events,calendar}`.
 */

export type SchedulingEventType = 'booking' | 'scheduled_order';

export type SchedulingStatusGroup =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface SchedulingEvent {
  /** `${type}:${source_id}` */
  id: string;
  type: SchedulingEventType;
  type_label: string;
  source_id: number;
  reference: string;
  title: string;
  /** ISO UTC */
  start: string;
  end: string;
  /** Fecha y hora locales de la tienda */
  date: string;
  local_start: string;
  end_date: string;
  local_end: string;
  status: string;
  status_label: string;
  status_group: SchedulingStatusGroup;
  staff: { id: number; name: string } | null;
  customer: { id: number | null; name: string } | null;
  order_id: number | null;
  detail: string | null;
}

export interface SchedulingOption<T = string> {
  value: T;
  label: string;
}

export interface SchedulingSources {
  timezone: string;
  /** Hoy en la zona de la tienda (`YYYY-MM-DD`). */
  today: string;
  types: SchedulingOption<SchedulingEventType>[];
  status_groups: SchedulingOption<SchedulingStatusGroup>[];
  staff: { id: number; name: string }[];
}

/** Filtros comunes de la tabla y el calendario. */
export interface SchedulingQuery {
  types?: SchedulingEventType[];
  status_groups?: SchedulingStatusGroup[];
  staff_ids?: number[];
  search?: string;
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface SchedulingListResponse {
  data: SchedulingEvent[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    truncated?: boolean;
    types?: SchedulingEventType[];
  };
}

export interface SchedulingCalendarResult {
  data: SchedulingEvent[];
  truncated: boolean;
  types: SchedulingEventType[];
}

/** Variante de `<app-badge>` por grupo de estado. */
export const STATUS_GROUP_BADGE: Record<
  SchedulingStatusGroup,
  'warning' | 'info' | 'primary' | 'success' | 'neutral' | 'error'
> = {
  pending: 'warning',
  confirmed: 'info',
  in_progress: 'primary',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'error',
};

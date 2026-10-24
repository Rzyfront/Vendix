/** Contrato de GET /store/service-reminders/registry (ver service-reminders.service.ts). */

export type ServiceRegistryFilter = 'all' | 'recurring' | 'due_soon' | 'overdue';

export type RecurrenceStatus = 'none' | 'ok' | 'due_soon' | 'due_today' | 'overdue' | 'superseded';

export interface ServiceRegistryRow {
  row_key: string;
  source: 'station' | 'order';
  session_id: number | null;
  source_order_id: number;
  order_number: string | null;
  customer: { id: number | null; name: string; email: string | null; phone: string | null; registered: boolean };
  service: { id: number; name: string; is_recurring: boolean; recurrence_interval_days: number | null };
  station: { id: number; name: string } | null;
  subject: { type: string; label: string; display: string | null } | null;
  /** Timestamp ISO del servicio (cierre de la sesión o completado de la orden). */
  service_date: string;
  /** Fecha civil del servicio en la zona horaria de la tienda (YYYY-MM-DD). */
  service_local_date: string;
  days_since: number;
  /** YYYY-MM-DD (date-only) o null si no es recurrente. */
  next_due_date: string | null;
  /** Negativo = vencido. Null si no es recurrente. */
  days_remaining: number | null;
  recurrence_status: RecurrenceStatus;
  reminder: { id: number; status: 'pending' | 'sent' | 'dismissed' | string; channel: string; sent_at: string | null; due_date: string } | null;
  can_dismiss: boolean;
}

export interface ServiceRegistryStats {
  total: number;
  recurring: number;
  due_soon: number;
  overdue: number;
}

export interface ServiceRegistryResponse {
  success: boolean;
  message: string;
  data: ServiceRegistryRow[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    stats: ServiceRegistryStats;
  };
}

export interface ServiceRegistryQuery {
  filter: ServiceRegistryFilter;
  search?: string;
  page: number;
  limit: number;
}

/** Identificador de una fila para las acciones. */
export interface ServiceRegistryRowRef {
  source_order_id: number;
  product_id: number;
}

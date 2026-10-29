/** Hospitality Suite (H4.2) — assisted SIRE (Migración Colombia) of foreign guests. */
export type SireStatus = 'pending' | 'manual';
/** List filter: `overdue` = pending past the store threshold. */
export type SireFilter = 'pending' | 'overdue' | 'manual';
export type SireEvent = 'check_in' | 'check_out';

export interface SireSubmission {
  id: number;
  reservation_id: number;
  reservation_number: string;
  guest_id: number | null;
  guest_name: string;
  event: SireEvent;
  status: SireStatus;
  /** When it was marked reported. */
  sent_at: string | null;
  /** When the entry or exit happened. */
  created_at: string;
  reported_by_name: string | null;
  /** Hours since the movement (until it was reported, for reported ones). */
  age_hours: number;
  overdue: boolean;
}

/** Fields of the SIRE form, in its order. */
export interface SireRecord {
  tipo_movimiento: string;
  fecha_movimiento: string;
  tipo_documento: string;
  numero_documento: string;
  nacionalidad: string;
  primer_apellido: string;
  segundo_apellido: string;
  nombres: string;
  fecha_nacimiento: string;
  procedencia: string;
  residencia: string;
  habitacion: string;
  permiso_ingreso: string;
}

export interface SireSheet extends SireSubmission {
  record: SireRecord | null;
  missing: string[];
}

export interface SireSummary {
  enabled: boolean;
  overdue_hours: number;
  stats: { pending: number; overdue: number; manual: number; total: number };
}

export interface SireListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: SireFilter;
}

export interface SireListResult {
  data: SireSubmission[];
  total: number;
  totalPages: number;
}

/** Hospitality Suite (H0.3) — housekeeping state of a physical room. */
export type HousekeepingStatus =
  | 'clean'
  | 'dirty'
  | 'inspected'
  | 'out_of_order'
  | 'out_of_service';

export const HOUSEKEEPING_STATUS_LABELS: Record<HousekeepingStatus, string> = {
  clean: 'Limpia',
  dirty: 'Sucia',
  inspected: 'Inspeccionada',
  out_of_order: 'Fuera de servicio',
  out_of_service: 'No disponible',
};

/** Physical room as returned by the store API. */
export interface LodgingUnit {
  id: number;
  unit_type_id: number;
  code: string;
  floor: string | null;
  zone: string | null;
  housekeeping_status: HousekeepingStatus;
  is_active: boolean;
  unit_type: { id: number; name: string };
}

export interface LodgingUnitPayload {
  code: string;
  unit_type_id: number;
  floor?: string;
  zone?: string;
}

export interface LodgingUnitsBulkPayload {
  codes: string[];
  unit_type_id: number;
  floor?: string;
  zone?: string;
}

/** Max rooms created at once (mirrors the API `@ArrayMaxSize(100)`). */
export const MAX_BULK_UNITS = 100;

/** "101" → "110" expands to 101…110; null when the range is not valid. */
export function expandUnitRange(from: number, to: number): string[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    return null;
  }
  if (to - from + 1 > MAX_BULK_UNITS) return null;
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}

import { HousekeepingStatus } from '../../rooms/interfaces/unit.interface';

/** Hospitality Suite (H5.1) — guest situation of a room today. */
export type HousekeepingOccupancy = 'in_house' | 'departs_today' | null;

export interface HousekeepingBoardUnit {
  id: number;
  code: string;
  floor: string | null;
  zone: string | null;
  housekeeping_status: HousekeepingStatus;
  unit_type: { id: number; name: string };
  occupancy: HousekeepingOccupancy;
}

export interface HousekeepingBoard {
  business_date: string;
  units: HousekeepingBoardUnit[];
}

/** Mirrors the API `HOUSEKEEPING_TRANSITIONS`; the API has the last word. */
export const HOUSEKEEPING_TRANSITIONS: Record<HousekeepingStatus, HousekeepingStatus[]> = {
  dirty: ['clean', 'out_of_order', 'out_of_service'],
  clean: ['inspected', 'dirty', 'out_of_order', 'out_of_service'],
  inspected: ['dirty', 'out_of_order', 'out_of_service'],
  out_of_order: ['dirty', 'clean', 'out_of_service'],
  out_of_service: ['dirty', 'clean', 'out_of_order'],
};

/** Next step of the cleaning cycle, offered as the room's quick action. */
export const HOUSEKEEPING_QUICK_ACTION: Partial<
  Record<HousekeepingStatus, { to: HousekeepingStatus; label: string }>
> = {
  dirty: { to: 'clean', label: 'Marcar limpia' },
  clean: { to: 'inspected', label: 'Inspeccionada' },
  out_of_order: { to: 'dirty', label: 'Volver a servicio' },
  out_of_service: { to: 'dirty', label: 'Volver a servicio' },
};

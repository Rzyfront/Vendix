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

/**
 * Mirrors the API `HOUSEKEEPING_STATUS_PERMISSIONS`: inspecting and taking a
 * room out of the sale need any one of these; other moves only `operate`.
 */
export const HOUSEKEEPING_STATUS_PERMISSIONS: Partial<Record<HousekeepingStatus, string[]>> = {
  inspected: ['store:lodging:housekeeping:assign'],
  out_of_order: ['store:lodging:housekeeping:assign', 'store:lodging:inventory:write'],
  out_of_service: ['store:lodging:housekeeping:assign', 'store:lodging:inventory:write'],
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

/** Hospitality Suite (H5.2) — tasks per housekeeper. */
export type HousekeepingTaskType = 'checkout_clean' | 'stayover' | 'inspection' | 'maintenance';
export type HousekeepingTaskStatus = 'pending' | 'done';

export const HOUSEKEEPING_TASK_TYPE_LABELS: Record<HousekeepingTaskType, string> = {
  checkout_clean: 'Limpieza de salida',
  stayover: 'Repaso',
  inspection: 'Inspección',
  maintenance: 'Mantenimiento',
};

export interface HousekeepingTask {
  id: number;
  task_date: string;
  type: HousekeepingTaskType;
  status: HousekeepingTaskStatus;
  assigned_user_id: number | null;
  notes: string | null;
  completed_at: string | null;
  unit: {
    id: number;
    code: string;
    floor: string | null;
    housekeeping_status: HousekeepingStatus;
    unit_type: { id: number; name: string };
  };
}

export interface HousekeepingStaffMember {
  id: number;
  name: string;
}

export interface HousekeepingTasksDay {
  business_date: string;
  tasks: HousekeepingTask[];
  /** Only on the head housekeeper's view. */
  staff?: HousekeepingStaffMember[];
}

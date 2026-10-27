/** Hospitality Suite (H6.1) — a room with its iCal export token. */
export interface IcalExportUnit {
  id: number;
  code: string;
  floor: string | null;
  is_active: boolean;
  /** null = the room does not publish a feed. */
  ical_export_token: string | null;
  unit_type: { id: number; name: string };
}

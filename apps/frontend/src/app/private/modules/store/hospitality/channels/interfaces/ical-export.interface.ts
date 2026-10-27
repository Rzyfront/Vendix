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

/** H6.2 — outcome of the last sync of an imported calendar. */
export type IcalImportStatus = 'ok' | 'warning' | 'error';

/** H6.2 — an external calendar (Airbnb, Booking) imported into a room. */
export interface IcalImport {
  id: number;
  unit_id: number;
  /** Channel label, also shown on the rack blocks. */
  name: string;
  url: string;
  last_synced_at: string | null;
  last_sync_status: IcalImportStatus | null;
  last_sync_message: string | null;
  last_sync_events: number | null;
  unit: { id: number; code: string; unit_type: { name: string } };
}

export interface CreateIcalImportRequest {
  unit_id: number;
  name: string;
  url: string;
}

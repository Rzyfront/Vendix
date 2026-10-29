/**
 * Hospitality Suite (H8.4, D12) — key / access card handover of a
 * reservation: which key, to which guest, who handed it and when, and its
 * return. `returned_at` null = the guest still has it.
 */
export interface LodgingKeyHandover {
  id: number;
  reservation_id: number;
  reservation_room_id: number | null;
  key_label: string;
  guest_name: string;
  notes: string | null;
  delivered_at: string;
  delivered_by_name: string | null;
  returned_at: string | null;
  returned_by_name: string | null;
  /** Physical room the key belongs to; null when not given. */
  room_code: string | null;
}

export interface DeliverKeyRequest {
  key_label: string;
  guest_name: string;
  reservation_room_id?: number;
  notes?: string;
}

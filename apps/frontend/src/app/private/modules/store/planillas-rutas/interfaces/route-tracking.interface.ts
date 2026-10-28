/** One GPS fix of the route responsible (mirrors backend `Pos`). */
export interface RoutePosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recorded_at: string;
}

/** Point sent to `POST /store/dispatch-routes/:id/tracking/positions`. */
export interface PublishPositionPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  recorded_at: string;
}

/** `GET /store/dispatch-routes/:id/tracking` -> `data`. */
export interface RouteTrackingSnapshot {
  tracking_enabled: boolean;
  responsible: { user_id: number; name: string } | null;
  is_external_responsible: boolean;
  is_viewer_responsible: boolean;
  /**
   * The responsible's device shares its position with the route: they
   * dispatched it themselves or already synced (reported positions).
   */
  is_responsible_linked: boolean;
  route_status: string;
  last_position: RoutePosition | null;
  trail: RoutePosition[];
}

/** Publisher lifecycle state (responsible user's device only). */
export type PositionPublisherState =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'paused';

/** Live channel health for spectators. */
export type TrackingConnectionState = 'connecting' | 'sse' | 'polling' | 'closed';

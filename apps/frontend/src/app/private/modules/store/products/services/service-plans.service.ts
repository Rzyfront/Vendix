import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

export type PlanDepartureMode = 'fixed' | 'on_demand' | 'both';
export type PlanDepartureStatus = 'open' | 'closed' | 'cancelled';

export interface PlanPaxPrice {
  id?: number;
  min_pax: number;
  max_pax: number;
  price: number;
}

export interface PlanDeparture {
  id: number;
  product_id: number;
  departure_date: string;
  capacity: number;
  seats_sold: number;
  seats_available: number;
  price_override: number | null;
  status: PlanDepartureStatus;
  notes: string | null;
}

/** Actividad del itinerario (QUI-1060 F2). Costo y responsables son internos. */
export interface PlanActivity {
  id: number;
  product_id: number;
  day_number: number;
  start_time: string | null;
  title: string;
  description: string | null;
  sort_order: number;
  provider_id: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  cost: number | null;
  creates_task: boolean;
  is_public: boolean;
}

export interface PlanActivityInput {
  day_number?: number;
  start_time?: string | null;
  title?: string;
  description?: string | null;
  provider_id?: number | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_contact?: string | null;
  cost?: number | null;
  creates_task?: boolean;
  is_public?: boolean;
}

/** Tarea del CRM generada por una actividad de un plan al confirmar la reserva (QUI-1060 F3). */
export interface PlanBookingTask {
  link_id: number;
  task_id: number | null;
  activity_id: number | null;
  day_number: number | null;
  kind: 'internal' | 'supplier' | 'none';
  title: string;
  status: 'pending' | 'done' | 'cancelled' | null;
  /** ISO UTC. */
  due_at: string | null;
  assigned_user: { id: number; first_name: string | null; last_name: string | null } | null;
}

/** Comprobante de una reserva de plan: evento, ida y regreso, grupo e itinerario público. */
export interface PlanBookingItinerary {
  booking_id: number;
  product_id: number;
  departure_id: number | null;
  start_date: string;
  end_date: string;
  duration_days: number;
  duration_nights: number | null;
  pax_adults: number | null;
  pax_children: number | null;
  total_pax: number | null;
  itinerary: {
    day_number: number;
    date: string | null;
    activities: { start_time: string | null; title: string; description: string | null }[];
  }[];
}

export interface ServicePlan {
  product_id: number;
  is_plan: boolean;
  plan_duration_days: number | null;
  plan_duration_nights: number | null;
  plan_departure_mode: PlanDepartureMode | null;
  plan_min_pax: number | null;
  plan_max_pax: number | null;
  pax_prices: PlanPaxPrice[];
  departures: PlanDeparture[];
  activities?: PlanActivity[];
}

export interface CreateDepartureInput {
  departure_date: string;
  capacity: number;
  price_override?: number | null;
  notes?: string;
}

export interface UpdateDepartureInput {
  capacity?: number;
  price_override?: number | null;
  status?: PlanDepartureStatus;
  notes?: string;
}

/** `/store/service-plans`: pax price tiers and departures of "Plan / paquete" services (QUI-1060). */
@Injectable({ providedIn: 'root' })
export class ServicePlansService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/service-plans`;

  get(productId: number, includePast = false): Observable<ServicePlan> {
    const query = includePast ? '?include_past=true' : '';
    return this.http
      .get<{ data?: ServicePlan }>(`${this.apiUrl}/${productId}${query}`)
      .pipe(map((res) => (res?.data ?? (res as unknown as ServicePlan))));
  }

  replacePaxPrices(productId: number, tiers: PlanPaxPrice[]): Observable<PlanPaxPrice[]> {
    const body = {
      tiers: tiers.map((t) => ({ min_pax: t.min_pax, max_pax: t.max_pax, price: t.price })),
    };
    return this.http
      .put<{ data?: PlanPaxPrice[] }>(`${this.apiUrl}/${productId}/pax-prices`, body)
      .pipe(map((res) => (res?.data ?? (res as unknown as PlanPaxPrice[]))));
  }

  createDeparture(productId: number, dto: CreateDepartureInput): Observable<PlanDeparture> {
    return this.http
      .post<{ data?: PlanDeparture }>(`${this.apiUrl}/${productId}/departures`, dto)
      .pipe(map((res) => (res?.data ?? (res as unknown as PlanDeparture))));
  }

  updateDeparture(productId: number, departureId: number, dto: UpdateDepartureInput): Observable<PlanDeparture> {
    return this.http
      .patch<{ data?: PlanDeparture }>(`${this.apiUrl}/${productId}/departures/${departureId}`, dto)
      .pipe(map((res) => (res?.data ?? (res as unknown as PlanDeparture))));
  }

  // ---- Itinerario (QUI-1060 F2) ----

  createActivity(productId: number, dto: PlanActivityInput): Observable<PlanActivity> {
    return this.http
      .post<{ data?: PlanActivity }>(`${this.apiUrl}/${productId}/activities`, dto)
      .pipe(map((res) => (res?.data ?? (res as unknown as PlanActivity))));
  }

  updateActivity(productId: number, activityId: number, dto: PlanActivityInput): Observable<PlanActivity> {
    return this.http
      .patch<{ data?: PlanActivity }>(`${this.apiUrl}/${productId}/activities/${activityId}`, dto)
      .pipe(map((res) => (res?.data ?? (res as unknown as PlanActivity))));
  }

  deleteActivity(productId: number, activityId: number): Observable<{ id: number }> {
    return this.http
      .delete<{ data?: { id: number } }>(`${this.apiUrl}/${productId}/activities/${activityId}`)
      .pipe(map((res) => (res?.data ?? (res as unknown as { id: number }))));
  }

  reorderActivities(productId: number, dayNumber: number, activityIds: number[]): Observable<PlanActivity[]> {
    return this.http
      .put<{ data?: PlanActivity[] }>(`${this.apiUrl}/${productId}/activities/reorder`, {
        day_number: dayNumber,
        activity_ids: activityIds,
      })
      .pipe(map((res) => (res?.data ?? (res as unknown as PlanActivity[]))));
  }

  /** Comprobante de una reserva: null cuando la reserva no es de un plan. */
  getBookingItinerary(bookingId: number): Observable<PlanBookingItinerary | null> {
    return this.http
      .get<{ data?: PlanBookingItinerary | null }>(`${this.apiUrl}/bookings/${bookingId}/itinerary`)
      .pipe(map((res) => res?.data ?? null));
  }

  /** Tareas del CRM de una reserva: null cuando la reserva no es de un plan. */
  getBookingTasks(bookingId: number): Observable<PlanBookingTask[] | null> {
    return this.http
      .get<{ data?: PlanBookingTask[] | null }>(`${this.apiUrl}/bookings/${bookingId}/tasks`)
      .pipe(map((res) => res?.data ?? null));
  }
}

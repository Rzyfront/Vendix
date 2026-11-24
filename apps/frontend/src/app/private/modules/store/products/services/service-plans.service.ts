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
}

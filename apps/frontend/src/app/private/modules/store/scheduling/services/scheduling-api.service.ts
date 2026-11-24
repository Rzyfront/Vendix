import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { MenuFilterService } from '../../../../../core/services/menu-filter.service';
import {
  SchedulingCalendarResult,
  SchedulingEventType,
  SchedulingListResponse,
  SchedulingQuery,
  SchedulingSources,
} from '../interfaces/scheduling.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Query → params: listas separadas por coma, vacíos fuera. */
export function schedulingParams(query: SchedulingQuery): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params = params.set(key, value.join(','));
      continue;
    }
    params = params.set(key, String(value));
  }
  return params;
}

/** Key de módulo del panel de cada fuente. */
export const TYPE_KEY: Record<SchedulingEventType, string> = {
  booking: 'orders_reservations',
  scheduled_order: 'orders_scheduled',
};

/** Órdenes → Agenda: lectura agregada (`/store/scheduling`). */
@Injectable({ providedIn: 'root' })
export class SchedulingApiService {
  private readonly http = inject(HttpClient);
  private readonly menuFilter = inject(MenuFilterService);
  private readonly baseUrl = `${environment.apiUrl}/store/scheduling`;

  /**
   * Fuentes que el backend habilita (industria, permiso, ajuste) ∩ las que el
   * panel del usuario deja abiertas (`panel_ui` de usuario y tienda, plan):
   * reservas con `orders_reservations`, pedidos con `orders_scheduled`.
   */
  getSources(): Observable<SchedulingSources> {
    return this.http
      .get<ApiResponse<SchedulingSources>>(`${this.baseUrl}/sources`)
      .pipe(map((r) => this.restrictToPanel(r.data)));
  }

  getEvents(query: SchedulingQuery): Observable<SchedulingListResponse> {
    const scoped = this.withPanelTypes(query);
    if (!scoped.types?.length) {
      const limit = query.limit ?? 20;
      return of({ data: [], meta: { total: 0, page: query.page ?? 1, limit, totalPages: 0 } });
    }
    return this.http
      .get<SchedulingListResponse>(`${this.baseUrl}/events`, {
        params: schedulingParams(scoped),
      })
      .pipe(map((r) => ({ data: r.data ?? [], meta: r.meta })));
  }

  getCalendar(query: SchedulingQuery & { from: string; to: string }): Observable<SchedulingCalendarResult> {
    const scoped = this.withPanelTypes(query);
    if (!scoped.types?.length) return of({ data: [], truncated: false, types: [], availability: [] });
    return this.http
      .get<ApiResponse<SchedulingCalendarResult>>(`${this.baseUrl}/calendar`, {
        params: schedulingParams(scoped),
      })
      .pipe(map((r) => r.data));
  }

  /** Tipos que el panel del usuario deja ver. */
  panelTypes(): SchedulingEventType[] {
    const open = this.menuFilter.openAnyOfKeys(Object.values(TYPE_KEY), 'url');
    return (Object.keys(TYPE_KEY) as SchedulingEventType[]).filter((type) =>
      open.includes(TYPE_KEY[type]),
    );
  }

  private restrictToPanel(sources: SchedulingSources): SchedulingSources {
    const allowed = this.panelTypes();
    const types = (sources?.types ?? []).filter((t) => allowed.includes(t.value));
    return {
      ...sources,
      types,
      // El personal es de reservas: sin reservas abiertas no se ofrece.
      staff: types.some((t) => t.value === 'booking') ? (sources?.staff ?? []) : [],
    };
  }

  /**
   * Sin filtro de tipo se piden solo los tipos abiertos en el panel. Si el
   * filtro solo traía tipos cerrados queda vacío y no se pide nada: nunca se
   * consulta sin filtro de tipo (el backend devolvería todas sus fuentes).
   */
  private withPanelTypes<T extends SchedulingQuery>(query: T): T {
    const allowed = this.panelTypes();
    const types = query.types?.length
      ? query.types.filter((type) => allowed.includes(type))
      : allowed;
    return { ...query, types };
  }
}

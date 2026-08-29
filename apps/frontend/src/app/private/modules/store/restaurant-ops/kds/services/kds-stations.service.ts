import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  KdsConsumptionHistoryRow,
  KdsConsumptionSummary,
  KdsSession,
  KdsStation,
} from '../interfaces';

interface ApiResponse<T> {
  success?: boolean;
  data: T;
  message?: string;
}

/**
 * Cliente de estaciones de preparación y turnos — QUI-651.
 *
 * Mantiene el estado en señales porque tres consumidores lo leen sincrónicamente:
 * la pantalla de selección de estación, el board (que filtra por `kds_id`) y el
 * gate de sesión que se dispara con la primera acción de gestión.
 */
@Injectable({ providedIn: 'root' })
export class KdsStationsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly stations = signal<KdsStation[]>([]);
  readonly isLoading = signal(false);

  /**
   * Estación seleccionada. Es el eje del módulo: el board filtra por ella y el
   * SSE se suscribe por ella, no por tienda.
   */
  readonly selectedStationId = signal<number | null>(null);

  /** Turno abierto de la estación seleccionada, o null. */
  readonly openSession = signal<KdsSession | null>(null);

  readonly activeStations = computed(() =>
    this.stations().filter((s) => s.is_active),
  );

  /**
   * Una sola estación activa => se entra directo al tablero, sin pantalla de
   * selección. Es el caso de la mayoría de los restaurantes y no debe añadir un
   * clic extra.
   */
  readonly needsStationChoice = computed(() => this.activeStations().length > 1);

  readonly selectedStation = computed(() => {
    const id = this.selectedStationId();
    return id == null ? null : (this.stations().find((s) => s.id === id) ?? null);
  });

  /** ¿Se puede gestionar un ticket? Solo con turno abierto en esta estación. */
  readonly canManageTickets = computed(() => this.openSession() != null);

  loadStations(): Observable<KdsStation[]> {
    this.isLoading.set(true);
    return this.http
      .get<ApiResponse<KdsStation[]>>(`${this.apiUrl}/store/kds`)
      .pipe(
        map((res) => res.data ?? []),
        tap((stations) => {
          this.stations.set(stations);
          this.isLoading.set(false);
          // Autoselección solo cuando NO hay ambigüedad: con una sola estación
          // activa, elegir por el operador es correcto; con varias, elegir por él
          // lo metería en un tablero que no pidió.
          const active = stations.filter((s) => s.is_active);
          if (this.selectedStationId() == null && active.length === 1) {
            this.selectedStationId.set(active[0].id);
          }
          // El turno se resuelve ACA y no en el callback de cada consumidor.
          // Depender de que el board lo pidiera dejaba `openSession` en null cuando
          // ese callback no corria, y de esa senal cuelgan el badge del turno activo
          // y la accion de cerrarlo: el cocinero no veia ninguno de los dos.
          //
          // Quien conoce la estacion conoce su turno: es responsabilidad del
          // servicio, no de la pantalla.
          const selected = this.selectedStationId();
          if (selected != null) {
            this.refreshOpenSession(selected).subscribe({
              error: () => {
                // Sin turno el tablero se sigue leyendo; el gate avisa al actuar.
              },
            });
          }
        }),
        catchError((err) => {
          this.isLoading.set(false);
          return this.fail(err, 'No se pudieron cargar las estaciones');
        }),
      );
  }

  createStation(dto: Partial<KdsStation>): Observable<KdsStation> {
    return this.http
      .post<ApiResponse<KdsStation>>(`${this.apiUrl}/store/kds`, dto)
      .pipe(
        map((res) => res.data),
        catchError((err) => this.fail(err, 'No se pudo crear la estación')),
      );
  }

  updateStation(id: number, dto: Partial<KdsStation>): Observable<KdsStation> {
    return this.http
      .put<ApiResponse<KdsStation>>(`${this.apiUrl}/store/kds/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((err) => this.fail(err, 'No se pudo actualizar la estación')),
      );
  }

  deactivateStation(id: number): Observable<KdsStation> {
    return this.http
      .delete<ApiResponse<KdsStation>>(`${this.apiUrl}/store/kds/${id}`)
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          this.fail(err, 'No se pudo desactivar la estación'),
        ),
      );
  }

  // ------------------------------------------------------------- turnos

  /**
   * Turno abierto de una estación. Se consulta al entrar al tablero para saber si
   * la primera acción de gestión debe pedir apertura — la lectura del tablero NO
   * exige sesión, misma convención que caja: la sesión se exige al ACTUAR.
   */
  refreshOpenSession(kdsId: number): Observable<KdsSession | null> {
    return this.http
      .get<ApiResponse<KdsSession | null>>(
        `${this.apiUrl}/store/kds-sessions/open/${kdsId}`,
      )
      .pipe(
        map((res) => res.data ?? null),
        tap((session) => this.openSession.set(session)),
        catchError((err) => this.fail(err, 'No se pudo leer el turno')),
      );
  }

  /**
   * Historial de turnos. Sin `kdsId` devuelve los de TODAS las estaciones, que es
   * lo que la vista de gestión necesita — a diferencia del tablero, que es de una.
   */
  listSessions(kdsId?: number): Observable<KdsSession[]> {
    let params = new HttpParams();
    if (kdsId != null) params = params.set('kds_id', String(kdsId));
    return this.http
      .get<ApiResponse<KdsSession[]>>(`${this.apiUrl}/store/kds-sessions`, {
        params,
      })
      .pipe(
        map((res) => res.data ?? []),
        catchError((err) => this.fail(err, 'No se pudo cargar el historial')),
      );
  }

  openSessionFor(kdsId: number): Observable<KdsSession> {
    return this.http
      .post<ApiResponse<KdsSession>>(`${this.apiUrl}/store/kds-sessions/open`, {
        kds_id: kdsId,
      })
      .pipe(
        map((res) => res.data),
        tap((session) => this.openSession.set(session)),
        catchError((err) => this.fail(err, 'No se pudo abrir el turno')),
      );
  }

  closeSession(
    sessionId: number,
    closingNotes?: string,
  ): Observable<KdsSession> {
    return this.http
      .post<ApiResponse<KdsSession>>(
        `${this.apiUrl}/store/kds-sessions/${sessionId}/close`,
        { closing_notes: closingNotes },
      )
      .pipe(
        map((res) => res.data),
        tap(() => this.openSession.set(null)),
        catchError((err) => this.fail(err, 'No se pudo cerrar el turno')),
      );
  }

  // -------------------------------------------------- consumo del turno

  /** Detalle: una fila por insumo POR PEDIDO, con la cantidad consumida. */
  getConsumptionHistory(
    sessionId: number,
  ): Observable<KdsConsumptionHistoryRow[]> {
    return this.http
      .get<ApiResponse<KdsConsumptionHistoryRow[]>>(
        `${this.apiUrl}/store/kds-sessions/${sessionId}/consumption-history`,
      )
      .pipe(
        map((res) => res.data ?? []),
        catchError((err) =>
          this.fail(err, 'No se pudo cargar el historial de consumos'),
        ),
      );
  }

  /**
   * Agregado: una fila por insumo con la cantidad consumida en el turno. En vivo
   * mientras la sesión está abierta; tras cerrar, el valor congelado vive en
   * `KdsSession.summary` y ya no cambia.
   */
  getConsumptionSummary(sessionId: number): Observable<KdsConsumptionSummary> {
    return this.http
      .get<ApiResponse<KdsConsumptionSummary>>(
        `${this.apiUrl}/store/kds-sessions/${sessionId}/consumption-summary`,
      )
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          this.fail(err, 'No se pudo cargar el resumen de consumos'),
        ),
      );
  }

  /** Reporte por estación y rango. Agregable por KDS, sesión y fechas. */
  getConsumptionReport(params: {
    kds_id?: number;
    from?: string;
    to?: string;
  }): Observable<any> {
    let httpParams = new HttpParams();
    if (params.kds_id != null)
      httpParams = httpParams.set('kds_id', String(params.kds_id));
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);

    return this.http
      .get<ApiResponse<any>>(
        `${this.apiUrl}/store/kds-sessions/report/consumption`,
        { params: httpParams },
      )
      .pipe(
        map((res) => res.data),
        catchError((err) => this.fail(err, 'No se pudo cargar el reporte')),
      );
  }

  /**
   * Re-lanza el mensaje del backend cuando existe, en vez del genérico. Los
   * códigos de este dominio son accionables y merecen llegar al operador:
   * KDS_SESSION_ALREADY_OPEN dice que otro ya reclamó la estación, y
   * KDS_DEFAULT_PROTECTED dice que hay que promover otra antes.
   */
  private fail(err: any, fallback: string) {
    const message =
      err?.error?.message ?? err?.error?.error?.message ?? fallback;
    return throwError(() => message as string);
  }
}

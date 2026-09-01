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
  KdsUnattributedConsumption,
} from '../interfaces';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

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
  private readonly authFacade = inject(AuthFacade);
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

  // ── QUI-XXX: helpers de "estación reclamada" ──────────────────────────────
  /** ID del usuario autenticado. Null cuando la sesión de Auth aún no hidrató. */
  readonly currentUserId = computed<number | null>(() => this.authFacade.userId() ?? null);

  /** True si el turno abierto lo abrió el caller. Null cuando no hay turno. */
  readonly sessionOpenedByMe = computed<boolean | null>(() => {
    const session = this.openSession();
    const me = this.currentUserId();
    if (session == null || me == null) return null;
    return session.opened_by === me;
  });

  /** True si el turno abierto pertenece a otro operador (badge "Reclamada por"). */
  readonly sessionHeldByOther = computed<boolean>(() => {
    const owned = this.sessionOpenedByMe();
    const session = this.openSession();
    return session != null && owned === false;
  });

  /** Roles privilegiados en el cliente — espejo de los KDS_FORCE_TAKE_ROLES del
   *  backend. Ver `kds-sessions.service.ts`. La regla está duplicada para
   *  decidir visibilidad del botón "Tomar control" sin un round-trip. */
  readonly callerIsPrivileged = computed<boolean>(() => {
    const roles = this.authFacade.userRoles() ?? [];
    return roles.includes('owner') || roles.includes('admin') || roles.includes('super_admin');
  });

  /** El botón "Tomar control" sólo aparece si hay sesión abierta ajena y el
   *  caller tiene rol privilegiado. Owner/admin/super_admin ven el botón en
   *  cualquier sesión que no sea la propia; los demás roles no lo ven jamás. */
  readonly canForceTakeCurrentStation = computed<boolean>(
    () => this.sessionHeldByOther() && this.callerIsPrivileged(),
  );

  // ─── station switching (QUI-739) ──────────────────────────────────────────
  /**
   * Devuelve la elección de estación a null y limpia la sesión en memoria.
   *
   * No cierra el turno de la estación anterior — el turno es un registro del
   * servidor por estación (`GET /store/kds-sessions/open/:kdsId`) y de él
   * cuelga el consumo firmado del fire con su costo. Si lo cerráramos al
   * cambiar de vista destruiríamos datos reales de operación. El turno abierto
   * queda intacto en el servidor y `refreshOpenSession(oldId)` lo resuelve de
   * nuevo si el usuario vuelve a la estación original.
   *
   * El stream SSE es de tienda, no de estación (ver `KdsSseService`), así
   * que la suscripción NO se desmonta al pasar por null: los tickets del SSE
   * siguen llegando y `visibleTickets` los filtra por la estación actual
   * cuando el usuario elige una nueva.
   */
  clearStation(): void {
    this.selectedStationId.set(null);
    this.openSession.set(null);
  }

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

  /**
   * Heartbeat — refresca `last_seen_at` del turno abierto. El board lo invoca
   * en un `setInterval` de 60 segundos mientras `openSession() != null`. El
   * backend refresca el campo y rechaza con `KDS_STATION_LOCKED` si el caller
   * no es el dueño del turno ni un rol privilegiado; en ese caso la UI
   * detecta el lock y deja de mandar heartbeats hasta que se libere la sesión
   * (auto-cierre por inactividad o toma manual).
   */
  heartbeat(sessionId: number): Observable<void> {
    return this.http
      .post<ApiResponse<void>>(
        `${this.apiUrl}/store/kds-sessions/${sessionId}/heartbeat`,
        {},
      )
      .pipe(
        map(() => undefined),
        catchError((err) => this.fail(err, 'No se pudo registrar el heartbeat')),
      );
  }

  /**
   * Toma forzada — cierra el turno abierto por otro operador y abre uno nuevo
   * para el caller. Disponible sólo para owner / admin / super_admin
   * (`canForceTakeCurrentStation`). Refresca `openSession` con la sesión nueva.
   *
   * Cierra y abre en la misma transacción del backend para no violar el
   * índice parcial `kds_sessions_one_open_per_kds` ni por un instante. El
   * rastro de auditoría (`force_taken_by_user_id`) queda en la sesión CERRADA;
   * la nueva es legítima del tomador y no lleva marca.
   */
  forceTake(kdsId: number): Observable<KdsSession> {
    return this.http
      .post<ApiResponse<KdsSession>>(
        `${this.apiUrl}/store/kds-sessions/force-take/${kdsId}`,
        {},
      )
      .pipe(
        map((res) => res.data),
        tap((session) => this.openSession.set(session)),
        catchError((err) => this.fail(err, 'No se pudo tomar el control de la estación')),
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
   * Consumo SIN sesión atribuida (QUI-760): movimientos del fire cuya estación
   * no tenía turno abierto al disparar. Antes del backfill siempre crecía
   * silenciosamente; ahora se reduce conforme se abren sesiones, pero las
   * ocurrencias previas a la primera apertura quedan aquí. El cocinero las ve
   * en el modal de su turno para saber que la cocina corrió consumo no
   * firmado. ADR-10 — sin dinero en el payload.
   */
  getUnattributedConsumption(params: {
    from?: string;
    to?: string;
  } = {}): Observable<KdsUnattributedConsumption> {
    let httpParams = new HttpParams();
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);

    return this.http
      .get<ApiResponse<KdsUnattributedConsumption>>(
        `${this.apiUrl}/store/kds-sessions/report/unattributed`,
        { params: httpParams },
      )
      .pipe(
        map((res) => res.data),
        catchError((err) =>
          this.fail(err, 'No se pudo cargar el consumo sin sesión'),
        ),
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

import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DialogService,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';

import {
  KDS_COLUMNS,
  KdsColumn,
  KitchenTicket,
  KitchenTicketItem,
} from '../../interfaces';
import type {
  FirePreview,
  FireItemExclusion,
  KdsConsumptionSummary,
  KdsConsumptionHistoryRow,
  KdsUnattributedConsumption,
} from '../../interfaces';
import { KitchenConfirmModalComponent } from '../../components/kitchen-confirm-modal/kitchen-confirm-modal.component';
import { KdsSessionStatusBarComponent } from '../../components/kds-session-status-bar/kds-session-status-bar.component';
import {
  KdsConnectionState,
  KdsSseService,
  KdsStationsService,
  KitchenMutationError,
  KitchenTicketsService,
} from '../../services';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import {
  parseApiError,
  withApiErrorReference,
  readApiErrorRequestId,
} from '../../../../../../../core/utils/parse-api-error';
import { KdsTicketCardComponent } from '../../components/kds-ticket-card/kds-ticket-card.component';
import { KdsTicketDetailModalComponent } from '../../components/kds-ticket-detail-modal/kds-ticket-detail-modal.component';

/**
 * KDS Board — real-time kitchen display.
 *
 * Renders five columns (Pending, In Preparation, Ready, Delivered,
 * Cancelled) and subscribes to the SSE stream via `KdsSseService`.
 * Delivered (green) and Cancelled (red) are kept as separate columns so
 * the kitchen never confuses an order that left with one that was
 * voided. The page:
 *  - groups tickets by status (computed signals) so the template can
 *    render a column per state without re-iterating the array;
 *  - delegates the action buttons on each card to its own methods
 *    (`startTicket`, `markTicketReady`, `markTicketDelivered`,
 *    `cancelTicket`) which call the HTTP service and let the SSE
 *    stream reconcile the final state — no optimistic patching here.
 *  - owns a SINGLE 1s `now` ticker shared with every card (instead of
 *    one timer per card) and pushes it down as an input;
 *  - shows a connecting loader before the first snapshot, surfaces a
 *    connection indicator + reconnect counter, and toasts when the
 *    stream recovers from a failure.
 */
@Component({
  selector: 'app-kds-board-page',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    IconComponent,
    BadgeComponent,
    KdsTicketCardComponent,
    KdsTicketDetailModalComponent,
    ModalComponent,
    ButtonComponent,
    KitchenConfirmModalComponent,
    KdsSessionStatusBarComponent,
  ],
  templateUrl: './kds-board-page.component.html',
  styleUrl: './kds-board-page.component.scss',
})
export class KdsBoardPageComponent implements OnInit, OnDestroy {
  private readonly kdsSse = inject(KdsSseService);
  private readonly ticketsService = inject(KitchenTicketsService);
  /**
   * QUI-651 — el board es de UNA estacion. `selectedStationId` alimenta el filtro
   * de `visibleTickets`, y `canManageTickets` decide si la primera accion de
   * gestion tiene que pedir apertura de turno.
   */
  readonly stationsService = inject(KdsStationsService);
  /**
   * QUI-651 — gate de turno. `sessionGatePending` recuerda QUE ticket se quiso
   * gestionar para reintentarlo tras abrir la sesion, en vez de obligar al
   * operador a volver a buscarlo en el tablero.
   */
  readonly sessionGateOpen = signal(false);
  readonly sessionGatePending = signal<number | null>(null);
  readonly openingSession = signal(false);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly columns = KDS_COLUMNS;
  /** Raw ticket set from the SSE/snapshot service (unfiltered by day). */
  readonly tickets = this.kdsSse.tickets;
  readonly connectionState = this.kdsSse.connectionState;
  readonly lastReconnect = this.kdsSse.lastReconnect;
  readonly lastError = this.kdsSse.lastError;
  readonly mode = this.kdsSse.mode;
  readonly consecutiveFailures = this.kdsSse.consecutiveFailures;
  /** True once a snapshot (REST eager o evento SSE) ya pobló el board. */
  readonly hasSnapshot = this.kdsSse.hasSnapshot;

  /**
   * Restaurant Suite — business-day clearing of the KDS board.
   *
   * The board must show only the CURRENT business day's tickets and
   * reset when the clock crosses the store's `ticket_closing_hour`
   * (e.g. 3 AM). We mirror the backend's `getBusinessDate` logic EXACTLY
   * (Intl date formatting on a `now - closingHour` shifted instant, NO
   * timezone-instant math) so FE and BE agree on the same YYYY-MM-DD
   * boundary without offset drift.
   */
  private readonly closingHour = computed<number>(() => {
    const value = this.storeSettings.settings()?.operations?.ticket_closing_hour;
    return typeof value === 'number' && value >= 0 && value <= 23 ? value : 3;
  });

  private readonly timezone = computed<string>(
    () => this.storeSettings.settings()?.general?.timezone || 'America/Bogota',
  );

  /**
   * Current business date as 'YYYY-MM-DD'. Recomputed off the 1s `now`
   * tick so it flips the instant the clock crosses `closingHour`.
   * Formula matches backend `getBusinessDate`: shift the instant back by
   * `closingHour` hours, then format the wall-clock date in the store tz.
   */
  readonly currentBusinessDate = computed<string>(() => {
    const closingHour = this.closingHour();
    const tz = this.timezone();
    const shifted = new Date(this.now() - closingHour * 3_600_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(shifted);
  });

  /**
   * Tickets visible on the board: only those whose `business_date`
   * matches `currentBusinessDate`. Legacy tickets without a
   * `business_date` (null/absent) are KEPT so behavior is unchanged for
   * pre-migration data. Derived from the raw `tickets()` signal — the
   * source is never mutated.
   */
  readonly visibleTickets = computed<KitchenTicket[]>(() => {
    const businessDate = this.currentBusinessDate();
    // QUI-651 — el tablero es DE UNA ESTACION. Sin este filtro, un restaurante
    // con barra + cocina caliente + postres muestra los tres flujos mezclados en
    // cada pantalla y el personal filtra a mano, que es justo el problema que el
    // ticket resuelve.
    //
    // El filtro es cliente-side sobre el stream por tienda en vez de un endpoint
    // SSE por estacion: el backend ya empuja `ticket.created` de CADA estacion
    // (los N tickets del fire), asi que cada tablero recibe todo y descarta lo
    // ajeno. Cuesta ancho de banda y no correccion; partir el canal por estacion
    // es una optimizacion posterior que no cambia lo que ve el operador.
    const stationId = this.stationsService.selectedStationId();
    return this.tickets().filter((t) => {
      if (stationId != null && t.kds_id != null && t.kds_id !== stationId) {
        return false;
      }
      const raw = t.business_date;
      if (raw == null) return true; // legacy fallback: keep
      const prefix =
        raw instanceof Date
          ? raw.toISOString().slice(0, 10)
          : String(raw).slice(0, 10);
      return prefix === businessDate;
    });
  });

  readonly pendingTickets = computed(() =>
    this.visibleTickets().filter((t) => t.status === 'pending'),
  );
  readonly inPreparationTickets = computed(() =>
    this.visibleTickets().filter((t) => t.status === 'in_preparation'),
  );
  readonly readyTickets = computed(() =>
    this.visibleTickets().filter((t) => t.status === 'ready'),
  );
  /** Only delivered tickets — kept separate from cancelled (green column). */
  readonly deliveredTickets = computed(() =>
    this.visibleTickets().filter((t) => t.status === 'delivered'),
  );
  /** Only cancelled/voided tickets (red column). */
  readonly cancelledTickets = computed(() =>
    this.visibleTickets().filter((t) => t.status === 'cancelled'),
  );

  readonly columnCounts = computed<Record<KdsColumn, number>>(() => ({
    pending: this.pendingTickets().length,
    in_preparation: this.inPreparationTickets().length,
    ready: this.readyTickets().length,
    delivered: this.deliveredTickets().length,
    cancelled: this.cancelledTickets().length,
  }));

  /** Track which ticket ids are mid-mutation so cards can disable buttons. */
  readonly mutatingIds = signal<Set<number>>(new Set());

  /**
   * Baseline por ticket capturado al iniciar la mutación. El spinner se
   * mantiene hasta que el board recibe el evento SSE de ese ticket (su
   * `status`/`updated_at` cambia respecto al baseline) o hasta que vence
   * el fallback por timeout. Ver `runMutation` y el effect reconciliador.
   */
  private readonly mutationBaselines = new Map<
    number,
    { status: KitchenTicket['status']; updatedAt: string | null }
  >();
  /** Handles de los timeouts de seguridad por ticket (fallback SSE). */
  private readonly mutationTimeouts = new Map<
    number,
    ReturnType<typeof setTimeout>
  >();
  /** Tiempo máximo que el spinner espera al SSE antes de auto-liberarse. */
  private static readonly MUTATION_SSE_TIMEOUT_MS = 5_000;

  // ─── Restaurant Suite — Fase K Gap 4: detail modal state ───────
  /** id of the ticket currently shown in the detail modal (null = closed). */
  private readonly selectedTicketId = signal<number | null>(null);
  /**
   * Deep-link target (`?ticket=<kitchen_ticket_id>`) desde el detalle de
   * orden. El ticket puede no estar aún en `tickets()` al cargar (snapshot
   * en vuelo), así que guardamos el id y un effect abre el modal cuando ese
   * ticket aparece. Se limpia tras abrir.
   */
  private readonly pendingDeepLinkTicketId = signal<number | null>(null);
  readonly detailOpen = computed(() => this.selectedTicketId() != null);
  /**
   * Live ticket from the SSE-fed `tickets()` signal. Re-evaluates on
   * every ticket.* event so the modal updates in real time without
   * subscribing to the stream itself.
   */
  readonly detailTicket = computed<KitchenTicket | null>(() => {
    const id = this.selectedTicketId();
    if (id == null) return null;
    return this.tickets().find((t) => t.id === id) ?? null;
  });
  /** Whether the modal's selected ticket is mid-mutation. */
  readonly detailMutating = computed(() => {
    const id = this.selectedTicketId();
    return id != null && this.mutatingIds().has(id);
  });

  /** Open the detail modal for a given ticket. */
  openDetail(ticket: KitchenTicket): void {
    this.selectedTicketId.set(ticket.id);
  }

  /** Close the detail modal. */
  closeDetail(): void {
    this.selectedTicketId.set(null);
  }

  /**
   * Deep-link a la creación de receta del plato exacto que bloquea el
   * ticket (`recipes/new?product_id=…`). Emitido por la card y por el modal
   * de detalle cuando el operador pulsa "Crear receta" en un item sin receta.
   */
  onCreateRecipe(item: KitchenTicketItem): void {
    void this.router.navigate(['/admin/restaurant-ops/recipes/new'], {
      queryParams: { product_id: item.product_id },
    });
  }

  /**
   * Single shared 1s ticker pushed down to every card as `[now]`.
   * One timer for the whole board instead of one `setInterval` per card.
   */
  readonly now = signal(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Previous connection state, used by the reconnection effect to detect
   * the failure → open transition without firing on the initial connect.
   */
  private readonly prevState = signal<KdsConnectionState>('idle');

  /**
   * Previous business date, used by the rollover effect to detect the
   * day boundary crossing without firing on the very first run. `null`
   * means "not yet seeded".
   */
  private readonly prevBusinessDate = signal<string | null>(null);

  /** Connection indicator label + color for the header chip. */
  readonly connectionLabel = computed(() => {
    switch (this.connectionState()) {
      case 'idle':
        return 'Inactivo';
      case 'connecting':
        return 'Conectando…';
      case 'open':
        return 'En vivo';
      case 'reconnecting':
        return 'Reconectando…';
      case 'error':
        return 'Sin conexión';
      case 'closed':
        return 'Cerrado';
    }
  });

  readonly connectionVariant = computed<'success' | 'warning' | 'error' | 'neutral'>(() => {
    switch (this.connectionState()) {
      case 'open':
        return 'success';
      case 'connecting':
      case 'reconnecting':
        return 'warning';
      case 'error':
      case 'closed':
        return 'error';
      default:
        return 'neutral';
    }
  });

  /**
   * True while we are establishing the very first connection and have no
   * tickets yet — used to show a "Conectando a cocina…" loader instead of
   * a blank board with empty columns.
   */
  readonly isManualMode = computed(() => this.mode() === 'manual');

  readonly modeLabel = computed(() => this.isManualMode() ? 'Manual' : 'En vivo');

  readonly modeIcon = computed(() => this.isManualMode() ? 'wifi-off' : 'radio');

  readonly showInitialLoading = computed(() => {
    const s = this.connectionState();
    // Una vez que cualquier snapshot (REST eager o SSE) llegó, dejamos de
    // mostrar el loader aunque el resultado sea 0 tickets — si no, un board
    // legítimamente vacío con el SSE caído quedaría en "Conectando…" para
    // siempre. `hasSnapshot` es la señal definitiva de "ya sé qué mostrar".
    return (
      (s === 'idle' || s === 'connecting') &&
      this.tickets().length === 0 &&
      !this.hasSnapshot()
    );
  });

  constructor() {
    this.watchFullscreenChanges();

    // Toast when the stream recovers from a failure. We track the previous
    // state in a signal and only fire on (error|reconnecting) → open, never
    // on the initial idle/connecting → open handshake.
    effect(() => {
      const current = this.connectionState();
      // Read + write prevState OUTSIDE tracking so this effect only
      // re-runs when connectionState changes — never because of its own
      // write (which would otherwise loop).
      const previous = untracked(this.prevState);
      if (
        current === 'open' &&
        (previous === 'error' || previous === 'reconnecting')
      ) {
        this.toastService.success('Conexión restablecida', 'Cocina en vivo');
      }
      untracked(() => this.prevState.set(current));
    });

    // Reconciliador de mutaciones: observa `tickets()` y libera el
    // spinner de cada id pendiente cuando ese ticket cambia respecto al
    // baseline capturado en `beginMutation` (es decir, cuando llegó el
    // evento SSE). El fallback por timeout en `beginMutation` cubre el
    // caso de que el SSE nunca llegue. Resuelve la condición de carrera
    // del antiguo `next` optimista.
    effect(() => {
      const list = this.tickets();
      if (this.mutationBaselines.size === 0) return;
      untracked(() => {
        for (const [id, baseline] of this.mutationBaselines) {
          const ticket = list.find((t) => t.id === id);
          if (!ticket) continue; // aún no reconciliado
          const changed =
            ticket.status !== baseline.status ||
            this.normalizeTs(ticket.updated_at) !== baseline.updatedAt;
          if (changed) {
            this.finishMutation(id);
          }
        }
      });
    });

    // Day rollover: when `currentBusinessDate` flips (the clock crossed
    // the store's `ticket_closing_hour`), drop the previous day's
    // SSE-held tickets by re-snapshotting from the backend, which now
    // returns only the current business day. We DON'T fire on the very
    // first run (seeding `prevBusinessDate`), only on an actual change.
    effect(() => {
      const today = this.currentBusinessDate();
      const previous = untracked(this.prevBusinessDate);
      untracked(() => this.prevBusinessDate.set(today));
      if (previous === null) return; // skip initial seed
      if (previous === today) return; // no boundary crossed
      // Rebuild the in-memory set from the backend for the new day.
      this.kdsSse.refreshSnapshot(120).catch(() => {
        // Silencioso: el SSE/polling reconciliará en el siguiente evento.
      });
    });

    // Deep-link desde el detalle de orden (`?ticket=<id>`): abre el modal de
    // ese ticket en cuanto aparece en `tickets()` (cubre la carrera con el
    // snapshot en vuelo). Se limpia el target tras abrir para no reabrir.
    effect(() => {
      const targetId = this.pendingDeepLinkTicketId();
      if (targetId == null) return;
      const found = this.tickets().find((t) => t.id === targetId);
      if (!found) return;
      untracked(() => {
        this.openDetail(found);
        this.pendingDeepLinkTicketId.set(null);
      });
    });

    // QUI-XXX — HEARTBEAT.
    //
    // El board envía un heartbeat POST /kds-sessions/:id/heartbeat cada 60s
    // mientras hay una sesión abierta QUE ES NUESTRA. El servidor refresca
    // `last_seen_at` mientras esté fresca; cuando expira (>5min sin
    // actividad), el guard de mutación cierra la sesión silenciosamente y
    // libera la estación.
    //
    // NO envía heartbeat cuando la sesión la abrió otro operador: el caller
    // no es dueño y el backend rechazaría con KDS_STATION_LOCKED. En ese
    // estado el board queda en modo SOLO LECTURA y lo refleja la barra
    // con el badge "Reclamada por".
    //
    // El ciclo de vida del `setInterval` queda dentro del contexto del
    // effect: cuando la sesión cambia a null (cierre manual, lazy-expiry
    // o cambio de estación), `destroyRef` o el reseteo natural del effect
    // limpia el timer. No necesito cancelar manualmente.
    let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const session = this.stationsService.openSession();
      const mine = this.stationsService.sessionOpenedByMe();
      const kdsId = this.stationsService.selectedStationId();

      if (heartbeatHandle != null) {
        clearInterval(heartbeatHandle);
        heartbeatHandle = null;
      }

      if (session == null || mine !== true || kdsId == null) return;

      const sessionId = session.id;
      heartbeatHandle = setInterval(() => {
        this.stationsService
          .heartbeat(sessionId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            error: () => {
              // El heartbeat falla cuando la sesión se cerró entre un ciclo
              // y el siguiente (lazy expiry o cierre remoto). El próximo
              // `refreshOpenSession` desde el padre la verá null y la UI
              // bajará al estado "sin turno". No hace falta reintentar: el
              // error ya es señal de cierre.
            },
          });
      }, 60_000);
    });
  }

  ngOnInit(): void {
    // Pintura inicial inmediata vía REST `/snapshot` (la ruta que SÍ
    // funciona aunque el handshake del SSE falle): el board no debe quedar
    // vacío en "Conectando…" esperando el evento `snapshot` del stream. El
    // `connect()` abre el SSE en paralelo y, cuando llega su propio
    // snapshot/eventos, reconcilia por id. Catch silencioso: si el REST
    // falla, el SSE (o el botón Refrescar) cubre la carga.
    this.kdsSse.refreshSnapshot(120).catch(() => {
      /* el SSE/polling reconciliará */
    });
    this.kdsSse.connect(120);

    // QUI-651 — cargar estaciones y, si ya hay una elegida, su turno abierto.
    // `loadStations` autoselecciona cuando hay UNA sola activa, asi que el caso
    // comun entra directo al tablero sin pantalla intermedia.
    this.stationsService
      .loadStations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const id = this.stationsService.selectedStationId();
          if (id != null) this.refreshStationSession(id);
        },
        // Silencioso: sin estaciones el tablero sigue leyendose; lo que se cae es
        // la gestion, y de eso ya avisa el gate de turno con su propio mensaje.
        error: () => {},
      });

    this.tickHandle = setInterval(() => this.now.set(Date.now()), 1000);

    // Deep-link `?ticket=<kitchen_ticket_id>` desde el detalle de orden.
    const rawTicket = this.route.snapshot.queryParamMap.get('ticket');
    const ticketId = rawTicket ? Number(rawTicket) : NaN;
    if (Number.isFinite(ticketId)) {
      this.pendingDeepLinkTicketId.set(ticketId);
    }
  }

  ngOnDestroy(): void {
    this.kdsSse.disconnect();
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    // Limpia los timeouts de seguridad de mutaciones que quedaron en vuelo.
    for (const handle of this.mutationTimeouts.values()) {
      clearTimeout(handle);
    }
    this.mutationTimeouts.clear();
    this.mutationBaselines.clear();
  }

  /**
   * Refresca manualmente vía REST /snapshot sin tocar la conexión
   * SSE. Útil cuando mode==='manual' (no llega nada por SSE) o
   * cuando el operador quiere forzar sync.
   */
  forceRefresh(): void {
    this.kdsSse
      .refreshSnapshot(120)
      .then(() => {
        this.toastService.success('KDS sincronizado');
      })
      .catch((err: unknown) => {
        this.toastService.error(
          typeof err === 'string' ? err : 'Error al sincronizar el KDS',
        );
      });
  }

  refresh(): void {
    this.kdsSse.reset();
    this.kdsSse.connect(120);
  }

  /**
   * QUI-XXX — toma forzada del control de la estación cuando la sesión la
   * abrió otro operador y el caller es owner/admin/super_admin.
   *
   * Refleja la decisión de Nancy: la toma es EXPLÍCITA, nunca implícita en
   * una mutación de ticket. La razón es preservar el rastro de auditoría
   * (`force_taken_by_user_id` sobre la sesión cerrada): si la toma es
   * perezosa en `assertCanMutateStationTicket`, el caller la sufre sin ver
   * que está tomándole el turno a otro, y la sesión cerrada del dueño
   * anterior queda con la huella correcta — pero el comportamiento en la
   * UI queda raro. Hacerla explícita vía botón es más transparente.
   *
   * El backend cierra la sesión ajena y abre la nueva en una sola
   * transacción (`kds-sessions.service.forceTake`), el partial unique
   * `kds_sessions_one_open_per_kds` queda protegido. La señal
   * `openSession` queda apuntando a la sesión nueva vía el `tap` del
   * servicio.
   */
  onForceTake(): void {
    const stationId = this.stationsService.selectedStationId();
    if (stationId == null) return;

    this.stationsService
      .forceTake(stationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => {
          this.toastService.success(
            `Control de ${session.kds?.name ?? 'la estación'} transferido a tu usuario.`,
          );
        },
        error: (err: unknown) =>
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo tomar el control de la estación',
          ),
      });
  }

  onHeaderAction(id: string): void {
    // QUI-651 — acceso a la configuracion de estaciones y turnos. Sin esta
    // entrada la pantalla existe y nadie llega a ella.
    // QUI-651 — pantalla completa real: se oculta el layout entero (sidebar y
    // header incluidos) porque un KDS vive en una pantalla colgada en la cocina y
    // cada pixel de cromo administrativo es espacio que no muestra tickets.
    //
    // El detalle de COMO se hace vive en `toggleFullscreen`: el clic de este boton
    // es el gesto de usuario que la Fullscreen API exige, y por eso el toggle no
    // puede dispararse desde ningun otro lado (un efecto o un temporizador seria
    // rechazado por el navegador).
    if (id === 'fullscreen') {
      void this.toggleFullscreen();
      return;
    }
    // QUI-651 — cerrar el turno DESDE el tablero, que es donde esta el cocinero.
    // Obligarlo a navegar a configuracion para cerrar su propio turno seria absurdo,
    // y era el hueco que quedaba: la apertura estaba y el cierre no.
    if (id === 'close-session') {
      const session = this.stationsService.openSession();
      if (!session) return;
      this.stationsService
        .closeSession(session.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.toastService.success('Turno cerrado'),
          error: (err: unknown) =>
            this.toastService.error(
              typeof err === 'string' ? err : 'No se pudo cerrar el turno',
            ),
        });
      return;
    }
    if (id === 'refresh') {
      this.forceRefresh();
    } else if (id === 'reconnect') {
      // Reset duro: limpia el modo manual, resetea contadores y reconecta SSE.
      this.kdsSse.reset();
      this.kdsSse.connect(120);
    }
  }

  // ─── helpers for the template ──────────────────────────────────────

  ticketsForColumn(column: KdsColumn): KitchenTicket[] {
    switch (column) {
      case 'pending':
        return this.pendingTickets();
      case 'in_preparation':
        return this.inPreparationTickets();
      case 'ready':
        return this.readyTickets();
      case 'delivered':
        return this.deliveredTickets();
      case 'cancelled':
        return this.cancelledTickets();
    }
  }

  columnTitle(column: KdsColumn): string {
    switch (column) {
      case 'pending':
        return 'Pendientes';
      case 'in_preparation':
        return 'En preparación';
      case 'ready':
        return 'Listos';
      case 'delivered':
        return 'Entregados';
      case 'cancelled':
        return 'Cancelados';
    }
  }

  /**
   * Lucide icon per column/status — shown inside the solid header bar.
   * Pairs the status color with a semantic glyph so the kitchen reads the
   * column at a glance from across the line.
   */
  columnIcon(column: KdsColumn): string {
    switch (column) {
      case 'pending':
        return 'clock';
      case 'in_preparation':
        return 'flame';
      case 'ready':
        return 'circle-check';
      case 'delivered':
        return 'check-check';
      case 'cancelled':
        return 'circle-x';
    }
  }

  isMutating(id: number): boolean {
    return this.mutatingIds().has(id);
  }

  isReconnecting(): boolean {
    const s = this.connectionState();
    return s === 'reconnecting' || s === 'connecting';
  }

  // ─── ticket mutations ──────────────────────────────────────────────

  /**
   * QUI-655 — cocinar exige CONFIRMAR el ticket primero.
   *
   * El cocinero ve cada platillo con su receta y sus insumos, con lo que quien tomo
   * el pedido quito ya TACHADO, y puede quitar mas antes de empezar. El gate de
   * turno sigue aplicando: se evalua en `runMutation`, al confirmar.
   */
  startTicket(ticket: KitchenTicket): void {
    const orderItemIds = (ticket.items ?? [])
      .map((i) => i.order_item_id)
      .filter((id): id is number => typeof id === 'number');

    if (orderItemIds.length === 0) {
      // Sin items no hay receta que confirmar: se avanza directo en vez de abrir un
      // modal vacio.
      this.runMutation(ticket.id, () => this.ticketsService.start(ticket.id));
      return;
    }

    // Lo que ya venia excluido, indexado por order_item para sembrar el modal.
    const seed = new Map<number, number[]>();
    for (const item of ticket.items ?? []) {
      const ids = (item.exclusions ?? []).map((e) => e.component_product_id);
      if (ids.length > 0) seed.set(item.order_item_id, ids);
    }

    this.cookTicketId.set(ticket.id);
    this.cookSeed.set(seed);
    this.cookPreview.set(null);
    this.cookPreviewLoading.set(true);
    this.cookConfirmOpen.set(true);

    // Verificacion por TICKET: `/preview` filtra por "no consumido todavia" — una
    // condicion del envio — y al verificar el item ya paso por el fire, asi que el
    // modal llegaba vacio.
    this.ticketsService
      .getTicketVerification(ticket.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.cookPreview.set(preview);
          // La exclusion capturada viene EN la respuesta, asi que se siembra desde
          // ahi en vez de depender de que el payload del ticket la traiga.
          const seedFromApi = new Map<number, number[]>();
          for (const it of preview.items ?? []) {
            const ids = (it as any).excluded_component_ids ?? [];
            if (ids.length > 0) seedFromApi.set(it.order_item_id, ids);
          }
          if (seedFromApi.size > 0) this.cookSeed.set(seedFromApi);
          this.cookPreviewLoading.set(false);
        },
        error: () => {
          // Si no se pueden leer las recetas NO se avanza a ciegas: el punto del
          // modal es que nadie cocine sin ver que insumos se van a gastar.
          this.cookPreviewLoading.set(false);
          this.cookConfirmOpen.set(false);
          this.toastService.error('No se pudieron leer las recetas del ticket');
        },
      });
  }

  /** Estado del modal de confirmacion de cocina en el tablero. */
  readonly cookConfirmOpen = signal(false);
  readonly cookPreview = signal<FirePreview | null>(null);
  readonly cookPreviewLoading = signal(false);
  readonly cookSeed = signal<Map<number, number[]> | null>(null);
  private readonly cookTicketId = signal<number | null>(null);

  onCookConfirmed(exclusions: FireItemExclusion[]): void {
    const ticketId = this.cookTicketId();
    this.cookConfirmOpen.set(false);
    if (ticketId == null) return;
    // NOTA: hoy el inventario ya se consumio en el fire, asi que estas exclusiones
    // aun no cambian el descuento — se registran y se muestran. Mover el consumo a
    // este punto es la fase siguiente, y este confirm es su disparador.
    this.runMutation(ticketId, () => this.ticketsService.start(ticketId));
    this.cookTicketId.set(null);
  }

  /** Pestañas del sticky header. El tablero y su configuración son secciones del
   * mismo módulo, no destinos sueltos: como pestañas el operador ve que existe la
   * configuración sin tener que descubrir un botón. */
  readonly headerTabs = [
    { id: 'board', label: 'Comandas', icon: 'flame', route: '/admin/restaurant-ops/kds', exact: true },
    { id: 'config', label: 'Configuración', icon: 'chef-hat', route: '/admin/restaurant-ops/kds/configuracion' },
  ];

  // ------------------------------------------------------- pantalla completa
  /**
   * PANTALLA COMPLETA DEL KDS.
   *
   * Usa la Fullscreen API sobre el elemento del tablero, no una clase que colapse
   * el layout. Tres razones concretas:
   *
   *  1. El navegador promueve el elemento al TOP LAYER: queda por encima del
   *     documento entero e ignora por definicion el `overflow`, el `z-index` y los
   *     bloques contenedores de sus ancestros. La alternativa (`position: fixed`)
   *     funciona hoy solo porque ningun ancestro tiene `transform`, `filter` ni
   *     `contain`; el dia que alguien le ponga un `backdrop-filter` al layout, el
   *     `fixed` se ancla ahi y el tablero sale recortado SIN error de consola.
   *  2. NO mueve el DOM. Portar el tablero a un `<dialog>` via `ng-template` lo
   *     desmontaria y remontaria, y este tablero vive de un stream SSE: cada
   *     toggle reconectaria la cocina.
   *  3. Da el 100% de la PANTALLA, no del viewport — en una pantalla de cocina
   *     tambien desaparece la barra del navegador.
   *
   * Respaldo: si `requestFullscreen()` es rechazado (webview embebida, permiso
   * denegado por politica) se cae a `position: fixed`, que es lo mejor disponible
   * sin la API.
   */
  readonly isFullscreen = signal(false);
  /** Respaldo activo: la API fue rechazada y se posiciona con `fixed`. */
  readonly fixedFallback = signal(false);

  private readonly boardRoot =
    viewChild.required<ElementRef<HTMLElement>>('boardRoot');

  /**
   * Salida desde la barra de turno. Existe porque en pantalla completa el sticky
   * header no se dibuja, y con él desaparece el botón por el que se entró: la
   * barra pasa a ser el único control visible. El clic sigue siendo un gesto de
   * usuario, que es lo que la Fullscreen API exige.
   */
  exitFullscreen(): void {
    void this.toggleFullscreen();
  }

  private async toggleFullscreen(): Promise<void> {
    if (this.isFullscreen()) {
      // Salir por el mismo camino por el que se entro.
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      } else {
        this.fixedFallback.set(false);
        this.isFullscreen.set(false);
        this.applyBackdropLock(false);
      }
      return;
    }

    try {
      await this.boardRoot().nativeElement.requestFullscreen({
        navigationUI: 'hide',
      });
      // `isFullscreen` NO se setea aqui: lo hace el listener de
      // `fullscreenchange`, que es la unica fuente que tambien cubre el Esc.
    } catch {
      this.fixedFallback.set(true);
      this.isFullscreen.set(true);
      this.applyBackdropLock(true);
    }
  }

  /**
   * Solo para el respaldo `fixed`: sin esto el fondo sigue haciendo scroll detras
   * del tablero y el dock de Vexi tapa una columna de tickets. En modo top layer
   * no hace falta — el layout entero queda debajo de la capa superior.
   */
  private applyBackdropLock(on: boolean): void {
    document.body.classList.toggle('kds-fullscreen', on);
  }

  /**
   * El Esc del navegador sale de pantalla completa sin pasar por nuestro boton.
   * Sin escuchar `fullscreenchange` la señal se queda en `true` y el boton miente:
   * dice "Salir de pantalla completa" cuando ya se salio.
   */
  private watchFullscreenChanges(): void {
    const onChange = () => {
      const active = document.fullscreenElement === this.boardRoot().nativeElement;
      this.isFullscreen.set(active || this.fixedFallback());
    };
    document.addEventListener('fullscreenchange', onChange);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('fullscreenchange', onChange);
      // Salir del modulo con la clase puesta dejaria el resto del panel sin
      // scroll y sin Vexi.
      this.applyBackdropLock(false);
    });
  }

  // ---------------------------------------------------- resumen del turno
  readonly sessionSummaryOpen = signal(false);
  readonly sessionSummary = signal<KdsConsumptionSummary | null>(null);
  readonly sessionHistory = signal<KdsConsumptionHistoryRow[]>([]);
  /**
   * Movimientos sin sesión atribuida (QUI-760). Antes del backfill crecían
   * silenciosamente y nadie se enteraba; ahora se imputan al abrir sesión, pero
   * las ocurrencias previas a la primera apertura siguen sin dueño. La UI las
   * muestra separadas del resumen del turno, no dentro: el turno del operador
   * es una cosa, los movimientos que nadie firmó son otra.
   */
  readonly unattributed = signal<KdsUnattributedConsumption | null>(null);
  readonly loadingUnattributed = signal(false);
  readonly loadingSessionSummary = signal(false);

  /**
   * Abre el resumen del turno ACTUAL en un modal.
   *
   * Antes mandaba a la pantalla de configuración: sacar al cocinero del tablero para
   * ver su propio turno es perder el contexto de la cocina justo cuando la está
   * operando.
   */
  openSessionSummary(): void {
    const session = this.stationsService.openSession();
    if (!session) return;

    this.sessionSummaryOpen.set(true);
    this.loadingSessionSummary.set(true);
    this.sessionSummary.set(null);
    this.sessionHistory.set([]);
    this.unattributed.set(null);
    this.loadingUnattributed.set(true);

    this.stationsService
      .getConsumptionSummary(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sum) => {
          this.sessionSummary.set(sum);
          this.loadingSessionSummary.set(false);
        },
        error: () => this.loadingSessionSummary.set(false),

    this.sessionSummaryOpen.set(true);
    this.loadingSessionSummary.set(true);
    this.sessionSummary.set(null);
    this.sessionHistory.set([]);
    this.unattributed.set(null);
    this.loadingUnattributed.set(true);

    this.stationsService
      .getConsumptionSummary(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sum) => {
          this.sessionSummary.set(sum);
          this.loadingSessionSummary.set(false);
        },
        error: () => this.loadingSessionSummary.set(false),
      });

    this.stationsService
      .getConsumptionHistory(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.sessionHistory.set(rows),
        error: () => {},
      });

    // QUI-760 — el reporte de movimientos sin sesión atribuida se muestra
    // junto al resumen del turno para que el cocinero vea si quedó consumo
    // "huérfano" (de fires ocurridos antes de abrir sesión).
    this.stationsService
      .getUnattributedConsumption()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          this.unattributed.set(u);
          this.loadingUnattributed.set(false);
        },
        error: () => this.loadingUnattributed.set(false),
      });
  }

  closeSessionSummary(): void {
    this.sessionSummaryOpen.set(false);
    // Limpia los signals: si el cocinero vuelve a abrir el modal en el
    // mismo turno, no debe ver datos del fetch anterior.
    this.sessionSummary.set(null);
    this.sessionHistory.set([]);
    this.unattributed.set(null);
    this.loadingSessionSummary.set(false);
    this.loadingUnattributed.set(false);
  }

  onCookCancelled(): void {
    this.cookConfirmOpen.set(false);
    this.cookPreview.set(null);
    this.cookTicketId.set(null);
  }

  markTicketReady(ticket: KitchenTicket): void {
    this.runMutation(ticket.id, () => this.ticketsService.markReady(ticket.id));
  }

  markTicketDelivered(ticket: KitchenTicket): void {
    this.runMutation(ticket.id, () =>
      this.ticketsService.markDelivered(ticket.id),
    );
  }

  cancelTicket(ticket: KitchenTicket): void {
    this.dialogService
      .confirm({
        title: 'Cancelar ticket',
        message: `¿Cancelar el ticket #${ticket.id}? Esta acción no se puede deshacer.`,
        confirmText: 'Cancelar ticket',
        cancelText: 'Volver',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.runMutation(ticket.id, () =>
          this.ticketsService.cancel(ticket.id),
        );
      });
  }

  /**
   * Revierte el ticket al paso anterior (solo se invoca desde el modal
   * de detalle). Pide confirmación, igual que `cancelTicket`, y delega
   * en `KitchenTicketsService.revert`. El estado destino lo resuelve el
   * backend y el board lo reconcilia vía el evento SSE `ticket.reverted`.
   */
  revertTicket(ticket: KitchenTicket): void {
    this.dialogService
      .confirm({
        title: 'Volver al paso anterior',
        message: `¿Revertir el ticket #${ticket.id} al estado anterior?`,
        confirmText: 'Volver al paso anterior',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.runMutation(ticket.id, () =>
          this.ticketsService.revert(ticket.id),
        );
      });
  }

  /**
   * Ejecuta una mutación de ticket y mantiene el spinner activo hasta
   * que el board CONFIRME el cambio por SSE (anti condición de carrera).
   *
   * Estrategia (ver `mutationBaselines` + el effect reconciliador del
   * constructor): antes de mutar capturamos un baseline del ticket
   * (`status` + `updated_at`). En el `next` del HTTP NO limpiamos el
   * spinner de inmediato (el viejo comportamiento optimista creaba una
   * carrera: el id se liberaba antes de que el evento SSE reconciliara
   * el estado, dejando que la card mostrara el estado viejo por un
   * instante o que un segundo click disparara una transición inválida).
   * En su lugar:
   *  - dejamos el id en `mutatingIds`;
   *  - un único `effect` observa `tickets()` y libera el id cuando ese
   *    ticket cambia respecto al baseline (status distinto o updated_at
   *    posterior) — es decir, cuando llegó el SSE;
   *  - un `setTimeout` de seguridad (5s) libera el id igualmente si el
   *    SSE nunca llega, para no dejar el spinner colgado.
   * En `error` limpiamos el id + toast (como antes).
   */
  /**
   * Abre el turno de la estacion y REINTENTA la accion que disparo el gate.
   *
   * Reintentar importa: sin esto el operador abre el turno y su clic original se
   * perdio, asi que tiene que volver a buscar el ticket en el tablero. El
   * reintento se resuelve por id y no guardando el observable, porque el estado
   * del ticket pudo cambiar por SSE mientras el modal estaba abierto.
   */
  confirmOpenSession(): void {
    const kdsId = this.stationsService.selectedStationId();
    if (kdsId == null) return;

    this.openingSession.set(true);
    this.stationsService
      .openSessionFor(kdsId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.openingSession.set(false);
          this.sessionGateOpen.set(false);
          const pending = this.sessionGatePending();
          this.sessionGatePending.set(null);
          this.toastService.success('Turno abierto');
          if (pending != null) {
            const ticket = this.tickets().find((t) => t.id === pending);
            // Se re-deriva la accion del estado ACTUAL del ticket: entre el gate y
            // la apertura, el SSE pudo haberlo movido.
            if (ticket) this.advanceTicket(ticket);
          }
        },
        error: (err: unknown) => {
          this.openingSession.set(false);
          // KDS_SESSION_ALREADY_OPEN cuando otro operador reclamo la estacion
          // primero. El mensaje del backend ya lo dice; se muestra tal cual.
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo abrir el turno',
          );
        },
      });
  }

  /**
   * Elegir estacion. Recarga el turno de la elegida: el gate depende de esa
   * lectura, y arrastrar el turno de la estacion anterior dejaria gestionar
   * tickets de una estacion con la sesion de otra.
   */
  selectStation(kdsId: number): void {
    this.stationsService.selectedStationId.set(kdsId);
    this.stationsService.openSession.set(null);
    this.refreshStationSession(kdsId);
  }

  private refreshStationSession(kdsId: number): void {
    this.stationsService
      .refreshOpenSession(kdsId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => {} });
  }

  /**
   * El control "Cambiar estación" se habilita solo con 2+ estaciones
   * activas Y sin turno abierto en esta. La señal vive aquí (no en el
   * servicio) porque es composición de dos hechos públicos.
   */
  readonly canChangeStation = computed<boolean>(
    () =>
      this.stationsService.needsStationChoice() &&
      this.stationsService.openSession() == null,
  );
  /**
   * Con 2+ estaciones pero turno abierto, el control sigue visible pero
   * deshabilitado y muestra el motivo. El cierre de turno es un acto
   * propio del operador porque de esa sesión cuelga el consumo firmado
   * del fire con su costo — el control de cambio de estación NUNCA cierra
   * el turno por su cuenta.
   */
  readonly changeBlockedReason = computed<string | null>(() => {
    if (
      this.stationsService.needsStationChoice() &&
      this.stationsService.openSession() != null
    ) {
      return 'Cierra el turno para cambiar de estación';
    }
    return null;
  });

  /**
   * QUI-739 — volver al selector de estación. Resetea `selectedStationId` a
   * null en el servicio para que el `@if (needsStationChoice() &&
   * selectedStationId() === null)` del template vuelva a cumplirse y el
   * picker reaparezca.
   *
   * Solo se invoca cuando el botón está habilitado, o sea con turno
   * cerrado. No cierra el turno (no hay turno abierto en este camino) y
   * no toca el servidor más allá del reset.
   *
   * Restricción sobre el SSE: el stream es de tienda (no de estación),
   * así que la suscripción NO se desmonta al pasar por null. `visibleTickets`
   * se re-evalúa cuando `selectedStationId` cambia y filtra por la nueva
   * estación al elegirla. Sin estación seleccionada se renderiza el
   * picker y no hay columnas de tickets en pantalla.
   */
  onChangeStation(): void {
    this.stationsService.clearStation();
  }

  cancelOpenSession(): void {
    this.sessionGateOpen.set(false);
    this.sessionGatePending.set(null);
  }

  /**
   * Avanza el ticket al siguiente estado segun donde este. Se usa para el
   * reintento post-apertura de turno, donde solo se conserva el id.
   */
  private advanceTicket(ticket: KitchenTicket): void {
    if (ticket.status === 'pending') {
      this.runMutation(ticket.id, () => this.ticketsService.start(ticket.id));
    } else if (ticket.status === 'in_preparation') {
      this.runMutation(ticket.id, () =>
        this.ticketsService.markReady(ticket.id),
      );
    }
    // `ready` no se avanza automaticamente: entregar es una decision de servicio
    // y la toma el operador desde su boton, no un reintento silencioso.
  }

  private runMutation(
    ticketId: number,
    obsFactory: () => import('rxjs').Observable<KitchenTicket>,
  ): void {
    // ------------------------------------------------------------- QUI-651
    // GATE DE TURNO. Este es el embudo unico de TODAS las mutaciones de ticket
    // (start, ready, delivered, cancel), asi que la guarda va aca y no en cada
    // handler: poner el chequeo en los cinco handlers deja el hueco abierto en el
    // sexto que alguien agregue.
    //
    // Convencion de caja, que el ticket pide respetar: la sesion se exige AL
    // ACTUAR, no al entrar. El tablero se LEE sin turno abierto — leer no genera
    // dato que necesite dueno — pero gestionar un ticket consume inventario y
    // genera COGS, y eso necesita un responsable.
    //
    // Y no muta NADA hasta que el turno se abra: se pide apertura y se corta.
    if (!this.stationsService.canManageTickets()) {
      this.sessionGatePending.set(ticketId);
      this.sessionGateOpen.set(true);
      return;
    }
    this.beginMutation(ticketId);
    obsFactory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // No limpiamos aquí: dejamos que el effect reconcilie contra
          // el evento SSE (con fallback por timeout). Esto evita la
          // carrera HTTP-next vs SSE-event.
        },
        error: (err: unknown) => {
          this.finishMutation(ticketId);
          this.onMutationError(err);
        },
      });
  }

  /**
   * Surfaces a failed ticket mutation. Most errors become a toast, but the
   * backend's `KITCHEN_TICKET_NO_RECIPE` (422) — raised when "Cocinarlo" is
   * pressed on a dish without an active recipe — gets an actionable dialog
   * (CTA a Recetas) instead of failing silently.
   *
   * Restaurant Suite — Fase K audit jun-2026: ALL other specific error
   * codes (NOT_READY, ALREADY_DELIVERED, ALREADY_CANCELLED,
   * ALREADY_IN_PREPARATION, ALREADY_READY) are mapped through
   * `parseApiError` → `ERROR_MESSAGES` so the operator sees an actionable
   * Spanish message ("Este plato ya fue marcado como entregado", "No se
   * puede marcar como entregado: el plato aún está pendiente…") instead of
   * the generic devMessage. Unknown errors fall back to a plain toast.
   */
  private onMutationError(err: unknown): void {
    const structured =
      typeof err === 'object' && err !== null
        ? (err as Partial<KitchenMutationError>)
        : null;
    if (structured?.code === 'KITCHEN_TICKET_NO_RECIPE') {
      this.showNoRecipeDialog();
      return;
    }
    if (structured?.code) {
      const { userMessage } = parseApiError({
        error: { error_code: structured.code },
      });
      this.toastService.error(
        withApiErrorReference(userMessage, readApiErrorRequestId(err)),
      );
      return;
    }
    const message =
      typeof err === 'string'
        ? err
        : (structured?.message ?? 'Error al actualizar el ticket');
    this.toastService.error(
      withApiErrorReference(message, readApiErrorRequestId(err)),
    );
  }

  /**
   * Diálogo para `KITCHEN_TICKET_NO_RECIPE`: explica por qué el plato no se
   * puede enviar a preparación y ofrece un CTA al módulo de Recetas para que
   * el operador adjunte una receta activa y reintente.
   */
  private showNoRecipeDialog(): void {
    this.dialogService
      .confirm({
        title: 'Falta la receta',
        message:
          'Este plato no tiene una receta activa, por eso no se puede enviar ' +
          'a preparación: la cocina no sabría qué preparar ni qué insumos ' +
          'descontar. Crea o activa una receta para el plato y vuelve a ' +
          'intentarlo.',
        confirmText: 'Ir a recetas',
        cancelText: 'Cerrar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        void this.router.navigate(['/admin/restaurant-ops/recipes']);
      });
  }

  /**
   * Marca el id como "pendiente de confirmación SSE": captura el
   * baseline, lo añade a `mutatingIds` y arma el timeout de seguridad.
   */
  private beginMutation(ticketId: number): void {
    const current = this.tickets().find((t) => t.id === ticketId);
    this.mutationBaselines.set(ticketId, {
      status: current?.status ?? 'pending',
      updatedAt: this.normalizeTs(current?.updated_at),
    });
    this.addMutating(ticketId);
    // Fallback: si el SSE nunca llega, liberamos el id igualmente.
    this.clearMutationTimeout(ticketId);
    this.mutationTimeouts.set(
      ticketId,
      setTimeout(
        () => this.finishMutation(ticketId),
        KdsBoardPageComponent.MUTATION_SSE_TIMEOUT_MS,
      ),
    );
  }

  /**
   * Libera el id (spinner off) y limpia su baseline + timeout. Es
   * idempotente: lo llaman tanto el effect reconciliador como el
   * timeout y el handler de error.
   */
  private finishMutation(ticketId: number): void {
    if (!this.mutationBaselines.has(ticketId) && !this.isMutating(ticketId)) {
      return;
    }
    this.clearMutationTimeout(ticketId);
    this.mutationBaselines.delete(ticketId);
    this.removeMutating(ticketId);
  }

  private clearMutationTimeout(ticketId: number): void {
    const handle = this.mutationTimeouts.get(ticketId);
    if (handle) {
      clearTimeout(handle);
      this.mutationTimeouts.delete(ticketId);
    }
  }

  /** Normaliza updated_at (Date | string | null) a un string comparable. */
  private normalizeTs(value: string | Date | null | undefined): string | null {
    if (value == null) return null;
    return value instanceof Date ? value.toISOString() : String(value);
  }

  private addMutating(id: number): void {
    this.mutatingIds.update((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

  private removeMutating(id: number): void {
    this.mutatingIds.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  trackByTicketId(_index: number, ticket: KitchenTicket): number {
    return ticket.id;
  }
}

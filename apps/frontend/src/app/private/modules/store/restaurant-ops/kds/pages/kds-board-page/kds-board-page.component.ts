import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
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
import {
  KdsConnectionState,
  KdsSseService,
  KitchenMutationError,
  KitchenTicketsService,
} from '../../services';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
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
  ],
  templateUrl: './kds-board-page.component.html',
  styleUrl: './kds-board-page.component.scss',
})
export class KdsBoardPageComponent implements OnInit, OnDestroy {
  private readonly kdsSse = inject(KdsSseService);
  private readonly ticketsService = inject(KitchenTicketsService);
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
    return this.tickets().filter((t) => {
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

  onHeaderAction(id: string): void {
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

  startTicket(ticket: KitchenTicket): void {
    this.runMutation(ticket.id, () => this.ticketsService.start(ticket.id));
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
  private runMutation(
    ticketId: number,
    obsFactory: () => import('rxjs').Observable<KitchenTicket>,
  ): void {
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
      this.toastService.error(userMessage);
      return;
    }
    const message =
      typeof err === 'string'
        ? err
        : (structured?.message ?? 'Error al actualizar el ticket');
    this.toastService.error(message);
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

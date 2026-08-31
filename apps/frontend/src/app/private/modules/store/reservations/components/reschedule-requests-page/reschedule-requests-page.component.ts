import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ReservationsService,
  RescheduleRequest,
} from '../../services/reservations.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import {
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { StickyHeaderTab } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';

interface RescheduleStats {
  by_status: { pending: number; approved: number; rejected: number; cancelled: number; total: number };
  approved_last_24h: number;
  rejected_last_24h: number;
  approved_this_week: number;
  avg_response_minutes: number | null;
  pending_over_1h: number;
}

interface RejectModalState {
  open: boolean;
  request: RescheduleRequest | null;
  reason: string;
  submitting: boolean;
}

/**
 * RescheduleRequestsPageComponent
 *
 * Dedicated view for the pending-reschedule-requests queue. Reached from
 * `/admin/reservations/reschedule-requests` (click on the header button
 * in the parent module). Same data and actions as the inline panel,
 * but rendered as a full-width page with the standard sticky header
 * + back button — same UX pattern as the
 * `<app-provider-availability>` "Disponibilidad" view.
 */
@Component({
  selector: 'app-reschedule-requests-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    StickyHeaderComponent,
    RouterLink,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
  ],
  providers: [DatePipe],
  templateUrl: './reschedule-requests-page.component.html',
  styleUrls: ['./reschedule-requests-page.component.scss'],
})
export class RescheduleRequestsPageComponent implements OnInit {
  private readonly reservationsService = inject(ReservationsService);
  private readonly toast_service = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  readonly requests = signal<RescheduleRequest[]>([]);
  readonly stats = signal<RescheduleStats | null>(null);
  readonly loading = signal(false);
  readonly processing = signal<number | null>(null);

  // Table filter — drives the `list` call + status tab buttons. The
  // default is "all" so the operator can see the historical backlog on
  // first load; they explicitly opt into a status focus.
  readonly statusFilter = signal<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('all');
  /** Free-text search across customer name, email, booking number. */
  readonly searchTerm = signal('');

  readonly rejectModal = signal<RejectModalState>({
    open: false,
    request: null,
    reason: '',
    submitting: false,
  });

  /** Header badge mirrors the pending count from stats (live). */
  readonly badgeText = computed(() => {
    const s = this.stats();
    if (!s || s.by_status.pending === 0) return 'Sincronizado';
    return `${s.by_status.pending} pendiente${s.by_status.pending === 1 ? '' : 's'}`;
  });
  readonly badgeColor = computed<StickyHeaderBadgeColor>(() => {
    const s = this.stats();
    return s && s.by_status.pending > 0 ? 'yellow' : 'green';
  });

  /** Header action — single back button (mirrors provider-availability). */
  readonly headerActions: StickyHeaderActionButton[] = [
    {
      id: 'back',
      label: 'Reservas',
      variant: 'outline',
      icon: 'arrow-left',
    },
  ];

  /**
   * Sticky-header tabs — drives the status filter. Same pattern as
   * Resumen de Ventas (Por Producto / Por Cliente / etc. in the reports
   * module). Rendered inline in the sticky header so the chrome stays
   * consistent with the rest of the admin.
   */
  readonly headerTabs: StickyHeaderTab[] = [
    { id: 'all', label: 'Todas', icon: 'list' },
    { id: 'pending', label: 'Pendientes', icon: 'inbox' },
    { id: 'approved', label: 'Aprobadas', icon: 'check-circle' },
    { id: 'rejected', label: 'Rechazadas', icon: 'x-circle' },
    { id: 'cancelled', label: 'Canceladas', icon: 'rotate-ccw' },
  ];

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.load();
    this.loadStats();
    // 30s polling — same cadence as the inline panel so the page stays
    // in sync with new requests filed by customers.
    this.pollHandle = setInterval(() => {
      this.load();
      this.loadStats();
    }, 30_000);
  }

  ngOnDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  /** Sticky header action router — back to the reservations module. */
  onHeaderAction(id: string): void {
    if (id === 'back') this.goBack();
  }

  goBack(): void {
    this.router.navigate(['/admin/reservations']);
  }

  load() {
    this.loading.set(true);
    const status = this.statusFilter();
    this.reservationsService
      .listRescheduleRequests(status === 'all' ? undefined : status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          // Client-side filter on searchTerm — backend doesn't have a
          // search param yet, but for ~hundreds of pending requests this
          // is fast enough and keeps the search reactive as the user types.
          const term = this.searchTerm().toLowerCase().trim();
          const filtered = term
            ? (rows ?? []).filter((r) => this.matchesSearch(r, term))
            : rows ?? [];
          this.requests.set(filtered);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast_service.error('No se pudieron cargar las solicitudes');
        },
      });
  }

  /**
   * Search matcher — matches against customer name, email, phone, and
   * booking number. All comparisons are case-insensitive substring
   * (the backend already lower-cased the term).
   */
  private matchesSearch(r: RescheduleRequest, term: string): boolean {
    const c = r.booking.customer;
    const fields = [
      c.first_name,
      c.last_name,
      c.email,
      c.phone,
      r.booking.booking_number,
    ];
    return fields.some(
      (v) => typeof v === 'string' && v.toLowerCase().includes(term),
    );
  }

  /** Search input handler — debounced via `[debounceTime]="400"` in template. */
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.load();
  }

  /** Manual refresh button (same pattern as Productos). */
  refresh(): void {
    this.load();
    this.loadStats();
  }

  /**
   * OptionsDropdown — Acciones only (los filtros se manejan en los
   * tabs del sticky-header y el search input). "Actualizar" recarga
   * manualmente. "Exportar CSV" queda disabled hasta que lo implementemos.
   */
  readonly dropdownActions: any[] = [
    { id: 'refresh', label: 'Actualizar', icon: 'rotate-cw' },
    { id: 'export', label: 'Exportar CSV', icon: 'download', disabled: true },
  ];

  onActionClick(actionId: string): void {
    if (actionId === 'refresh') this.refresh();
  }

  loadStats() {
    this.reservationsService
      .getRescheduleRequestsStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.stats.set(s),
        error: () => {/* silent — cards keep last-known values */},
      });
  }

  /** Status tab change → re-fetch with the new filter. */
  setStatusFilter(status: 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled') {
    this.statusFilter.set(status);
    this.load();
  }

  /**
   * Sticky-header tab click handler — receives the tab id from the
   * shared header component and routes to setStatusFilter.
   */
  onTabChange(tabId: string): void {
    this.setStatusFilter(tabId as 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled');
  }

  /**
   * Table columns for `<app-responsive-data-view>`. The data is a
   * `RescheduleRequest[]` (raw API row), so each `transform` projects
   * the nested fields the column needs. `priority` controls responsive
   * collapse (P1 = always visible, P2 = visible on ≥md, etc).
   */
  readonly tableColumns: TableColumn[] = [
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '120px',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#f59e0b',
          approved: '#10b981',
          rejected: '#ef4444',
          cancelled: '#9ca3af',
        },
      },
    },
    {
      key: 'customer',
      label: 'Cliente',
      sortable: false,
      width: '220px',
      priority: 1,
      transform: (row: RescheduleRequest) => this.fullName(row),
    },
    {
      key: 'slot',
      label: 'Actual → Solicitado',
      sortable: false,
      width: '280px',
      priority: 1,
      transform: (row: RescheduleRequest) =>
        `${this.formatOriginalSlot(row)} → ${this.formatRequestedSlot(row)}`,
    },
    {
      key: 'booking_number',
      label: 'Reserva',
      sortable: false,
      width: '150px',
      priority: 2,
      transform: (row: RescheduleRequest) => `#${row.booking.booking_number}`,
    },
    {
      key: 'decision',
      label: 'Decisión',
      sortable: false,
      width: '180px',
      priority: 3,
      transform: (row: RescheduleRequest) => row.decision_reason ?? '—',
    },
    {
      key: 'requested_at',
      label: 'Solicitado',
      sortable: true,
      width: '140px',
      align: 'right',
      priority: 2,
      transform: (row: RescheduleRequest) =>
        new Date(row.requested_at).toLocaleString('es-ES', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
  ];

  /**
   * Row actions. `show: (row) => row.status === 'pending'` makes the
   * buttons only render for PENDING rows. For decided rows, no action
   * shows up — the cell stays empty. The `label`/`icon`/`variant`
   * callbacks are evaluated per row by the responsive-data-view.
   */
  readonly tableActions: TableAction[] = [
    {
      label: 'Aprobar',
      icon: 'check',
      variant: 'primary',
      show: (row: RescheduleRequest) => row.status === 'pending',
      action: (row: RescheduleRequest) => this.approve(row),
    },
    {
      label: 'Rechazar',
      icon: 'x',
      variant: 'danger',
      show: (row: RescheduleRequest) => row.status === 'pending',
      action: (row: RescheduleRequest) => this.openRejectModal(row),
    },
  ];

  /**
   * Card config (mobile) — how each row collapses to a card on narrow
   * screens. The card title is the customer name; subtitle shows the
   * slot change. Same pattern as the Proveedores table.
   */
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'customer',
    subtitleKey: 'slot',
  };

  approve(req: RescheduleRequest) {
    this.processing.set(req.id);
    this.reservationsService
      .approveRescheduleRequest(req.id, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success(
            `Solicitud de ${req.booking.customer.first_name} aprobada`,
          );
          this.processing.set(null);
          this.load();
        },
        error: (err) => {
          this.processing.set(null);
          const msg = err?.error?.message ?? 'No se pudo aprobar la solicitud';
          this.toast_service.error(msg);
        },
      });
  }

  openRejectModal(req: RescheduleRequest) {
    this.rejectModal.set({ open: true, request: req, reason: '', submitting: false });
  }

  closeRejectModal() {
    this.rejectModal.set({
      ...this.rejectModal(),
      open: false,
      request: null,
      reason: '',
    });
  }

  updateRejectReason(reason: string): void {
    this.rejectModal.set({ ...this.rejectModal(), reason });
  }

  submitReject() {
    const state = this.rejectModal();
    const req = state.request;
    if (!req) return;
    if (state.reason.trim().length < 3) {
      this.toast_service.error('La razón debe tener al menos 3 caracteres');
      return;
    }
    this.rejectModal.set({ ...state, submitting: true });
    this.reservationsService
      .rejectRescheduleRequest(req.id, { decision_reason: state.reason.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.success('Solicitud rechazada');
          this.closeRejectModal();
          this.load();
        },
        error: (err) => {
          this.rejectModal.set({ ...this.rejectModal(), submitting: false });
          const msg = err?.error?.message ?? 'No se pudo rechazar la solicitud';
          this.toast_service.error(msg);
        },
      });
  }

  formatRequestedSlot(req: RescheduleRequest): string {
    const date = this.formatDateShort(req.requested_date);
    return `${date} · ${req.requested_start_time}–${req.requested_end_time}`;
  }

  formatOriginalSlot(req: RescheduleRequest): string {
    const date = this.formatDateShort(req.booking.date);
    return `${date} · ${req.booking.start_time}–${req.booking.end_time}`;
  }

  /**
   * Project a row to the table shape. Centralised so the transforms in
   * `tableColumns` stay pure render logic.
   */
  toTableRow = (req: RescheduleRequest) => ({
    status: req.status,
    customer: this.fullName(req),
    slot: `${this.formatOriginalSlot(req)} → ${this.formatRequestedSlot(req)}`,
    booking_number: req.booking.booking_number,
    decision: req.decision_reason ?? '—',
    requested_at: req.requested_at,
    _raw: req,
  });

  private formatDateShort(isoDate: string): string {
    try {
      const [y, m, d] = isoDate.split('T')[0].split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('es-ES', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      });
    } catch {
      return isoDate;
    }
  }

  fullName(req: RescheduleRequest): string {
    const c = req.booking.customer;
    return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Cliente';
  }

  /**
   * Status label translation — the backend stores raw enum values
   * (pending/approved/rejected/cancelled) in lowercase English. We map
   * them to user-facing Spanish for the pill + status message.
   */
  statusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobada',
      rejected: 'Rechazada',
      cancelled: 'Cancelada',
    };
    return map[status] ?? status;
  }
}
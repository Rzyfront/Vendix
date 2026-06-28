import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { PqrAdminService } from '../../services/pqr-admin.service';
import { Pqr, PqrQuery, PqrStats, PqrType, PqrStatus, PqrPriority } from '../../models/pqr.model';
import { PqrStatusPillComponent } from '../../components/pqr-status-pill.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { PqrService } from '../../../../../../shared/services/pqr.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

/**
 * Admin list page for PQRs (Peticiones / Quejas / Reclamos).
 *
 * Uses signals + zoneless for reactive query state. The `effect` re-fetches
 * whenever the query changes (status, type, search, page). The stats card
 * fetches independently on mount and refreshes after every status mutation.
 */
@Component({
  selector: 'app-pqr-list-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    DatePipe,
    PqrStatusPillComponent,
    IconComponent,
    StickyHeaderComponent,
    StatsComponent,
  ],
  templateUrl: './pqr-list-page.component.html',
  styleUrls: ['./pqr-list-page.component.scss'],
})
export class PqrListPageComponent {
  private readonly adminService = inject(PqrAdminService);
  private readonly pqrService = inject(PqrService);
  private readonly authFacade = inject(AuthFacade);
  private readonly router = inject(Router);

  readonly query = signal<PqrQuery>({ page: 1, limit: 20 });
  readonly tickets = signal<Pqr[]>([]);
  readonly stats = signal<PqrStats | null>(null);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly meta = signal<{ total: number; page: number; limit: number; pages: number } | null>(null);

  // Two-way bound filter inputs (signal mirrors via ngModelChange).
  readonly statusFilter = signal<PqrStatus | ''>('');
  readonly typeFilter = signal<PqrType | ''>('');
  readonly searchInput = signal<string>('');

  readonly totalPages = computed(() => this.meta()?.pages ?? 1);
  readonly total = computed(() => this.meta()?.total ?? 0);

  // Quick filter state — drives the StickyHeader tabs at the top.
  // Uses the same StickyHeaderComponent that powers the Reportes
  // module's navigation (Resumen de Ventas / Por Producto / …) so
  // the user sees a single visual pattern across admin modules:
  // glass surface, left-aligned tab strip, animated green underline
  // on the active tab, primary action on the right.
  readonly quickFilter = signal<'all' | 'overdue' | 'pending' | 'new'>('all');

  readonly quickFilterTabs = computed<StickyHeaderTab[]>(() => [
    { id: 'all', label: 'Todas', icon: 'inbox' },
    { id: 'overdue', label: 'Vencidas', icon: 'alert-triangle' },
    { id: 'pending', label: 'Pendientes', icon: 'clock' },
    { id: 'new', label: 'Nuevas', icon: 'plus' },
  ]);

  // Primary action rendered in the sticky-header's right slot. The
  // "+ Nueva solicitud" lives here (not in the CTA card) so it stays
  // visible regardless of how many PQRs are pending — same pattern as
  // "Ver Analítica" on the Reportes → Ventas view.
  readonly stickyHeaderActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'new-pqr',
      label: 'Nueva solicitud',
      variant: 'primary',
      icon: 'plus',
    },
  ]);

  setQuickFilter(value: string) {
    // StickyHeaderComponent emits tabChanged as plain `string`; narrow
    // it to the local union so the rest of the method stays type-safe.
    // Anything unrecognised falls back to 'all' so a misconfigured
    // StickyHeaderTab can't poison component state.
    const filter: 'all' | 'overdue' | 'pending' | 'new' =
      value === 'overdue' || value === 'pending' || value === 'new'
        ? value
        : 'all';
    this.quickFilter.set(filter);
    this.query.update((q) => ({ ...q, page: 1 }));
  }

  /**
   * Action button click handler for the sticky-header's right slot.
   * Currently only one action: open the "New PQR" modal.
   */
  onStickyHeaderAction(actionId: string): void {
    if (actionId === 'new-pqr') {
      this.openNewPqrModal();
    }
  }

  /**
   * Returns the PQR with the highest urgency from the current list.
   * Drives the primary CTA card "Continuar conversación" — the user
   * lands directly on the conversation that needs attention first.
   *
   * TODO(human): implement the urgency selection logic.
   *
   * Consider:
   *   - Overdue PQRs first (legal risk under Colombian PQR regulation).
   *   - Then pending PQRs by age (oldest first → highest staleness risk).
   *   - Tiebreaker: COMPLAINT/CLAIM before PETITION (tighter SLA: 10d vs 15d).
   *
   * Use `this.slaInfo(pqr)` to classify a ticket as 'ok' | 'warn' | 'overdue'.
   * Return the Pqr object, or null if `this.tickets()` is empty.
   *
   * Stub: returns null so the CTA hides its action button until implemented.
   */
  readonly mostUrgentPqr = computed<Pqr | null>(() => {
    return null;
  });

  /** RouterLink for the CTA action — points at the most urgent PQR. */
  readonly urgentPqrRoute = computed<string[] | null>(() => {
    const pqr = this.mostUrgentPqr();
    return pqr ? ['/admin/pqrs', String(pqr.id)] : null;
  });

  constructor() {
    // Auto-refetch whenever query changes.
    effect(() => {
      const q = this.query();
      this.fetch(q);
    });

    // Debounced search — apply 300ms after the user stops typing so
    // they don't have to hit Enter or click "Aplicar" on every keystroke.
    // The `if (q.search === trimmed) return q` short-circuit prevents the
    // initial mount (searchInput === '') from triggering a no-op refetch.
    effect((onCleanup) => {
      const value = this.searchInput();
      const timer = setTimeout(() => {
        const trimmed = value.trim() || undefined;
        this.query.update((q) =>
          q.search === trimmed ? q : { ...q, search: trimmed, page: 1 },
        );
      }, 300);
      onCleanup(() => clearTimeout(timer));
    });

    // Initial stats load.
    this.refreshStats();
  }

  setStatusFilter(value: PqrStatus | '') {
    this.statusFilter.set(value);
    this.query.update((q) => ({
      ...q,
      status: value === '' ? undefined : value,
      page: 1,
    }));
  }

  setTypeFilter(value: PqrType | '') {
    this.typeFilter.set(value);
    this.query.update((q) => ({
      ...q,
      pqr_type: value === '' ? undefined : value,
      page: 1,
    }));
  }

  applySearch() {
    const v = this.searchInput().trim();
    this.query.update((q) => ({ ...q, search: v || undefined, page: 1 }));
  }

  clearSearch() {
    this.searchInput.set('');
    this.query.update((q) => ({ ...q, search: undefined, page: 1 }));
  }

  /**
   * Resets all filters at once — used by the empty state CTA when the
   * user has filtered down to zero results.
   */
  clearAllFilters() {
    this.statusFilter.set('');
    this.typeFilter.set('');
    this.searchInput.set('');
    this.query.update((q) => ({
      ...q,
      status: undefined,
      pqr_type: undefined,
      search: undefined,
      page: 1,
    }));
  }

  goToPage(page: number) {
    const max = this.totalPages();
    if (page < 1 || page > max) return;
    this.query.update((q) => ({ ...q, page }));
  }

  refreshStats() {
    this.adminService.getStats().subscribe({
      next: (res) => {
        if (res.success) this.stats.set(res.data);
      },
      error: () => {
        /* swallow — stats are non-critical */
      },
    });
  }

  private fetch(q: PqrQuery) {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.adminService.list(q).subscribe({
      next: (res) => {
        // Quick filter is a client-side post-filter (mirrors super-admin)
        // so the backend stays platform-neutral and we don't need a new
        // endpoint per filter combination. When active, we override the
        // server pagination meta — the filtered set is what the user
        // actually sees, so showing the original server `total` would be
        // confusing.
        const filter = this.quickFilter();
        let data = res.data;
        if (filter !== 'all') {
          data = data.filter((t) => this.matchesQuickFilter(t, filter));
        }
        this.tickets.set(data);
        this.meta.set(
          filter === 'all'
            ? res.meta
            : { total: data.length, page: 1, limit: data.length, pages: 1 },
        );
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          err?.error?.message ?? 'No se pudo cargar la lista de PQRS.',
        );
        this.loading.set(false);
      },
    });
  }

  /** Predicate used by fetch() to apply the active quick filter. */
  private matchesQuickFilter(
    t: Pqr,
    filter: 'overdue' | 'pending' | 'new',
  ): boolean {
    switch (filter) {
      case 'overdue':
        return this.slaInfo(t).status === 'overdue';
      case 'pending':
        return (
          t.status === 'NEW' ||
          t.status === 'OPEN' ||
          t.status === 'IN_PROGRESS' ||
          t.status === 'WAITING_RESPONSE' ||
          t.status === 'REOPENED'
        );
      case 'new':
        return t.status === 'NEW';
    }
  }

  typeLabel(t: PqrType): string {
    switch (t) {
      case 'PETITION':
        return 'Petición';
      case 'COMPLAINT':
        return 'Queja';
      case 'CLAIM':
        return 'Reclamo';
      case 'SUGGESTION':
        return 'Sugerencia';
      default:
        return t;
    }
  }

  /**
   * Computes the SLA legal status for a PQR.
   *
   * Colombian regulation:
   *  - Peticiones (PETITION): 15 business days (Ley 1755/2015 art. 14)
   *  - Quejas (COMPLAINT): 10 business days (Ley 1474/2011 art. 55)
   *  - Reclamos (CLAIM): 10 business days
   *
   * If the customer doesn't respond in time, administrative silence
   * applies (positive or negative depending on the modality), so this
   * indicator is legally meaningful — it must be shown prominently in
   * the UI for store owners (the "Dueño") so they know which PQRs are
   * at risk today.
   *
   * Returns the number of business days remaining and a status bucket
   * for color coding: 'ok' (>= 5 days), 'warn' (1-4 days), 'overdue'.
   */
  slaInfo(
    pqr: Pqr,
  ): { remaining: number; limit: number; status: 'ok' | 'warn' | 'overdue' } {
    const limit = this.slaLimitFor(pqr.pqr_type);
    const created = pqr.created_at ? new Date(pqr.created_at) : new Date();
    const elapsed = businessDaysBetween(created, new Date());
    const remaining = limit - elapsed;
    if (remaining < 0) return { remaining, limit, status: 'overdue' };
    if (remaining <= 4) return { remaining, limit, status: 'warn' };
    return { remaining, limit, status: 'ok' };
  }

  /**
   * Counts PQRs that still require action (NEW / OPEN / IN_PROGRESS /
   * WAITING_RESPONSE / REOPENED). Used for the primary CTA card.
   */
  pendingCount(): number {
    return this.tickets().filter((t) =>
      ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_RESPONSE', 'REOPENED'].includes(
        t.status,
      ),
    ).length;
  }

  overdueCount(): number {
    return this.tickets().filter((t) => {
      const info = this.slaInfo(t);
      return info.status === 'overdue';
    }).length;
  }

  private slaLimitFor(type: PqrType): number {
    switch (type) {
      case 'PETITION':
        return 15;
      case 'COMPLAINT':
      case 'CLAIM':
        return 10;
      default:
        return 15;
    }
  }

  // ── "New PQR" modal state ────────────────────────────────────────────────
  //
  // The store-admin can also create PQRs of their own (e.g. escalations to
  // Vendix Corp support). Pre-fills requester info from the auth facade so
  // they don't have to type their name/email again. Uses the public
  // `PqrService.createPublic()` endpoint — same channel visitors use, but
  // surfaced inside the store-admin panel.

  readonly showNewPqrModal = signal(false);
  readonly newPqrType = signal<PqrType>('PETITION');
  readonly newPqrTitle = signal('');
  readonly newPqrDescription = signal('');
  readonly newPqrPriority = signal<PqrPriority>('P3');
  readonly newPqrSubmitting = signal(false);
  readonly newPqrError = signal<string | null>(null);

  // ── Requester fields captured by the modal ───────────────────────────
  // Pre-filled from the auth facade (the store-admin's own profile)
  // so they don't have to retype their own name/email — but editable
  // when the store-admin is filing on behalf of a customer.
  readonly newPqrRequesterFirstName = signal('');
  readonly newPqrRequesterLastName = signal('');
  readonly newPqrRequesterEmail = signal('');
  readonly newPqrRequesterPhone = signal('');
  readonly newPqrRequesterDocType = signal<'CC' | 'CE' | 'NIT' | 'PA' | ''>('');
  readonly newPqrRequesterDocNum = signal('');

  /** Authenticated user's email — pre-fills the requester field. */
  readonly currentUserEmail = toSignal(this.authFacade.userEmail$, {
    initialValue: '',
  });
  /** Authenticated user's name — pre-fills the requester field. */
  readonly currentUserName = toSignal(this.authFacade.userName$, {
    initialValue: '',
  });

  readonly newPqrTypeOptions: { value: PqrType; label: string; hint: string }[] =
    [
      {
        value: 'PETITION',
        label: 'Petición',
        hint: 'Consulta, solicitud o requerimiento de información.',
      },
      {
        value: 'COMPLAINT',
        label: 'Queja',
        hint: 'Inconformidad con un servicio o proceso de Vendix.',
      },
      {
        value: 'CLAIM',
        label: 'Reclamo',
        hint: 'Solicitud de revisión por algo que afectó tu operación.',
      },
      {
        value: 'SUGGESTION',
        label: 'Sugerencia',
        hint: 'Propuesta de mejora o nueva funcionalidad para Vendix.',
      },
    ];

  /**
   * Priority options shown in the New PQR modal. P0 is intentionally
   * excluded — the public endpoint only accepts P1-P4, reserving P0 for
   * the support team's own triage based on production impact.
   */
  readonly newPqrPriorityOptions: {
    value: PqrPriority;
    label: string;
    hint: string;
  }[] = [
    {
      value: 'P1',
      label: 'Urgente',
      hint: 'Afecta ventas o clientes en producción ahora mismo.',
    },
    {
      value: 'P2',
      label: 'Alta',
      hint: 'Bloquea una operación importante pero tiene workaround.',
    },
    {
      value: 'P3',
      label: 'Normal',
      hint: 'Necesita respuesta pronto, sin bloqueo inmediato.',
    },
    {
      value: 'P4',
      label: 'Baja',
      hint: 'Mejora o pregunta sin impacto en el día a día.',
    },
  ];

  openNewPqrModal(): void {
    this.newPqrType.set('PETITION');
    this.newPqrTitle.set('');
    this.newPqrDescription.set('');
    this.newPqrPriority.set('P3');
    this.newPqrError.set(null);

    // Pre-fill requester fields from the store-admin's own profile so
    // they only need to edit when filing on behalf of a customer.
    // The split helper turns "Andres Meza" into ["Andres", "Meza"].
    // The `?? ''` is defensive: authFacade.userName$ can emit undefined
    // if the user record doesn't have a name set, and `.trim()` on
    // undefined would throw — better to coerce to empty string.
    const fullName = (this.currentUserName() ?? '').trim();
    const [first = '', ...rest] = fullName.split(/\s+/);
    this.newPqrRequesterFirstName.set(first);
    this.newPqrRequesterLastName.set(rest.join(' '));
    this.newPqrRequesterEmail.set(this.currentUserEmail() ?? '');
    this.newPqrRequesterPhone.set('');
    this.newPqrRequesterDocType.set('');
    this.newPqrRequesterDocNum.set('');

    this.showNewPqrModal.set(true);
  }

  closeNewPqrModal(): void {
    if (this.newPqrSubmitting()) return;
    this.showNewPqrModal.set(false);
  }

  canSubmitNewPqr(): boolean {
    return (
      !this.newPqrSubmitting() &&
      this.newPqrTitle().trim().length >= 5 &&
      this.newPqrDescription().trim().length >= 10 &&
      this.newPqrRequesterFirstName().trim().length >= 2 &&
      this.newPqrRequesterLastName().trim().length >= 2 &&
      this.newPqrRequesterEmail().trim().length >= 5
    );
  }

  submitNewPqr(): void {
    if (!this.canSubmitNewPqr()) return;
    this.newPqrSubmitting.set(true);
    this.newPqrError.set(null);
    this.pqrService
      .createPublic({
        pqr_type: this.newPqrType(),
        // Legacy fields still required by the public endpoint's auth
        // layer; the backend uses them as fallback when the structured
        // requester_* fields below aren't populated.
        name:
          `${this.newPqrRequesterFirstName()} ${this.newPqrRequesterLastName()}`.trim(),
        email: this.newPqrRequesterEmail().trim(),
        subject: this.newPqrTitle().trim(),
        description: this.newPqrDescription().trim(),
        priority: this.newPqrPriority(),
        // Pass tenant context so the row lands under the requester's
        // org/store, not under the Vendix platform org (which would
        // hide it from the org-admin PQR oversight view).
        organization_id: this.authFacade.userOrganization()?.id ?? undefined,
        store_id: this.authFacade.userStore()?.id ?? undefined,
        // Structured requester fields — preferred over the legacy
        // `name`/`email`/`phone` triplet. The backend stores them in
        // dedicated columns so the Solicitante card on the detail
        // page shows them without parsing the description.
        requester_first_name: this.newPqrRequesterFirstName().trim(),
        requester_last_name: this.newPqrRequesterLastName().trim(),
        requester_email: this.newPqrRequesterEmail().trim(),
        requester_phone: this.newPqrRequesterPhone().trim() || undefined,
        requester_document_type:
          this.newPqrRequesterDocType() || undefined,
        requester_document_num:
          this.newPqrRequesterDocNum().trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.newPqrSubmitting.set(false);
          this.showNewPqrModal.set(false);
          if (res.success && res.data?.id) {
            // Navigate to detail by numeric id (matches the :id route
            // param). Previously used ticket_number (string like
            // "PQR-6-00001") which `Number()` parsed to NaN and left
            // the detail page blank because the fetch() guard never
            // fired.
            this.router.navigate(['/admin/pqrs', res.data.id]);
          }
        },
        error: (err) => {
          this.newPqrSubmitting.set(false);
          this.newPqrError.set(
            err?.error?.message ??
              'No se pudo enviar la solicitud. Intenta de nuevo.',
          );
        },
      });
  }

  /**
   * Returns a human-friendly label describing the last response on a PQR,
   * shown in the card list to give the owner context about which
   * conversations are stale and which are active.
   *
   * - "Sin respuesta aún" — no `first_response_at` yet.
   * - "Última respuesta: hoy/ayer/hace N días" — recent (< 30 days).
   * - "Última respuesta: {día} {mes}" — older (absolute short date).
   */
  lastResponseLabel(pqr: Pqr): string {
    const firstResponse = pqr.first_response_at;
    if (!firstResponse) return 'Sin respuesta aún';

    const date = new Date(firstResponse);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Última respuesta: hoy';
    if (diffDays === 1) return 'Última respuesta: ayer';
    if (diffDays < 30) return `Última respuesta: hace ${diffDays} días`;

    const months = [
      'ene', 'feb', 'mar', 'abr', 'may', 'jun',
      'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
    ];
    return `Última respuesta: ${date.getDate()} ${months[date.getMonth()]}`;
  }

  pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.query().page ?? 1;
    const pages: (number | '…')[] = [];
    const window = 2;
    for (let p = 1; p <= total; p++) {
      if (
        p === 1 ||
        p === total ||
        (p >= current - window && p <= current + window)
      ) {
        pages.push(p);
      } else if (pages[pages.length - 1] !== '…') {
        pages.push('…');
      }
    }
    return pages;
  });
}

/**
 * Counts business days between two dates (excludes Saturday + Sunday).
 * Colombian PQR SLAs are denominated in business days — see slaInfo()
 * for the legal reference. Naive loop, sufficient for the volumes
 * encountered in PQR lists (typically days, not years).
 */
function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
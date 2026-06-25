import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PqrAdminService } from '../../services/pqr-admin.service';
import { Pqr, PqrQuery, PqrStats, PqrType, PqrStatus } from '../../models/pqr.model';
import { PqrStatusPillComponent } from '../../components/pqr-status-pill.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

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
  ],
  templateUrl: './pqr-list-page.component.html',
  styleUrls: ['./pqr-list-page.component.scss'],
})
export class PqrListPageComponent {
  private readonly adminService = inject(PqrAdminService);

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
        this.tickets.set(res.data);
        this.meta.set(res.meta);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          err?.error?.message ?? 'No se pudo cargar la lista de PQRs.',
        );
        this.loading.set(false);
      },
    });
  }

  typeLabel(t: PqrType): string {
    switch (t) {
      case 'PETITION':
        return 'Petición';
      case 'COMPLAINT':
        return 'Queja';
      case 'CLAIM':
        return 'Reclamo';
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
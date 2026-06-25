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
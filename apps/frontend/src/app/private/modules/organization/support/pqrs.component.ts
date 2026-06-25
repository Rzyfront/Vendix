import {
  Component,
  inject,
  signal,
  DestroyRef,
  effect,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import {
  IconComponent,
  StatsComponent,
  CardComponent,
} from '../../../../shared/components';

/**
 * Org-admin PQR list page.
 *
 * Aggregated view of all PQRs across every store in the requesting
 * org. Mirrors the super-admin PQR view but scoped via
 * `RequestContextService.getOrganizationId()` server-side, so the
 * org-admin (cliente / Dueño de la organización) sees only their own
 * tenant's PQRs.
 *
 * Audience: ORG_ADMIN — org owners who need oversight across their
 * tenant stores but don't own day-to-day PQR response (that's per-store).
 */
@Component({
  selector: 'app-orgadmin-pqrs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    RouterLink,
    IconComponent,
    StatsComponent,
    CardComponent,
  ],
  template: `
    <div class="pqr-list-page">
      <!-- Cross-store CTA -->
      <div
        class="cta-card"
        [class.cta-card--urgent]="overdueCount() > 0"
        [class.cta-card--empty]="stats().total === 0"
      >
        @if (stats().total === 0) {
        <div class="cta-card__main">
          <div class="cta-card__icon cta-card__icon--muted">
            <app-icon name="inbox" [size]="32"></app-icon>
          </div>
          <div class="cta-card__copy">
            <h2>Sin PQRs en tus tiendas</h2>
            <p>
              Cuando un visitante radique una petición, queja o reclamo en
              cualquier tienda de tu organización, aparecerá aquí.
            </p>
          </div>
        </div>
        } @else {
        <div class="cta-card__main">
          <div class="cta-card__icon">
            <app-icon
              [name]="overdueCount() > 0 ? 'alert-triangle' : 'message-square'"
              [size]="28"
            ></app-icon>
          </div>
          <div class="cta-card__copy">
            <h2>
              @if (overdueCount() > 0) {
                {{ overdueCount() }} PQR{{ overdueCount() === 1 ? '' : 's' }}
                con SLA vencido en tus tiendas
              } @else if (stats().recent_24h > 0) {
                {{ stats().recent_24h }} PQR{{ stats().recent_24h === 1 ? '' : 's' }}
                radicadas en las últimas 24h
              } @else {
                Todas las tiendas al día con PQRs
              }
            </h2>
            <p>
              @if (overdueCount() > 0) {
                ⚠️ Riesgo regulatorio a nivel de la organización.
              } @else if (stats().recent_24h > 0) {
                Monitorea la respuesta de cada tienda para evitar
                acumulación de SLA.
              } @else {
                Sin PQRs pendientes de revisión.
              }
            </p>
          </div>
        </div>
        }
      </div>

      <div class="stats-container">
        <app-stats
          title="Total PQRs"
          [value]="stats().total"
          smallText="Todas las tiendas"
          iconName="message-square"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Últimas 24h"
          [value]="stats().recent_24h"
          smallText="PQRs recientes"
          iconName="clock"
          iconBgColor="bg-violet-100"
          iconColor="text-violet-600"
        ></app-stats>
        <app-stats
          title="Vencidas"
          [value]="stats().overdue"
          smallText="SLA legal agotado"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
        <app-stats
          title="Nuevas"
          [value]="stats().by_status?.NEW || 0"
          smallText="Sin asignar"
          iconName="inbox"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <div class="filter-chips">
        <button
          class="chip"
          [class.chip--active]="quickFilter() === 'all'"
          (click)="setQuickFilter('all')"
        >
          Todas <span class="chip__count">{{ stats().total }}</span>
        </button>
        <button
          class="chip chip--warn"
          [class.chip--active]="quickFilter() === 'overdue'"
          (click)="setQuickFilter('overdue')"
        >
          <app-icon name="alert-triangle" [size]="14"></app-icon>
          Vencidas <span class="chip__count">{{ stats().overdue }}</span>
        </button>
        <button
          class="chip"
          [class.chip--active]="quickFilter() === 'new'"
          (click)="setQuickFilter('new')"
        >
          <app-icon name="inbox" [size]="14"></app-icon>
          Sin asignar
          <span class="chip__count">{{ stats().by_status?.NEW || 0 }}</span>
        </button>
      </div>

      <div class="filters-bar">
        <div class="filter-group">
          <label>Tipo</label>
          <select [(ngModel)]="typeFilter" (change)="applyFilters()">
            <option value="">Todos</option>
            <option value="PETITION">Petición</option>
            <option value="COMPLAINT">Queja</option>
            <option value="CLAIM">Reclamo</option>
          </select>
        </div>
        <div class="filter-group filter-group--search">
          <label>Buscar</label>
          <div class="search-input">
            <app-icon name="search" [size]="16"></app-icon>
            <input
              type="search"
              placeholder="Asunto o número de ticket…"
              [ngModel]="searchInput()"
              (ngModelChange)="searchInput.set($event)"
            />
          </div>
        </div>
      </div>

      <div class="table-wrapper">
        @if (loading()) {
        <div class="loading-overlay"><span>Cargando…</span></div>
        }
        @if (errorMsg(); as msg) {
        <div class="error-banner">{{ msg }}</div>
        }
        <table class="pqr-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Tipo</th>
              <th>Asunto</th>
              <th>Tienda</th>
              <th>SLA</th>
              <th>Estado</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            @for (t of tickets(); track t.id) {
            @let info = slaInfo(t);
            <tr
              class="row-link"
              [class.row-link--overdue]="info.status === 'overdue'"
              [class.row-link--warn]="info.status === 'warn'"
            >
              <td class="mono">{{ t.ticket_number }}</td>
              <td>
                <span class="type-tag" [attr.data-type]="t.category">
                  {{ typeLabel(t.category) }}
                </span>
              </td>
              <td class="title-cell">{{ t.title }}</td>
              <td>
                <span class="store-name">{{ t.store?.name || '—' }}</span>
              </td>
              <td>
                <span class="sla-badge" [attr.data-status]="info.status">
                  @if (info.status === 'overdue') {
                    <app-icon name="alert-triangle" [size]="12"></app-icon>
                    Vencido
                  } @else if (info.status === 'warn') {
                    <app-icon name="clock" [size]="12"></app-icon>
                    {{ info.remaining }}d
                  } @else {
                    {{ info.remaining }}d
                  }
                </span>
              </td>
              <td>
                <span class="status-pill" [attr.data-status]="t.status">
                  {{
                    ({
                      NEW: 'Nuevo',
                      OPEN: 'Abierto',
                      IN_PROGRESS: 'En progreso',
                      RESOLVED: 'Resuelto',
                      CLOSED: 'Cerrado'
                    })[t.status] || t.status
                  }}
                </span>
              </td>
              <td class="muted">{{ t.created_at | date: 'shortDate' }}</td>
            </tr>
            } @empty {
            <tr>
              <td colspan="7" class="empty-state">
                @if (quickFilter() !== 'all' || typeFilter || searchInput()) {
                  No hay PQRs con esos filtros.
                  <button class="empty-state__reset" (click)="clearAllFilters()">
                    Limpiar filtros
                  </button>
                } @else {
                  Sin PQRs en tus tiendas.
                }
              </td>
            </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 1.5rem;
        max-width: 1440px;
        margin: 0 auto;
      }
      .pqr-list-page {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .cta-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1.25rem 1.5rem;
      }
      .cta-card__main {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .cta-card__icon {
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: #eff6ff;
        color: #1d4ed8;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .cta-card__icon--muted {
        background: #f1f5f9;
        color: #94a3b8;
      }
      .cta-card__copy {
        flex: 1;
        min-width: 0;
      }
      .cta-card__copy h2 {
        margin: 0 0 0.25rem;
        font-size: 1.0625rem;
        font-weight: 700;
        color: #0f172a;
        line-height: 1.3;
      }
      .cta-card__copy p {
        margin: 0;
        color: #475569;
        font-size: 0.875rem;
      }
      .cta-card--urgent {
        border-color: #fecaca;
        background: linear-gradient(135deg, #fef2f2, #fff);
      }
      .cta-card--urgent .cta-card__icon {
        background: #fee2e2;
        color: #b91c1c;
      }
      .cta-card--urgent h2 {
        color: #991b1b;
      }
      .stats-container {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.75rem;
      }
      .filter-chips {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        background: #fff;
        border: 1px solid #e2e8f0;
        color: #475569;
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.5rem 0.875rem;
        border-radius: 9999px;
        cursor: pointer;
      }
      .chip--active {
        background: #0f172a;
        color: #fff;
        border-color: #0f172a;
      }
      .chip--active .chip__count {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
      }
      .chip__count {
        background: #f1f5f9;
        color: #64748b;
        padding: 0.0625rem 0.4375rem;
        border-radius: 9999px;
        font-size: 0.7rem;
      }
      .filters-bar {
        display: flex;
        gap: 0.75rem;
        align-items: flex-end;
        padding: 0.875rem 1rem;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      .filter-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .filter-group label {
        font-size: 0.7rem;
        color: #64748b;
        font-weight: 600;
        text-transform: uppercase;
      }
      .filter-group select,
      .filter-group input {
        padding: 0.4375rem 0.75rem;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-size: 0.875rem;
      }
      .filter-group--search {
        flex: 1;
        min-width: 200px;
      }
      .search-input {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0 0.75rem;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #fff;
      }
      .search-input input {
        flex: 1;
        border: 0;
        outline: none;
        padding: 0.4375rem 0;
      }
      .table-wrapper {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
        position: relative;
      }
      .loading-overlay {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
      }
      .error-banner {
        background: #fef2f2;
        border-bottom: 1px solid #fecaca;
        color: #991b1b;
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
      }
      .pqr-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      .pqr-table th {
        padding: 0.625rem 1rem;
        background: #f8fafc;
        font-size: 0.7rem;
        text-transform: uppercase;
        color: #64748b;
        font-weight: 600;
        border-bottom: 1px solid #e2e8f0;
        text-align: left;
      }
      .pqr-table td {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #f1f5f9;
      }
      .pqr-table tbody tr {
        cursor: pointer;
      }
      .pqr-table tbody tr:hover {
        background: #f8fafc;
      }
      .pqr-table .row-link--warn {
        background: #fffbeb;
      }
      .pqr-table .row-link--overdue {
        background: #fef2f2;
      }
      .mono {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.8125rem;
      }
      .title-cell {
        max-width: 280px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .store-name {
        font-size: 0.8125rem;
        color: #64748b;
      }
      .muted {
        color: #94a3b8;
        font-size: 0.8125rem;
      }
      .type-tag {
        display: inline-flex;
        padding: 0.1875rem 0.5rem;
        border-radius: 6px;
        font-size: 0.7rem;
        font-weight: 600;
      }
      .type-tag[data-type='PETITION'] {
        background: #eef2ff;
        color: #4338ca;
      }
      .type-tag[data-type='COMPLAINT'] {
        background: #fed7aa;
        color: #9a3412;
      }
      .type-tag[data-type='CLAIM'] {
        background: #fecaca;
        color: #991b1b;
      }
      .sla-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.1875rem 0.5rem;
        border-radius: 6px;
      }
      .sla-badge[data-status='ok'] {
        background: #ecfdf5;
        color: #047857;
      }
      .sla-badge[data-status='warn'] {
        background: #fef3c7;
        color: #92400e;
      }
      .sla-badge[data-status='overdue'] {
        background: #fee2e2;
        color: #b91c1c;
      }
      .status-pill {
        display: inline-block;
        padding: 0.1875rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        background: #f1f5f9;
        color: #475569;
      }
      .status-pill[data-status='NEW'] {
        background: #dbeafe;
        color: #1e40af;
      }
      .status-pill[data-status='RESOLVED'],
      .status-pill[data-status='CLOSED'] {
        background: #d1fae5;
        color: #065f46;
      }
      .empty-state {
        text-align: center;
        padding: 2.5rem 1rem;
        color: #94a3b8;
      }
      .empty-state__reset {
        background: none;
        border: 0;
        color: #1d4ed8;
        font-weight: 600;
        cursor: pointer;
        margin-left: 0.5rem;
        text-decoration: underline;
      }
    `,
  ],
})
export class OrgAdminPqrsComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly API_URL = `${environment.apiUrl}/admin/support/pqr`;

  readonly tickets = signal<any[]>([]);
  readonly stats = signal<any>({
    total: 0,
    recent_24h: 0,
    overdue: 0,
    by_status: {},
    by_type: {},
  });
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly quickFilter = signal<'all' | 'overdue' | 'new'>('all');

  typeFilter = '';
  readonly searchInput = signal('');

  constructor() {
    this.fetch();
    this.fetchStats();

    // Debounced search
    effect((onCleanup) => {
      const value = this.searchInput();
      const timer = setTimeout(() => {
        this.fetch();
      }, 300);
      onCleanup(() => clearTimeout(timer));
    });
  }

  setQuickFilter(filter: 'all' | 'overdue' | 'new') {
    this.quickFilter.set(filter);
    this.fetch();
  }

  applyFilters() {
    this.fetch();
  }

  clearAllFilters() {
    this.quickFilter.set('all');
    this.typeFilter = '';
    this.searchInput.set('');
    this.fetch();
  }

  typeLabel(t: string): string {
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

  slaInfo(t: any): {
    remaining: number;
    limit: number;
    status: 'ok' | 'warn' | 'overdue';
  } {
    const limit = this.slaLimitFor(t.category);
    const created = t.created_at ? new Date(t.created_at) : new Date();
    const elapsed = businessDaysBetween(created, new Date());
    const remaining = limit - elapsed;
    if (remaining < 0) return { remaining, limit, status: 'overdue' };
    if (remaining <= 3) return { remaining, limit, status: 'warn' };
    return { remaining, limit, status: 'ok' };
  }

  overdueCount(): number {
    return this.stats().overdue || 0;
  }

  private slaLimitFor(type: string): number {
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

  private fetch() {
    this.loading.set(true);
    this.errorMsg.set(null);

    let params = new HttpParams().set('limit', '50');
    if (this.typeFilter) params = params.set('pqr_type', this.typeFilter);
    if (this.searchInput().trim())
      params = params.set('search', this.searchInput().trim());

    this.http
      .get<any>(this.API_URL, { params })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.errorMsg.set(
            err?.error?.message ?? 'No se pudo cargar la lista de PQRs.',
          );
          this.loading.set(false);
          return of(null);
        }),
      )
      .subscribe((res) => {
        if (!res) return;
        let data = res.data || [];
        if (this.quickFilter() === 'overdue') {
          data = data.filter((t: any) => this.slaInfo(t).status === 'overdue');
        } else if (this.quickFilter() === 'new') {
          data = data.filter((t: any) => t.status === 'NEW');
        }
        this.tickets.set(data);
        this.loading.set(false);
      });
  }

  private fetchStats() {
    this.http
      .get<any>(`${this.API_URL}/stats`)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      )
      .subscribe((res) => {
        if (res?.success) this.stats.set(res.data);
      });
  }
}

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
import {
  Component,
  inject,
  signal,
  computed,
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
  StickyHeaderComponent,
} from '../../../../shared/components';
import { StickyHeaderTab } from '../../../../shared/components/sticky-header/sticky-header.component';

/**
 * Super-admin global PQRs page (compliance / oversight view).
 *
 * Audience: Vendix Corp platform operators and compliance officers who
 * need cross-tenant visibility into Peticiones / Quejas / Reclamos.
 *
 * Differences vs. store-admin PQRs view:
 *   - CTA card emphasizes cross-tenant SLA exposure (the "what's at risk
 *     across all customers today" question).
 *   - Quick filter chips (All / Overdue / Expiring / New) instead of
 *     dropdowns — operators use these a lot.
 *   - SLA column added inline so urgency is one glance away.
 *   - Inline "Ver" action per row for fast triage.
 *   - Same SLA computation as store-admin (15/10 business days) — kept
 *     local because it's a UI concern; backend stays platform-neutral.
 */
@Component({
  selector: 'app-superadmin-pqrs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    RouterLink,
    IconComponent,
    StatsComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="pqr-list-page">
      <!-- Sticky header — same component used by the Reportes →
           Ventas view. Renders the filter tabs at the top, the
           section icon + sub-title on the left, and (optionally)
           actions on the right. Single visual pattern across admin
           modules so users don't relearn navigation per page. -->
      <app-sticky-header
        title="PQRs"
        subtitle="Vista global de la plataforma"
        icon="message-square"
        variant="glass"
        [showBackButton]="false"
        [tabs]="quickFilterTabs()"
        [activeTab]="quickFilter()"
        tabsAriaLabel="Filtros de PQR"
        (tabChanged)="setQuickFilter($event)"
      />

      <!-- Top CTA — cross-tenant urgency -->
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
            <h2>Sin PQRs radicadas en la plataforma</h2>
            <p>
              Cuando un visitante publique una petición, queja o reclamo
              desde cualquier storefront, aparecerá aquí.
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
                con SLA vencido en la plataforma
              } @else if (stats().recent_24h > 0) {
                {{ stats().recent_24h }} PQR{{ stats().recent_24h === 1 ? '' : 's' }}
                radicadas en las últimas 24h
              } @else {
                Plataforma al día con PQRs
              }
            </h2>
            <p>
              @if (overdueCount() > 0) {
                ⚠️ Riesgo regulatorio: las PQRs vencidas pueden derivar en
                silencio administrativo a favor del reclamante.
              } @else if (stats().recent_24h > 0) {
                Monitorea la respuesta de cada tienda para evitar acumulación
                de SLA.
              } @else {
                Sin PQRs pendientes de revisión.
              }
            </p>
          </div>
        </div>
        }
      </div>

      <!-- Stats grid — kept compact for cross-tenant scan -->
      <div class="stats-container">
        <app-stats
          title="Total PQRs"
          [value]="stats().total"
          smallText="Todas las peticiones, quejas y reclamos"
          iconName="message-square"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Últimas 24h"
          [value]="stats().recent_24h"
          smallText="PQRs radicadas recientemente"
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
          smallText="Sin asignar a tienda"
          iconName="inbox"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Quick filters now live in the StickyHeader above. -->

      <!-- Filters bar (advanced) -->
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
              placeholder="Asunto, número o tienda…"
              [ngModel]="searchInput()"
              (ngModelChange)="searchInput.set($event)"
            />
            @if (searchInput()) {
            <button class="clear-btn" (click)="clearSearch()" aria-label="Limpiar">
              ×
            </button>
            }
          </div>
        </div>
      </div>

      <!-- Table with SLA column -->
      <div class="table-wrapper">
        @if (loading()) {
        <div class="loading-overlay">
          <span>Cargando…</span>
        </div>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (t of tickets(); track t.id) {
            @let info = slaInfo(t);
            <tr
              class="row-link"
              [class.row-link--overdue]="info.status === 'overdue'"
              [class.row-link--warn]="info.status === 'warn'"
              [routerLink]="['/super-admin/support/pqrs', t.id]"
            >
              <td class="mono">{{ t.ticket_number }}</td>
              <td>
                <span class="type-tag" [attr.data-type]="t.category">
                  {{ typeLabel(t.category) }}
                </span>
              </td>
              <td class="title-cell">{{ t.title }}</td>
              <td>
                <!-- Show the store name when present. t.store is null
                     for legacy PQRs created via the public storefront
                     form (no tenant context). We deliberately don't
                     fall back to the organization name because for the
                     platform org (orgVendix) it would misleadingly show
                     "Vendix Corp" as if it were a tienda. -->
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
                  {{ statusLabel(t.status) }}
                </span>
              </td>
              <td class="muted">{{ t.created_at | date: 'shortDate' }}</td>
              <td class="actions">
                <a
                  class="action-btn"
                  [routerLink]="['/super-admin/support/pqrs', t.id]"
                  title="Ver detalle"
                >
                  Ver
                  <app-icon name="arrow-right" [size]="12"></app-icon>
                </a>
              </td>
            </tr>
            } @empty {
            <tr>
              <td colspan="8" class="empty-state">
                @if (quickFilter() !== 'all' || typeFilter || searchInput()) {
                  No hay PQRs con esos filtros.
                  <button class="empty-state__reset" (click)="clearAllFilters()">
                    Limpiar filtros
                  </button>
                } @else {
                  Sin PQRs en la plataforma.
                }
              </td>
            </tr>
            }
          </tbody>
        </table>

        <!-- Pagination -->
        @if (totalPages() > 1) {
        <nav class="pagination">
          <button
            class="page-btn"
            [disabled]="page() <= 1"
            (click)="goToPage(page() - 1)"
          >
            ‹ Anterior
          </button>
          @for (p of pageNumbers(); track $index) {
            @if (p === '…') {
            <span class="page-ellipsis">…</span>
            } @else {
            <button
              class="page-btn"
              [class.active]="p === page()"
              (click)="goToPage(p)"
            >
              {{ p }}
            </button>
            }
          }
          <button
            class="page-btn"
            [disabled]="page() >= totalPages()"
            (click)="goToPage(page() + 1)"
          >
            Siguiente ›
          </button>
          <span class="page-info">{{ total() }} resultados</span>
        </nav>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      // CTA card (cross-tenant urgency)
      .cta-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1.25rem 1.5rem;
        margin-bottom: 1rem;

        &__main {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        &__icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: #dcfce7;
          color: #15803d;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          &--muted {
            background: #f1f5f9;
            color: #94a3b8;
          }
        }

        &__copy {
          flex: 1;
          min-width: 0;
          h2 {
            margin: 0 0 0.25rem;
            font-size: 1.0625rem;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.3;
          }
          p {
            margin: 0;
            color: #475569;
            font-size: 0.875rem;
            line-height: 1.45;
          }
        }

        &--urgent {
          border-color: #fecaca;
          background: linear-gradient(135deg, #fef2f2, #ffffff);
          .cta-card__icon {
            background: #fee2e2;
            color: #b91c1c;
          }
          h2 {
            color: #991b1b;
          }
        }
      }

      // Stats
      .stats-container {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      // Quick filter chips — primary operator tool
      .filter-chips {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;

        .chip {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 0.5rem 0.875rem;
          border-radius: 9999px;
          cursor: pointer;
          transition: all 0.15s;

          &:hover {
            border-color: #cbd5e1;
            background: #f8fafc;
          }

          &--active {
            background: #0f172a;
            color: #ffffff;
            border-color: #0f172a;

            .chip__count {
              background: rgba(255, 255, 255, 0.2);
              color: #ffffff;
            }
          }

          &--warn:not(.chip--active) {
            color: #b45309;
          }

          &__count {
            background: #f1f5f9;
            color: #64748b;
            padding: 0.0625rem 0.4375rem;
            border-radius: 9999px;
            font-size: 0.7rem;
            font-weight: 700;
          }
        }
      }

      // Filters bar
      .filters-bar {
        display: flex;
        gap: 0.75rem;
        align-items: flex-end;
        padding: 0.875rem 1rem;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        margin-bottom: 0.75rem;

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          label {
            font-size: 0.7rem;
            color: #64748b;
            font-weight: 600;
            text-transform: uppercase;
          }
          select,
          input {
            padding: 0.4375rem 0.75rem;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.875rem;
            background: #ffffff;
          }
          select:focus,
          input:focus {
            outline: none;
            border-color: #16a34a;
            box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
          }
          &--search {
            flex: 1;
            min-width: 200px;
          }
        }
        .search-input {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0 0.75rem;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #ffffff;
          input {
            flex: 1;
            border: 0;
            outline: none;
            padding: 0.4375rem 0;
            font-size: 0.875rem;
          }
          app-icon {
            color: #94a3b8;
          }
        }
        .clear-btn {
          background: none;
          border: 0;
          color: #94a3b8;
          font-size: 1.2rem;
          cursor: pointer;
          padding: 0 0.25rem;
          line-height: 1;
        }
      }

      // Table
      .table-wrapper {
        background: #ffffff;
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
        z-index: 5;
        color: #64748b;
        font-weight: 500;
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
        thead {
          background: #f8fafc;
          text-align: left;
          th {
            padding: 0.625rem 1rem;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            font-weight: 600;
            border-bottom: 1px solid #e2e8f0;
          }
        }
        tbody tr {
          border-bottom: 1px solid #f1f5f9;
          cursor: pointer;
          transition: background 0.1s;
          &:hover {
            background: #f8fafc;
          }
          &--warn {
            background: #fffbeb;
          }
          &--overdue {
            background: #fef2f2;
          }
          &:last-child {
            border-bottom: 0;
          }
        }
        td {
          padding: 0.75rem 1rem;
          color: #1e293b;
          vertical-align: middle;
        }
        .mono {
          font-family: 'SF Mono', Menlo, Consolas, monospace;
          font-size: 0.8125rem;
          color: #475569;
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
        .actions {
          text-align: right;
        }
        .action-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.625rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          color: #475569;
          text-decoration: none;
          transition: all 0.15s;
          &:hover {
            background: #f1f5f9;
            border-color: #94a3b8;
            color: #0f172a;
          }
        }
        .empty-state {
          text-align: center;
          padding: 2.5rem 1rem;
          color: #94a3b8;
        }
        .empty-state__reset {
          background: none;
          border: 0;
          color: #15803d;
          font-weight: 600;
          cursor: pointer;
          margin-left: 0.5rem;
          text-decoration: underline;
        }
      }

      // Type tag
      .type-tag {
        display: inline-flex;
        padding: 0.1875rem 0.5rem;
        border-radius: 6px;
        font-size: 0.7rem;
        font-weight: 600;
        &[data-type='PETITION'] {
          background: #dcfce7;
          color: #15803d;
        }
        &[data-type='COMPLAINT'] {
          background: #fed7aa;
          color: #9a3412;
        }
        &[data-type='CLAIM'] {
          background: #fecaca;
          color: #991b1b;
        }
      }

      // SLA badge — compact for table density
      .sla-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.1875rem 0.5rem;
        border-radius: 6px;
        &[data-status='ok'] {
          background: #ecfdf5;
          color: #047857;
        }
        &[data-status='warn'] {
          background: #fef3c7;
          color: #92400e;
        }
        &[data-status='overdue'] {
          background: #fee2e2;
          color: #b91c1c;
        }
      }

      // Status pill
      .status-pill {
        display: inline-block;
        padding: 0.1875rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        background: #f1f5f9;
        color: #475569;
        &[data-status='NEW'] {
          background: #dbeafe;
          color: #15803d;
        }
        &[data-status='RESOLVED'],
        &[data-status='CLOSED'] {
          background: #d1fae5;
          color: #065f46;
        }
      }

      // Pagination
      .pagination {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.875rem 1rem;
        border-top: 1px solid #f1f5f9;
        flex-wrap: wrap;
        .page-btn {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          padding: 0.375rem 0.625rem;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8125rem;
          color: #334155;
          &:hover:not(:disabled) {
            background: #f8fafc;
          }
          &.active {
            background: #0f172a;
            color: #ffffff;
            border-color: #0f172a;
          }
          &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        }
        .page-ellipsis {
          padding: 0 0.25rem;
          color: #94a3b8;
        }
        .page-info {
          margin-left: auto;
          color: #64748b;
          font-size: 0.8125rem;
        }
      }
    `,
  ],
})
export class SuperadminPqrsComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly API_URL = `${environment.apiUrl}/superadmin/support/pqrs`;

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
  readonly page = signal(1);
  readonly limit = 20;
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly quickFilter = signal<'all' | 'overdue' | 'expiring' | 'new'>('all');

  typeFilter = '';
  readonly searchInput = signal('');

  constructor() {
    this.fetch();
    this.fetchStats();

    // Debounced search — 300ms after typing stops.
    effect((onCleanup) => {
      const value = this.searchInput();
      const timer = setTimeout(() => {
        // Search is applied client-side from the input value via fetch()
        // but we trigger it here when the value changes.
        this.fetch();
      }, 300);
      onCleanup(() => clearTimeout(timer));
    });
  }

  setQuickFilter(filter: string) {
    // ScrollableTabsComponent emits tabChange as plain `string`; narrow
    // it to the local union so the rest of the method stays type-safe.
    // Unrecognised ids are ignored so a misconfigured ScrollableTab
    // can't poison component state.
    if (
      filter !== 'all' &&
      filter !== 'overdue' &&
      filter !== 'expiring' &&
      filter !== 'new'
    ) {
      return;
    }
    this.quickFilter.set(filter);
    this.page.set(1);
    this.fetch();
  }

  applyFilters() {
    this.page.set(1);
    this.fetch();
  }

  clearSearch() {
    this.searchInput.set('');
    this.applyFilters();
  }

  clearAllFilters() {
    this.quickFilter.set('all');
    this.typeFilter = '';
    this.searchInput.set('');
    this.page.set(1);
    this.fetch();
  }

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.fetch();
  }

  // PQR type label
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

  /**
   * Returns the user-facing Spanish label for a PQR status enum value.
   * Used by the status pill column — keeping it as a method avoids the
   * `as Record<string, string>` cast inside the template (Angular's
   * template parser doesn't accept TS-only `as` syntax on inline
   * object literals).
   */
  statusLabel(status: string): string {
    switch (status) {
      case 'NEW':
        return 'Nuevo';
      case 'OPEN':
        return 'Abierto';
      case 'IN_PROGRESS':
        return 'En progreso';
      case 'WAITING_RESPONSE':
        return 'Esperando';
      case 'RESOLVED':
        return 'Resuelto';
      case 'CLOSED':
        return 'Cerrado';
      case 'REOPENED':
        return 'Reabierto';
      default:
        return status;
    }
  }

  /**
   * SLA computation — same Colombian regulatory limits as the
   * store-admin view. PETITION: 15 business days (Ley 1755/2015 art. 14).
   * COMPLAINT / CLAIM: 10 business days (Ley 1474/2011 art. 55).
   */
  slaInfo(
    t: any,
  ): { remaining: number; limit: number; status: 'ok' | 'warn' | 'overdue' } {
    const limit = this.slaLimitFor(t.category);
    const created = t.created_at ? new Date(t.created_at) : new Date();
    const elapsed = businessDaysBetween(created, new Date());
    const remaining = limit - elapsed;
    if (remaining < 0) return { remaining, limit, status: 'overdue' };
    if (remaining <= 3) return { remaining, limit, status: 'warn' };
    return { remaining, limit, status: 'ok' };
  }

  /**
   * Quick filter tabs — drives the StickyHeaderComponent tab strip
   * at the top of the page. Each tab's `id` matches the value
   * `setQuickFilter()` expects so the same handler drives the
   * filtering regardless of UI shape.
   */
  quickFilterTabs = computed<StickyHeaderTab[]>(() => {
    return [
      { id: 'all', label: 'Todas', icon: 'inbox' },
      { id: 'overdue', label: 'Vencidas', icon: 'alert-triangle' },
      { id: 'expiring', label: 'Por vencer', icon: 'clock' },
      { id: 'new', label: 'Sin asignar', icon: 'inbox' },
    ];
  });

  /** Count of tickets in "expiring" state (1-3 days remaining). */
  expiringCount(): number {
    return this.tickets().filter((t) => {
      const info = this.slaInfo(t);
      return info.status === 'warn';
    }).length;
  }

  /** Count of overdue tickets — reads from backend stats. */
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

  pageNumbers = (): (number | '…')[] => {
    const total = this.totalPages();
    const current = this.page();
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
  };

  private fetch() {
    this.loading.set(true);
    this.errorMsg.set(null);

    let params = new HttpParams()
      .set('page', this.page().toString())
      .set('limit', this.limit.toString());

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

        // Quick filter (client-side — backend doesn't have these shortcuts yet)
        if (this.quickFilter() === 'overdue') {
          data = data.filter((t: any) => this.slaInfo(t).status === 'overdue');
        } else if (this.quickFilter() === 'expiring') {
          data = data.filter((t: any) => this.slaInfo(t).status === 'warn');
        } else if (this.quickFilter() === 'new') {
          // Chip label is "Sin asignar" — match the operator's mental model:
          // a PQR with no `assigned_to_user_id` yet. We keep the internal
          // value as `'new'` to stay backwards-compatible with the URL
          // (a follow-up could rename to `'unassigned'`).
          data = data.filter((t: any) => !t.assigned_to);
        }

        this.tickets.set(data);
        this.total.set(data.length);
        this.totalPages.set(1); // client-side filter, no real pagination
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

/**
 * Business days between two dates (excludes Saturday + Sunday). Naive
 * loop — sufficient for the 10-15 day SLA windows in PQR management.
 * Future enhancement: integrate Colombian holiday calendar.
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
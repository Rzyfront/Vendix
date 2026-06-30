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
  CardComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
} from '../../../../shared/components';
import type {
  FilterConfig,
  FilterValues,
  DropdownAction,
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
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
  ],
  template: `
    <div class="pqr-list-page">
      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:text-text-primary"
            >
              Todas las solicitudes ({{ total() }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Asunto, número o tienda…"
                (search)="onSearch($event)"
              ></app-inputsearch>
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearAllFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        @if (loading() && tickets().length === 0) {
        <div class="p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-sm text-text-secondary">Cargando solicitudes…</p>
        </div>
        }

        <div class="px-2 pb-2 pt-1 md:p-4">
          <div class="table-scroll" role="region" aria-label="Listado de solicitudes">
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
                <span class="store-name">{{ t.store?.name || 'No registrado' }}</span>
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
                  No hay PQRS con esos filtros.
                  <button class="empty-state__reset" (click)="clearAllFilters()">
                    Limpiar filtros
                  </button>
                } @else {
                  Sin PQRS en la plataforma.
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
      </app-card>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      // Sub-header card (patrón Ventas)
      .pqr-subheader {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1rem 1.25rem;
      }
      .pqr-subheader__icon {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: #dcfce7;
        color: #15803d;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .pqr-subheader__copy {
        flex: 1;
        min-width: 0;
      }
      .pqr-subheader__copy h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
        color: #0f172a;
        line-height: 1.2;
      }
      .pqr-subheader__copy p {
        margin: 0;
        color: #64748b;
        font-size: 0.8125rem;
        line-height: 1.3;
      }

      // Quick-filter tabs (moved from the removed sticky-header)
      .quick-filters {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
        padding: 0 0.25rem;
      }
      .quick-filters__tab {
        display: inline-flex;
        align-items: center;
        gap: 0.4375rem;
        padding: 0.5rem 0.875rem;
        border: 0;
        background: transparent;
        color: #64748b;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        border-radius: 8px;
        border-bottom: 2px solid transparent;
        min-height: 44px;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
      }
      .quick-filters__tab:hover {
        color: #15803d;
        background: #f0fdf4;
      }
      .quick-filters__tab:focus-visible {
        outline: 2px solid #16a34a;
        outline-offset: 2px;
      }
      .quick-filters__tab app-icon {
        color: currentColor;
      }
      .quick-filters__tab--active {
        color: #15803d;
        border-bottom-color: #16a34a;
        background: transparent;
      }
      .quick-filters__tab--active:hover {
        background: #f0fdf4;
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

  setQuickFilter(filter: string | Event) {
    // StickyHeaderComponent emits tabChanged as Event; the inline
    // quick-filter buttons emit plain strings. Accept both and coerce.
    const f = typeof filter === 'string' ? filter : '';
    // ScrollableTabsComponent emits tabChange as plain `string`; narrow
    // it to the local union so the rest of the method stays type-safe.
    // Unrecognised ids are ignored so a misconfigured ScrollableTab
    // can't poison component state.
    if (
      f !== 'all' &&
      f !== 'overdue' &&
      f !== 'expiring' &&
      f !== 'new'
    ) {
      return;
    }
    this.quickFilter.set(f);
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

  // ── Options dropdown handlers (patrón imagen #18) ──────────────────

  /** Filters surfaced in the options-dropdown's "Filtros" popover. */
  filterConfigs: FilterConfig[] = [
    {
      key: 'pqr_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'PETITION', label: 'Petición' },
        { value: 'COMPLAINT', label: 'Queja' },
        { value: 'CLAIM', label: 'Reclamo' },
        { value: 'SUGGESTION', label: 'Sugerencia' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    {
      label: 'Exportar lista',
      icon: 'download',
      action: 'export',
    },
  ];

  /** Search input handler. */
  onSearch(query: string): void {
    this.searchInput.set(query);
    this.page.set(1);
    this.fetch();
  }

  /** Filter dropdown change — applies the selected pqr_type. */
  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.typeFilter = (values['pqr_type'] as any) ?? '';
    this.page.set(1);
    this.fetch();
  }

  /** Dropdown action click — currently only export placeholder. */
  onActionClick(_action: string): void {
    // No-op for now; real export wiring is out of scope.
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
            err?.error?.message ?? 'No se pudo cargar la lista de PQRS.',
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
import {
  Component,
  inject,
  signal,
  computed,
  DestroyRef,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  IconComponent,
  StatsComponent,
  StickyHeaderComponent,
  CardComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  PaginationComponent,
  ToastService,
} from '../../../../shared/components';
import type {
  FilterConfig,
  FilterValues,
  DropdownAction,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../shared/components';
import { StickyHeaderTab } from '../../../../shared/components/sticky-header/sticky-header.component';

/**
 * Super-admin global PQR list page (platform-wide compliance view).
 *
 * Audience: Vendix Corp operators (Super Admin). Cross-tenant visibility
 * for Peticiones / Quejas / Reclamos across every org/store on the
 * platform. Mirrors the store-admin PQR layout (sticky header → stats →
 * CTA card → list card with ResponsiveDataView) so the operator has a
 * single visual model across admin modules.
 *
 * Differences vs. store-admin PQR list:
 *   - Extra "Tienda" column (super-admin sees every store).
 *   - Search placeholder includes "tienda" so operators can find
 *     PQRs by tenant.
 *   - "Pendientes" quick-filter maps to "open status" — matches the
 *     store-admin semantic so the same label means the same thing in
 *     both views.
 *   - Search backend route is `/superadmin/support/pqrs` (not
 *     `/admin/support/pqr`) — the backend scopes by auth role, not
 *     by URL prefix.
 */
@Component({
  selector: 'app-superadmin-pqrs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    StatsComponent,
    StickyHeaderComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
  ],
  template: `
    <div class="pqr-list-page">
      <!-- ── Sticky header ─────────────────────────────────────────
           Glass surface that lives across all admin modules. Tabs
           inline so the platform operator can narrow the queue by
           bucket (Todas / Vencidas / Pendientes / Nuevas). -->
      <app-sticky-header
        title="Bandeja"
        subtitle="Vista global de la plataforma"
        icon="inbox"
        variant="glass"
        [showBackButton]="false"
        [tabs]="quickFilterTabs()"
        [activeTab]="quickFilter()"
        tabsAriaLabel="Filtros de PQRS"
        (tabChanged)="setQuickFilter($event)"
      />

      <!-- ── Stats grid ──────────────────────────────────────────────
           Mirrors the store-admin PQR cards. Hidden when total === 0
           so the page doesn't show four zeros to a brand-new
           platform. -->
      @if (stats() && stats()!.total > 0) {
      <div class="stats-container">
        <app-stats
          title="Total PQRS"
          [value]="stats()!.total"
          smallText="Todas las peticiones, quejas y reclamos"
          iconName="message-square"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Últimas 24h"
          [value]="stats()!.recent_24h"
          smallText="PQRS radicadas recientemente"
          iconName="clock"
          iconBgColor="bg-violet-100"
          iconColor="text-violet-600"
        ></app-stats>
        <app-stats
          title="Vencidas"
          [value]="overdueCount()"
          smallText="SLA legal agotado"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
        <app-stats
          title="Nuevas"
          [value]="stats()!.by_status?.['NEW'] || 0"
          smallText="Sin asignar a tienda"
          iconName="inbox"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>
      }

      <!-- ── List card ─────────────────────────────────────────────── -->
      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
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

        @if (!loading() && tickets().length > 0) {
        <div class="px-2 pb-2 pt-1 md:p-4">
          <app-responsive-data-view
            [data]="tickets()"
            [columns]="pqrColumns"
            [cardConfig]="pqrCardConfig"
            [actions]="pqrActions"
            [loading]="loading()"
            [hoverable]="true"
            [striped]="true"
            [emptyMessage]="
              typeFilter || searchInput() || quickFilter() !== 'all'
                ? 'No hay solicitudes con esos filtros'
                : 'Sin PQRS en la plataforma.'
            "
            [emptyIcon]="'inbox'"
            tableSize="md"
            (rowClick)="openPqr($event)"
          ></app-responsive-data-view>

          @if (totalPages() > 1) {
          <div class="mt-4 border-t border-border pt-4">
            <app-pagination
              [currentPage]="page()"
              [total]="total()"
              [limit]="limit"
              [totalPages]="totalPages()"
              infoStyle="none"
              (pageChange)="goToPage($event)"
            ></app-pagination>
          </div>
          }
        </div>
        }

        @if (!loading() && tickets().length === 0) {
        <div class="p-12 text-center text-gray-500">
          <app-icon
            name="inbox"
            [size]="48"
            class="mx-auto mb-4 text-gray-300"
          ></app-icon>
          <h3 class="text-lg font-medium text-gray-900">
            @if (typeFilter || searchInput() || quickFilter() !== 'all') {
              No hay PQRS con esos filtros
            } @else {
              Sin PQRS en la plataforma
            }
          </h3>
          <p class="mt-1 text-sm">
            @if (typeFilter || searchInput() || quickFilter() !== 'all') {
              Ajusta los filtros o limpia la búsqueda para ver todas las
              solicitudes.
            } @else {
              Cuando recibas nuevas solicitudes, aparecerán aquí.
            }
          </p>
        </div>
        }
      </app-card>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .pqr-list-page {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      // CTA card — same friendly copy as store-admin; tonal flip
      // (cta-card--urgent) when there are overdue PQRs in the queue.
      .cta-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 1.25rem 1.5rem;
      }
      .cta-card__main,
      .cta-card__empty {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .cta-card__lead {
        display: flex;
        align-items: center;
        gap: 1rem;
        width: 100%;
      }
      .cta-card__icon {
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: #dcfce7;
        color: #15803d;
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
      .cta-card--urgent {
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
    `,
  ],
})
export class SuperadminPqrsComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);
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

  /** Quick filter — drives the StickyHeader tabs at the top. */
  readonly quickFilter = signal<'all' | 'overdue' | 'pending' | 'new'>('all');

  typeFilter = '';
  readonly searchInput = signal('');

  /** Live count accessor for the list-card title. */
  totalListed = computed(() => this.tickets().length);

  /** Quick-filter tabs — match the store-admin visual contract 1:1. */
  quickFilterTabs = computed<StickyHeaderTab[]>(() => {
    return [
      { id: 'all', label: 'Todas', icon: 'inbox' },
      { id: 'overdue', label: 'Vencidas', icon: 'alert-triangle' },
      { id: 'pending', label: 'Pendientes', icon: 'clock' },
      { id: 'new', label: 'Nuevas', icon: 'plus' },
    ];
  });

  constructor() {
    this.fetch();
    this.fetchStats();

    // Debounced search — 300ms after typing stops. Avoids racing the
    // network on every keystroke.
    effect((onCleanup) => {
      const value = this.searchInput();
      const timer = setTimeout(() => {
        this.fetch();
      }, 300);
      onCleanup(() => clearTimeout(timer));
    });
  }

  setQuickFilter(filter: string | Event) {
    // StickyHeaderComponent emits tabChanged as Event; raw buttons
    // emit plain strings. Accept both and coerce.
    const raw = typeof filter === 'string' ? filter : '';
    if (
      raw !== 'all' &&
      raw !== 'overdue' &&
      raw !== 'pending' &&
      raw !== 'new'
    ) {
      return;
    }
this.quickFilter.set(raw);
    this.page.set(1);
    this.fetch();
  }

  clearAllFilters() {
    this.quickFilter.set('all');
    this.typeFilter = '';
    this.searchInput.set('');
    this.filterValues = {};
    this.page.set(1);
    this.fetch();
  }

  // ── Options dropdown ──────────────────────────────────────────────

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
  onActionClick(action: string): void {
    if (action === 'export') {
      this.toastService.info('Exportación próximamente');
    }
  }

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.fetch();
  }

  /** Click handler for ResponsiveDataView rows — Ver (read-only). */
  openPqr(row: any): void {
    if (!row?.id) return;
    this.router.navigate(['/super-admin/support/pqrs', row.id]);
  }

  /**
   * Click handler for the Editar action — passes `?edit=content` so the
   * detail page auto-opens the title / description / requester edit
   * modal. The intent travels via URL instead of a shared service so
   * hard refresh / share-link round-trips stay consistent.
   */
  editPqr(row: any): void {
    if (!row?.id) return;
    this.router.navigate(['/super-admin/support/pqrs', row.id], {
      queryParams: { edit: 'content' },
    });
  }

  // ── Display helpers ───────────────────────────────────────────────

  /** Spanish label for a PQR type/category enum value. */
  typeLabel(t: string): string {
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

  /** Spanish label for a PQR status enum value. */
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
   * SLA computation — Colombian regulatory limits:
   *   - PETITION: 15 business days (Ley 1755/2015 art. 14)
   *   - COMPLAINT / CLAIM: 10 business days (Ley 1474/2011 art. 55)
   *
   * Returns the days remaining plus a status bucket (ok / warn / overdue)
   * for color coding the SLA badge.
   */
  slaInfo(
    t: any,
  ): { remaining: number; limit: number; status: 'ok' | 'warn' | 'overdue' } {
    const limit = this.slaLimitFor(t.category);
    const created = t.created_at ? new Date(t.created_at) : new Date();
    const elapsed = businessDaysBetween(created, new Date());
    const remaining = limit - elapsed;
    if (remaining < 0) return { remaining, limit, status: 'overdue' };
    if (remaining <= 4) return { remaining, limit, status: 'overdue' };
    if (remaining <= 7) return { remaining, limit, status: 'warn' };
    return { remaining, limit, status: 'ok' };
  }

  /** Count of PQRs with overdue SLA — read from backend stats. */
  overdueCount(): number {
    return this.stats().overdue || 0;
  }

  /** Count of PQRs that still require action (open status). */
  pendingCount(): number {
    const s = this.stats().by_status || {};
    return (
      (s['NEW'] || 0) +
      (s['OPEN'] || 0) +
      (s['IN_PROGRESS'] || 0) +
      (s['WAITING_RESPONSE'] || 0) +
      (s['REOPENED'] || 0)
    );
  }

  /**
   * Returns a human-friendly label describing the last response on a PQR.
   * "Sin respuesta aún" / "Última respuesta: hoy/ayer/hace N días" /
   * "Última respuesta: {día} {mes}" for older entries.
   */
  lastResponseLabel(pqr: any): string {
    const firstResponse = pqr?.first_response_at;
    if (!firstResponse) return 'Sin respuesta aún';

    const date = new Date(firstResponse);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Última respuesta: hoy';
    if (diffDays === 1) return 'Última respuesta: ayer';
    if (diffDays < 30) return `Última respuesta: hace ${diffDays} días`;

    const months = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ];
    return `Última respuesta: ${date.getDate()} ${months[date.getMonth()]}`;
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

  // ── Quick filter predicate (client-side post-filter) ─────────────
  // Note: previous version had 'expiring' (SLA warn). Renamed to
  // 'pending' to align with the store-admin semantic — same label
  // now means the same thing in both views.
  private matchesQuickFilter(t: any, filter: 'overdue' | 'pending' | 'new'): boolean {
    switch (filter) {
      case 'overdue':
        return this.slaInfo(t).status === 'overdue';
      case 'pending':
        // "Pendientes" = open status awaiting action — matches
        // store-admin's filter exactly so the same tab means the
        // same thing across both views.
        return (
          t.status === 'NEW' ||
          t.status === 'OPEN' ||
          t.status === 'IN_PROGRESS' ||
          t.status === 'WAITING_RESPONSE' ||
          t.status === 'REOPENED'
        );
      case 'new':
        // "Nuevas" = unassigned to any store. The legacy PQRs created
        // via the public storefront have no `assigned_to` set, which
        // is exactly the operator's mental model: "Sin asignar".
        return !t.assigned_to;
    }
  }

  // ── Table column config (desktop ≥768px) ──────────────────────────
  // Order mirrors the screenshot: Ticket | Tipo | Asunto | Tienda |
  // SLA | Estado | Última respuesta | Radicada | Acciones. Tienda is
  // super-admin-only (multi-tenant scope); the rest match store-admin.

  pqrColumns: TableColumn[] = [
    {
      key: 'ticket_number',
      label: 'Ticket',
      sortable: true,
      priority: 0,
      cellClass: () => 'mono',
    },
    {
      key: 'category',
      label: 'Tipo',
      sortable: true,
      priority: 1,
      transform: (val: any) => this.typeLabel(val),
    },
    {
      key: 'title',
      label: 'Asunto',
      sortable: true,
      priority: 0,
      width: '260px',
    },
    {
      key: 'store',
      label: 'Tienda',
      sortable: false,
      priority: 2,
      transform: (val: any) => val?.name || 'No registrado',
    },
    {
      key: 'sla',
      label: 'SLA',
      priority: 1,
      transform: (_val: any, row?: any) => {
        if (!row) return '';
        const info = this.slaInfo(row);
        if (info.status === 'overdue') return `Vencido · ${-info.remaining}d`;
        return `${info.remaining}d`;
      },
      badge: true,
      badgeConfig: {
        type: 'custom' as const,
        size: 'sm' as const,
        colorFn: (_value: any, item?: any) => {
          if (!item) return null;
          const info = this.slaInfo(item);
          return (
            {
              ok: '#10b981',
              warn: '#f59e0b',
              overdue: '#dc2626',
            } as Record<string, string>
          )[info.status] ?? null;
        },
      },
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status' as const, size: 'sm' as const },
      badgeTransform: (val: any) => this.statusLabel(val),
    },
    {
      key: 'first_response_at',
      label: 'Última respuesta',
      sortable: true,
      priority: 2,
      transform: (_val: any, row?: any) =>
        row ? this.lastResponseLabel(row) : '',
    },
    {
      key: 'created_at',
      label: 'Radicada',
      sortable: true,
      priority: 2,
      transform: (val: any) =>
        val ? new Date(val).toLocaleDateString() : '-',
    },
  ];

  // ── Mobile card config (<768px) ──────────────────────────────────

  pqrCardConfig: ItemListCardConfig = {
    titleKey: 'title',
    titleTransform: (item: any) => item?.title ?? 'Sin asunto',
    subtitleKey: 'ticket_number',
    avatarFallbackIcon: 'message-circle',
    avatarShape: 'circle',
    badgeKey: 'status',
    badgeConfig: { type: 'status' as const, size: 'sm' as const },
    badgeTransform: (val: any) => this.statusLabel(val),
    detailKeys: [
      {
        key: 'category',
        label: 'Tipo',
        icon: 'tag',
        transform: (val: any) => this.typeLabel(val),
      },
      {
        key: 'store',
        label: 'Tienda',
        icon: 'store',
        transform: (val: any) => val?.name || 'No registrado',
      },
      {
        key: 'sla',
        label: 'SLA',
        icon: 'clock',
        transform: (_v: any, item?: any) => {
          if (!item) return '-';
          const info = this.slaInfo(item);
          if (info.status === 'overdue') return `Vencido · ${-info.remaining}d`;
          return `${info.remaining}d`;
        },
      },
      {
        key: 'created_at',
        label: 'Radicada',
        icon: 'calendar',
        transform: (val: any) =>
          val ? new Date(val).toLocaleDateString() : '-',
      },
    ],
  };

  // ── Row actions ──────────────────────────────────────────────────

  // Two actions: "Ver" (eye) and "Editar" (pencil). With ≤2 actions
  // ResponsiveDataView renders both inline in the row footer — no
  // overflow menu — matching the store-admin list exactly.
  pqrActions: TableAction[] = [
    {
      label: 'Ver',
      tooltip: 'Ver conversación',
      icon: 'eye',
      variant: 'secondary',
      action: (row: any) => this.openPqr(row),
    },
    {
      label: 'Editar',
      tooltip: 'Editar contenido (título, descripción, solicitante)',
      icon: 'edit',
      variant: 'info',
      // Navigates to the detail page with ?edit=content so the
      // destination auto-opens the title / description / requester
      // modal. Mirrors the "Editar" entry point already on the
      // detail page's header card.
      action: (row: any) => this.editPqr(row),
    },
  ];

  // ── Data fetchers ────────────────────────────────────────────────

  private fetch() {
    this.loading.set(true);
    this.errorMsg.set(null);

    let params = new HttpParams()
      .set('page', this.page().toString())
      .set('limit', this.limit.toString());

    if (this.typeFilter) params = params.set('pqr_type', this.typeFilter);
    if (this.searchInput().trim()) {
      params = params.set('search', this.searchInput().trim());
    }

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

        // Quick filter — client-side post-filter (mirrors store-admin).
        const qf = this.quickFilter();
        if (qf !== 'all') {
          data = data.filter((t: any) => this.matchesQuickFilter(t, qf));
        }

        this.tickets.set(data);
        // Quick filter overrides server-side pagination: show what the
        // user actually sees, not the unfiltered total.
        this.total.set(qf === 'all' ? (res.meta?.total ?? data.length) : data.length);
        this.totalPages.set(
          qf === 'all'
            ? (res.meta?.pages ?? 1)
            : 1,
        );
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
 * Counts business days between two dates (excludes Saturday + Sunday).
 * Naive loop — sufficient for the 10–15 day SLA windows in PQR
 * management. Future enhancement: integrate Colombian holiday calendar.
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

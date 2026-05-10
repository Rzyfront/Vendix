import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgPurchaseOrderRow,
  OrgPurchaseOrderStats,
  OrgPurchaseOrdersService,
} from '../../services/org-purchase-orders.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending: 'Pendiente',
  approved: 'Aprobada',
  in_transit: 'En tránsito',
  sent: 'Enviada',
  received: 'Recibida',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  pending: '#f59e0b',
  approved: '#3b82f6',
  in_transit: '#8b5cf6',
  sent: '#8b5cf6',
  received: '#22c55e',
  completed: '#22c55e',
  cancelled: '#ef4444',
};

/**
 * ORG_ADMIN — Listado consolidado de órdenes de compra org-wide.
 *
 * Sigue el patrón estándar `vendix-frontend-standard-module`:
 * stats sticky + búsqueda + ResponsiveDataView (tabla desktop / cards mobile).
 */
@Component({
  selector: 'vendix-org-purchase-orders-list',
  standalone: true,
  imports: [
    RouterModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  providers: [DatePipe, CurrencyPipe],
  template: `
    <div class="w-full">
      <!-- Stats row (sticky en mobile, estática en desktop) -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total ?? 0"
          smallText="Órdenes registradas"
          iconName="shopping-bag"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loadingStats()"
        />
        <app-stats
          title="Pendientes"
          [value]="stats().pending ?? 0"
          smallText="En espera de aprobación"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loadingStats()"
        />
        <app-stats
          title="Aprobadas"
          [value]="stats().approved ?? 0"
          smallText="Listas para recibir"
          iconName="check-circle"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-500"
          [loading]="loadingStats()"
        />
        <app-stats
          title="Recibidas"
          [value]="stats().received ?? 0"
          smallText="Mercancía ingresada"
          iconName="package-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loadingStats()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner
          variant="danger"
          title="No se pudieron cargar las órdenes"
          customClasses="mx-2 md:mx-4"
        >
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <!-- Sticky search/header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Órdenes de Compra ({{ filteredRows().length }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar por número, proveedor, tienda..."
                size="sm"
                [debounceTime]="200"
                (searchChange)="onSearch($event)"
              />
              <app-button
                variant="primary"
                size="sm"
                customClasses="!rounded-xl shrink-0"
                (clicked)="goCreate()"
              >
                Nueva OC
              </app-button>
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredRows()"
            [columns]="columns"
            [actions]="actions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyIcon="shopping-bag"
            emptyTitle="Sin órdenes de compra"
            emptyDescription="Crea tu primera orden de compra para abastecer cualquiera de tus tiendas."
            emptyActionText="Crear OC"
            emptyActionIcon="plus"
            [showEmptyAction]="true"
            (emptyActionClick)="goCreate()"
            (rowClick)="goDetail($event)"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgPurchaseOrdersListComponent {
  private readonly service = inject(OrgPurchaseOrdersService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly datePipe = inject(DatePipe);
  private readonly currencyPipe = inject(CurrencyPipe);

  readonly loading = signal(true);
  readonly loadingStats = signal(true);
  readonly rows = signal<OrgPurchaseOrderRow[]>([]);
  readonly stats = signal<OrgPurchaseOrderStats>({});
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');

  readonly filteredRows = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const list = this.rows();
    if (!term) return list;
    return list.filter((row) => {
      const haystack = [
        row.po_number,
        row.supplier_name,
        row.store_name,
        row.location_name,
        row.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  });

  readonly columns: TableColumn[] = [
    {
      key: 'po_number',
      label: 'Número',
      sortable: true,
      transform: (_value, row) =>
        row?.po_number ? row.po_number : `#${row?.id ?? ''}`,
    },
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      transform: (value) =>
        value ? this.datePipe.transform(value, 'short') ?? '-' : '-',
    },
    {
      key: 'supplier_name',
      label: 'Proveedor',
      sortable: true,
      transform: (value) => value || '—',
    },
    {
      key: 'store_name',
      label: 'Tienda',
      sortable: true,
      transform: (value) => value || '—',
    },
    {
      key: 'total',
      label: 'Total',
      sortable: true,
      align: 'right',
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      badgeConfig: {
        type: 'status',
        size: 'sm',
        colorFn: (value) =>
          STATUS_COLORS[String(value ?? '').toLowerCase()] ?? null,
      },
      transform: (value) => this.statusLabel(value),
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'ghost',
      action: (row: OrgPurchaseOrderRow) => this.goDetail(row),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'po_number',
    titleTransform: (row: OrgPurchaseOrderRow) =>
      row?.po_number ? row.po_number : `#${row?.id ?? ''}`,
    subtitleTransform: (row: OrgPurchaseOrderRow) =>
      [row.supplier_name || 'Sin proveedor', row.store_name]
        .filter(Boolean)
        .join(' · '),
    badgeKey: 'status',
    badgeTransform: (value) => this.statusLabel(value),
    badgeConfig: {
      type: 'status',
      size: 'sm',
      colorFn: (value) =>
        STATUS_COLORS[String(value ?? '').toLowerCase()] ?? null,
    },
    footerKey: 'total',
    footerTransform: (value) => this.formatMoney(value),
  };

  constructor() {
    this.load();
    this.loadStats();
  }

  load(): void {
    this.loading.set(true);
    this.service
      .findAll({ page: 1, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgPurchaseOrdersList] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(
              err,
              'No se pudieron cargar las órdenes de compra.',
            ),
          );
          this.loading.set(false);
        },
      });
  }

  loadStats(): void {
    this.loadingStats.set(true);
    this.service
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res?.data ?? {});
          this.loadingStats.set(false);
        },
        error: (err) => {
          // Stats failure is non-fatal — keep zeros silently.
          console.warn('[OrgPurchaseOrdersList] stats failed', err);
          this.loadingStats.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
  }

  goCreate(): void {
    this.router.navigate(['/admin/purchase-orders/create']);
  }

  goDetail(row: OrgPurchaseOrderRow): void {
    if (row?.id != null) {
      this.router.navigate(['/admin/purchase-orders', row.id]);
    }
  }

  private statusLabel(value: any): string {
    const key = String(value ?? '').toLowerCase();
    return STATUS_LABELS[key] ?? value ?? '—';
  }

  private formatMoney(value: any): string {
    const num =
      typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '—';
    return this.currencyPipe.transform(num) ?? `${num}`;
  }
}

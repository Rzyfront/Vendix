import {
  Component,
  DestroyRef,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  TableColumn,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';

import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchRouteMonitorRow } from '../../interfaces/planilla.interface';

// Custom-badge / cell colorMap: TableComponent + ItemListComponent resolve these
// to INLINE styles, so values MUST be 7-char hex colors (Tailwind class strings
// produce invalid inline styles and render colorless). Semantic P&L palette.
const MARGEN_POSITIVE = '#059669'; // emerald-600 — freight margin >= 0
const MARGEN_NEGATIVE = '#dc2626'; // red-600 — freight margin < 0 (loss)

const LIQUIDACION_LABELS: Record<string, string> = {
  paid: 'Pagado',
  pending: 'Pendiente',
};

const LIQUIDACION_COLORS: Record<string, string> = {
  paid: '#059669', // emerald-600 — settled
  pending: '#6b7280', // gray-500 — pending
};

@Component({
  selector: 'app-planilla-monitor',
  standalone: true,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
    SelectorComponent,
  ],
  template: `
    <div class="md:space-y-4">
      <app-card
        [responsive]="true"
        [padding]="false"
        overflow="visible"
      >
        <!-- Header (no search: the monitor endpoint only accepts page/limit) -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-1 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Monitor de flete ({{ totalItems() }})
            </h2>
            <p class="text-[11px] text-text-secondary md:text-xs">
              Mini-P&amp;L por ruta: recaudo, flete y margen de transporte.
            </p>
          </div>
        </div>

        <!-- Loading State -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando monitor...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!loading() && rows().length === 0) {
          <app-empty-state
            icon="truck"
            title="Sin datos de monitor"
            description="Cuando cierres o liquides planillas verás aquí el margen de flete por ruta."
            [showActionButton]="false"
          ></app-empty-state>
        }

        <!-- Monitor List -->
        @if (!loading() && rows().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="rows()"
              [columns]="tableColumns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [sortable]="true"
              (rowClick)="onRowClick($event)"
            ></app-responsive-data-view>

            <app-pagination
              [currentPage]="page()"
              [totalPages]="totalPages()"
              [total]="totalItems()"
              [limit]="limit()"
              infoStyle="range"
              (pageChange)="goToPage($event)"
            ></app-pagination>

            <!-- Page-size selector (system app-selector) -->
            <div class="flex items-center justify-end gap-2 mt-2 text-xs text-text-secondary">
              <label for="monitor-limit" class="shrink-0">Por página:</label>
              <app-selector
                [id]="'monitor-limit'"
                size="sm"
                class="w-20"
                [options]="limitSelectorOptions"
                [ngModel]="limit()"
                (ngModelChange)="onLimitChange($event)"
              ></app-selector>
            </div>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class PlanillaMonitorComponent implements OnInit {
  private readonly service = inject(PlanillasRutasService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<DispatchRouteMonitorRow[]>([]);
  readonly loading = signal(false);
  readonly page = signal(1);
  readonly totalPages = signal(1);
  readonly totalItems = signal(0);

  readonly limit = signal(20);
  readonly limitOptions = [10, 20, 50, 100];
  readonly limitSelectorOptions: SelectorOption[] = this.limitOptions.map(
    (n) => ({ value: n, label: String(n) }),
  );

  readonly tableColumns: TableColumn[] = [
    {
      key: 'route_number',
      label: 'Planilla',
      sortable: true,
      width: '140px',
      priority: 1,
    },
    {
      key: 'ejecutor',
      label: 'Ejecutor',
      defaultValue: '—',
      priority: 2,
    },
    {
      key: 'recaudo',
      label: 'Recaudo',
      align: 'right',
      priority: 2,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      key: 'ingreso_flete',
      label: 'Ingreso flete',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      key: 'costo_transporte',
      label: 'Costo transporte',
      align: 'right',
      priority: 2,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      // Freight margin: red text when negative (loss), emerald otherwise. The
      // cell renders even when value is 0 (0 passes the table's null/'' guard),
      // and cellStyle applies inline hex colors (Tailwind classes would break).
      key: 'margen_flete',
      label: 'Margen flete',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
      cellStyle: (value: any) => ({
        color: Number(value) < 0 ? MARGEN_NEGATIVE : MARGEN_POSITIVE,
        'font-weight': '600',
      }),
    },
    {
      key: 'estado_liquidacion',
      label: 'Estado liquidación',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: LIQUIDACION_COLORS,
      },
      transform: (value: string) => LIQUIDACION_LABELS[value] ?? value,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'route_number',
    titleTransform: (item: DispatchRouteMonitorRow) => item.route_number,
    subtitleTransform: (item: DispatchRouteMonitorRow) => item.ejecutor || '—',
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    // Freight margin is the colored badge (the only per-value colorable slot in
    // the mobile card): red when negative, emerald otherwise, text = amount.
    badgeKey: 'margen_flete',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorFn: (value: any) =>
        Number(value) < 0 ? MARGEN_NEGATIVE : MARGEN_POSITIVE,
    },
    badgeTransform: (value: any) => this.formatCurrency(value),
    footerKey: 'recaudo',
    footerLabel: 'Recaudo',
    footerStyle: 'prominent',
    footerTransform: (value: any) => this.formatCurrency(value),
    detailKeys: [
      {
        key: 'ingreso_flete',
        label: 'Ingreso flete',
        transform: (value: any) => this.formatCurrency(value),
      },
      {
        key: 'costo_transporte',
        label: 'Costo transporte',
        transform: (value: any) => this.formatCurrency(value),
      },
      {
        key: 'estado_liquidacion',
        label: 'Liquidación',
        transform: (value: any) => LIQUIDACION_LABELS[value] ?? value,
      },
    ],
  };

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.service
      .getMonitor({ page: this.page(), limit: this.limit() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.totalPages.set(res.pagination.totalPages);
          this.totalItems.set(res.pagination.total);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  /**
   * Change the page size (limit) and reload the monitor from page 1.
   */
  onLimitChange(limit: number): void {
    this.limit.set(limit);
    this.page.set(1);
    this.load();
  }

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  /** Opens the full planilla detail for the clicked monitor row. */
  onRowClick(row: DispatchRouteMonitorRow) {
    this.router.navigate(['/admin/orders/planillas', row.id]);
  }

  formatCurrency(value: any): string {
    const num_value =
      typeof value === 'string' ? parseFloat(value) : value || 0;
    return this.currencyService.format(num_value);
  }
}

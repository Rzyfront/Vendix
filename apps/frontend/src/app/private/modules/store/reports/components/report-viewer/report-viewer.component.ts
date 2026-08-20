import { Component, input, output, computed } from '@angular/core';
import { ReportColumn, ReportDefinition } from '../../interfaces/report.interface';
import { NestedReportComponent } from '../nested-report/nested-report.component';
import { DateRangeFilterComponent } from '../../../analytics/components/date-range-filter/date-range-filter.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  OptionsDropdownComponent,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  ResponsiveDataViewComponent,
  IconComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components';

interface StatCard {
  title: string;
  value: string | number;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

const TYPE_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  currency: { icon: 'dollar-sign', bg: 'bg-green-100', color: 'text-green-600' },
  number: { icon: 'hash', bg: 'bg-blue-100', color: 'text-blue-600' },
  percentage: { icon: 'percent', bg: 'bg-amber-100', color: 'text-amber-600' },
  text: { icon: 'file-text', bg: 'bg-purple-100', color: 'text-purple-600' },
  date: { icon: 'calendar', bg: 'bg-indigo-100', color: 'text-indigo-600' },
};

/**
 * Formatea una celda según el TIPO que el registro ya declara para su columna.
 *
 * Las definiciones de reporte siempre trajeron `type: 'currency' | 'percentage'
 * | ...`, pero la tabla sólo copiaba `key`, `label` y `align` y tiraba el tipo,
 * así que un valor monetario salía crudo — `1798354493.8632998` donde la tarjeta
 * de arriba, alimentada por el mismo dato, mostraba `$1.798.896.865`. Dos
 * lecturas distintas del mismo número en la misma pantalla.
 *
 * Un valor no numérico se devuelve tal cual: una columna mal tipada muestra su
 * texto, no un `0` inventado.
 */
function formatCellValue(value: any, type?: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('es-CO');
  }
  if (type !== 'currency' && type !== 'percentage' && type !== 'number') {
    return String(value);
  }
  const num = Number(value);
  if (isNaN(num)) return String(value);
  if (type === 'currency') {
    return (
      '$' +
      num.toLocaleString('es-CO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }
  if (type === 'percentage') {
    return (
      num.toLocaleString('es-CO', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }) + '%'
    );
  }
  return num.toLocaleString('es-CO');
}

function toTableColumns(columns: ReportColumn[]): TableColumn[] {
  return columns.map((col) => ({
    key: col.key,
    label: col.header,
    align: col.align,
    transform: (value: any) => formatCellValue(value, col.type),
  }));
}

function formatStatValue(value: any, type: string): string | number {
  if (value == null || value === undefined) return 0;
  const num = Number(value);
  if (isNaN(num)) return 0;
  if (type === 'currency') {
    return '$' + num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (type === 'percentage') {
    return num.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  if (type === 'number') {
    return num.toLocaleString('es-CO');
  }
  return String(value);
}

/**
 * Visor genérico de reportes (LIST / SUMMARY / NESTED).
 *
 * Layout canónico (alineado con `inventory-low-stock-by-supplier`):
 *   1. `<div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">` — wrapper.
 *   2. `<div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">`
 *      — strip de stats pegajoso en móvil, transparente en desktop.
 *   3. Banner de warning (cobertura de costo) — sibling del stats-container,
 *      nunca dentro de él, sin padding propio.
 *   4. `<app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">`
 *      con slot="header" (icono + título a la izquierda, controles a la derecha)
 *      y la paginación DENTRO de la card.
 *
 * El shell `<main class="shell-content">` ya impone 16/24px de padding; el
 * `:host` lo cancela para que el contenido se extienda al borde del sidebar.
 * Ver `report-viewer.component.scss`.
 */
@Component({
  selector: 'app-report-viewer',
  standalone: true,
  imports: [
    StatsComponent,
    NestedReportComponent,
    DateRangeFilterComponent,
    PaginationComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    OptionsDropdownComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- 1. Stats strip (sticky on mobile) -->
      @if (statsCards().length > 0) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          @for (stat of statsCards(); track stat.title) {
            <app-stats
              [title]="stat.title"
              [value]="stat.value"
              [iconName]="stat.iconName"
              [iconBgColor]="stat.iconBgColor"
              [iconColor]="stat.iconColor"
              [loading]="loading()"
            />
          }
        </div>
      }

      <!--
        2. Aviso de dato parcial — sibling del stats-container, NUNCA dentro de él.
        Sin padding propio: el wrapper space-y-6 ya separa bloques; los hijos
        cargan el "respiro" para que el icono y el texto no toquen los bordes.
      -->
      @if (coverageWarning(); as warning) {
        <div
          class="rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-start gap-2"
          role="alert"
          data-testid="coverage-warning"
        >
          <app-icon name="alert-circle" class="shrink-0 mt-0.5 p-1"></app-icon>
          <span class="flex-1 py-2 pr-3">{{ warning }}</span>
        </div>
      }

      <!-- 3. Data card — header con icono + título a la izquierda,
              controles (date-range + export) a la derecha. -->
      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <!-- Left: icon + heading -->
          <div class="flex items-center gap-2 min-w-0">
            <app-icon
              [name]="reportIcon()"
              [size]="20"
              class="shrink-0 text-[var(--color-primary)]"
            ></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">
              {{ report()?.title || 'Reporte' }}
              <span class="results-header__count text-xs md:text-sm text-text-secondary font-normal ml-2">
                @if (computedTotalItems() > 0) {
                  ({{ computedTotalItems() }} registros)
                }
              </span>
            </span>
          </div>

          <!-- Right: date-range (inline — OptionsDropdown no soporta date)
               + <app-options-dropdown> Acciones para el export. Mismo
               patrón canónico que el overview y el reporte low-stock-by-supplier. -->
          <div class="flex items-end gap-2 flex-wrap shrink-0">
            @if (report()?.requiresDateRange) {
              <vendix-date-range-filter
                [value]="dateRange()"
                (valueChange)="dateRangeChange.emit($event)"
              />
            }
            @if (report()?.exportEndpoint) {
              <app-options-dropdown
                [filters]="[]"
                [actions]="exportActions()"
                [showActions]="true"
                triggerLabel="Acciones"
                triggerIcon="plus"
                [isLoading]="exportLoading()"
                (actionClick)="onActionsDropdownClick($event)"
              ></app-options-dropdown>
            }
          </div>
        </div>

        <!-- Body: data view (list / summary / nested). -->
        <div class="p-4 space-y-3">
          @if (isForbidden()) {
            <div class="flex flex-col items-center justify-center py-20 text-text-secondary">
              <app-icon name="shield-off" [size]="48" />
              <p class="mt-4 text-sm font-medium">No tienes permisos para ver este reporte</p>
              <p class="mt-1 text-xs text-text-tertiary">Contacta al administrador para obtener acceso</p>
            </div>
          } @else if (report()?.type === 'nested') {
            <app-nested-report
              [data]="data()!"
              [columns]="report()!.columns"
            />
          } @else {
            <app-responsive-data-view
              [data]="paginatedData()"
              [columns]="tableColumns()"
              [cardConfig]="cardConfig()"
              [loading]="loading()"
              [striped]="true"
              tableSize="sm"
              emptyMessage="Sin datos disponibles para este reporte"
              emptyIcon="file-bar-chart"
            />
          }
        </div>

        <!-- Pagination — inside the table card, after the data view. -->
        @if (!loading() && !isForbidden() && computedTotalItems() > 0) {
          <div class="mt-4 flex justify-center">
            <app-pagination
              [currentPage]="currentPage()"
              [totalPages]="computedTotalPages()"
              [total]="computedTotalItems()"
              [limit]="itemsPerPage()"
              infoStyle="range"
              (pageChange)="pageChange.emit($event)"
            />
          </div>
        }
      </app-card>
    </div>
  `,
  styleUrls: ['./report-viewer.component.scss'],
})
export class ReportViewerComponent {
  readonly report = input<ReportDefinition | null>(null);
  readonly data = input<any[] | null>(null);
  readonly summaryData = input<Record<string, any> | null>(null);
  readonly loading = input<boolean>(false);
  readonly isForbidden = input<boolean>(false);
  readonly currentPage = input<number>(1);
  readonly totalPages = input<number>(0);
  readonly totalItems = input<number>(0);
  readonly itemsPerPage = input<number>(10);

  readonly dateRangeChange = output<any>();
  readonly pageChange = output<number>();
  readonly exportClick = output<void>();

  readonly exportLoading = input<boolean>(false);
  readonly dateRange = input<any>(undefined);

  /**
   * Ícono del header de la data card. Toma `report().icon` (Lucide) y cae al
   * default `file-text` si el reporte no declara uno. Se pasa por
   * `<app-icon [name]>` que resuelve al `ICON_REGISTRY` y cae a default si
   * el nombre no existe — sin lanzar excepciones.
   */
  readonly reportIcon = computed<string>(() => {
    return this.report()?.icon || 'file-text';
  });

  /**
   * Acción expuesta en el `<app-options-dropdown>` "Acciones" del header.
   * Hoy solo `Exportar XLSX`; la estructura queda abierta para añadir más
   * (ej. imprimir, refrescar) sin tocar la plantilla.
   */
  readonly exportActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'ExportAR XLSX',
      icon: 'download',
    },
  ]);

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportClick.emit();
    }
  }

  /**
   * Texto del aviso de valuación parcial, o `null` si el informe no trae
   * cobertura o la cobertura es total. Se alimenta de `meta.cost_coverage`, el
   * mismo contrato que ya usan el panel principal y el resumen de analíticas.
   */
  readonly coverageWarning = computed<string | null>(() => {
    const coverage = this.summaryData()?.['cost_coverage'];
    if (!coverage) return null;

    const total = Number(coverage.units_total) || 0;
    const without = Number(coverage.units_without_cost) || 0;
    if (total <= 0 || without <= 0) return null;

    const pct = Math.round((Number(coverage.coverage_ratio) || 0) * 100);
    return (
      `Valuación PARCIAL: ${without.toLocaleString('es-CO')} de ` +
      `${total.toLocaleString('es-CO')} unidades no tienen costo registrado ` +
      `(cobertura ${pct} %). El valor mostrado está SUBESTIMADO hasta que se ` +
      `registre ese costo.`
    );
  });

  readonly statsCards = computed<StatCard[]>(() => {
    const report = this.report();
    const data = this.data();
    const summaryData = this.summaryData();
    if (!report || !report.stats) return [];

    const source = summaryData || {};
    const hasSourceData = Object.keys(source).length > 0;

    return report.stats.map((s) => {
      const ic = TYPE_ICONS[s.type] || TYPE_ICONS['number'];
      let value: string | number = '-';

      if (hasSourceData && source[s.key] != null) {
        value = formatStatValue(source[s.key], s.type);
      } else if (data && data.length > 0) {
        const sum = data.reduce((acc, row) => {
          const v = Number(row[s.key]);
          return isNaN(v) ? acc : acc + v;
        }, 0);
        value = formatStatValue(sum, s.type);
      }

      return {
        title: s.label,
        value,
        iconName: s.icon || ic.icon,
        iconBgColor: ic.bg,
        iconColor: ic.color,
      };
    });
  });

  readonly paginatedData = computed(() => {
    const d = this.data();
    if (!d || d.length === 0) return [];
    const start = (this.currentPage() - 1) * this.itemsPerPage();
    return d.slice(start, start + this.itemsPerPage());
  });

  readonly computedTotalItems = computed(() => {
    const d = this.data();
    return this.totalItems() || (d ? d.length : 0);
  });

  readonly computedTotalPages = computed(() => {
    const total = this.computedTotalItems();
    return total > 0 ? Math.max(1, Math.ceil(total / this.itemsPerPage())) : 1;
  });

  readonly tableColumns = computed<TableColumn[]>(() => {
    const cols = this.report()?.columns;
    if (cols && cols.length > 0) return toTableColumns(cols);

    // Auto-generate columns from data keys when none defined
    const d = this.data();
    if (!d || d.length === 0) return [];
    const keys = Object.keys(d[0]).filter(k => !k.startsWith('_'));
    return keys.map(k => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));
  });

  readonly cardConfig = computed<ItemListCardConfig>(() => {
    const cols = this.report()?.columns || [];
    const titleCol = cols.find((c) => c.type === 'text');
    const subtitleCol = cols.find((c) => c.type === 'text' && c !== titleCol);
    const badgeCol = cols.find((c) => c.key === 'status' || c.key === 'state');
    const footerCol = cols.find((c) => c.type === 'currency');
    return {
      titleKey: titleCol?.key || cols[0]?.key || 'id',
      subtitleKey: subtitleCol?.key,
      badgeKey: badgeCol?.key,
      footerKey: footerCol?.key,
      footerLabel: footerCol?.header || '',
      footerStyle: footerCol ? 'prominent' : undefined,
      detailKeys: cols
        .filter((c) => c.type === 'number' || c.type === 'percentage')
        .slice(0, 2)
        .map((c) => ({ key: c.key, label: c.header })),
    };
  });
}
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Subject, catchError, of, switchMap, tap } from 'rxjs';

import {
  CardComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  SortDirection,
  StatsComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { DateRangeFilterComponent } from '../../../../../../shared/components/date-range-filter/date-range-filter.component';
import { DateRangeFilter } from '../../../../../../shared/interfaces/date-range-filter.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  formatDateOnlyUTC,
  formatStoreDateTime,
  storeToday,
} from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { Supplier } from '../../../inventory/interfaces/inventory.interface';

import {
  SupportDocumentReportRow,
  SupportDocumentsReportQuery,
  SupportDocumentsSortBy,
  SupportDocumentsSummary,
  SupportReportDocumentType,
  SupportReportStatus,
} from '../../interfaces/support-documents-report.interface';
import { SupportDocumentsReportService } from '../../services/support-documents-report.service';
import { ReportExportService } from '../../services/report-export.service';
import { selectDateRange } from '../../state/reports.selectors';
import { getDefaultDateRange } from '../../state/reports.state';

const PAGE_LIMIT = 25;

export const SUPPORT_STATUS_LABELS: Record<SupportReportStatus, string> = {
  draft: 'Borrador',
  validated: 'Validado',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  voided: 'Anulado',
};

export const SUPPORT_TYPE_LABELS: Record<SupportReportDocumentType, string> = {
  support_document: 'Documento soporte',
  support_adjustment_note: 'Nota de ajuste',
};

/** Mismos colores que el listado de documentos soporte (facturación). */
const STATUS_BADGE: NonNullable<TableColumn['badgeConfig']> = {
  type: 'custom',
  size: 'sm',
  colorMap: {
    draft: 'var(--color-text-muted)',
    validated: 'var(--color-info)',
    sent: 'var(--color-info)',
    accepted: 'var(--color-success)',
    rejected: 'var(--color-error)',
    cancelled: 'var(--color-warning)',
    voided: 'var(--color-text-muted)',
  },
};

const SORTABLE: readonly SupportDocumentsSortBy[] = [
  'issue_date',
  'total_amount',
  'invoice_number',
  'status',
];

/** Fila aplanada para la tabla. */
interface SupportDocumentViewRow {
  id: number;
  issue_date: string;
  type_label: string;
  invoice_number: string;
  supplier_name: string;
  supplier_tax_id: string;
  status: SupportReportStatus;
  related_invoice_number: string;
  subtotal_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  accepted_at: string | null;
  counts_label: string;
}

const isStatus = (v: string): v is SupportReportStatus =>
  Object.prototype.hasOwnProperty.call(SUPPORT_STATUS_LABELS, v);
const isType = (v: string): v is SupportReportDocumentType =>
  Object.prototype.hasOwnProperty.call(SUPPORT_TYPE_LABELS, v);
const asArray = (v: FilterValues[string]): string[] =>
  Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];

/**
 * Reporte «Documentos soporte» (STORE_ADMIN, categoría Compras): documentos
 * soporte y notas de ajuste con filtros de período (zona de la tienda),
 * proveedor, estado y tipo; totales soporte vs ajuste sin anulados ni
 * cancelados; tabla paginada en servidor y export XLSX del dataset completo.
 */
@Component({
  selector: 'vendix-support-documents-report-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    DateRangeFilterComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  templateUrl: './support-documents-report-page.component.html',
})
export class SupportDocumentsReportPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(SupportDocumentsReportService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly exportService = inject(ReportExportService);
  private readonly toast = inject(ToastService);
  private readonly store = inject(Store);

  // ── Estado ──────────────────────────────────────────────────────────────
  /**
   * Arranca con el período que traen las demás pestañas de Compras. Solo se
   * lee: despachar `setDateRange` recargaría el reporte genérico anterior.
   */
  readonly dateRange = signal<DateRangeFilter>(
    this.store.selectSignal(selectDateRange)() ?? getDefaultDateRange(),
  );
  readonly statuses = signal<SupportReportStatus[]>([]);
  readonly types = signal<SupportReportDocumentType[]>([]);
  readonly supplierId = signal<number | null>(null);
  readonly page = signal(1);
  readonly limit = PAGE_LIMIT;
  readonly sortBy = signal<SupportDocumentsSortBy | null>(null);
  readonly sortOrder = signal<'asc' | 'desc'>('desc');

  readonly rows = signal<SupportDocumentReportRow[]>([]);
  readonly summary = signal<SupportDocumentsSummary | null>(null);
  readonly totalItems = signal(0);
  readonly totalPages = signal(0);
  readonly loading = signal(false);
  readonly loadingSummary = signal(false);
  readonly exporting = signal(false);
  readonly suppliers = signal<Supplier[]>([]);

  readonly filterValues = computed<FilterValues>(() => {
    const supplier = this.supplierId();
    return {
      status: [...this.statuses()],
      invoice_type: [...this.types()],
      supplier_id: supplier ? String(supplier) : null,
    };
  });

  readonly hasFilters = computed(
    () =>
      this.statuses().length > 0 ||
      this.types().length > 0 ||
      this.supplierId() !== null ||
      this.dateRange().preset !== 'thisMonth',
  );

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'invoice_type',
      label: 'Tipo',
      type: 'multi-select',
      placeholder: 'Soporte y ajustes',
      options: Object.entries(SUPPORT_TYPE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    },
    {
      key: 'status',
      label: 'Estado',
      type: 'multi-select',
      placeholder: 'Todos los estados',
      options: Object.entries(SUPPORT_STATUS_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    },
    {
      key: 'supplier_id',
      label: 'Proveedor',
      type: 'select',
      placeholder: 'Todos los proveedores',
      options: this.suppliers().map((s) => ({
        value: String(s.id),
        label: s.tax_id ? `${s.name} (${s.tax_id})` : s.name,
      })),
    },
  ]);

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      label: this.exporting() ? 'Exportando…' : 'Exportar XLSX',
      icon: 'download',
      action: 'export-xlsx',
      variant: 'outline',
      disabled: this.exporting() || this.loading(),
    },
  ]);

  readonly viewRows = computed<SupportDocumentViewRow[]>(() =>
    this.rows().map((r) => ({
      id: r.id,
      issue_date: r.issue_date,
      type_label: SUPPORT_TYPE_LABELS[r.invoice_type] ?? r.invoice_type,
      invoice_number: r.invoice_number ?? '',
      supplier_name: r.supplier_name,
      supplier_tax_id: r.supplier_tax_id ?? '',
      status: r.status,
      related_invoice_number: r.related_invoice_number ?? '',
      subtotal_amount: r.subtotal_amount,
      tax_amount: r.tax_amount,
      withholding_amount: r.withholding_amount,
      total_amount: r.total_amount,
      accepted_at: r.accepted_at,
      counts_label: r.counts_in_totals ? 'Sí' : 'No',
    })),
  );

  readonly countText = computed(() => {
    const s = this.summary();
    if (!s) return 'Soporte y ajustes del período';
    return `${s.support.count} soporte · ${s.adjustment.count} ajuste · ${s.excluded_count} anulados/cancelados fuera`;
  });

  readonly totalText = computed(() => {
    const s = this.summary();
    if (!s) return 'Soporte − ajustes';
    return `Soporte ${this.money(s.support.total_amount)} − ajustes ${this.money(s.adjustment.total_amount)}`;
  });

  readonly taxText = computed(() => {
    const s = this.summary();
    if (!s) return 'Soporte − ajustes';
    return `Retenciones netas ${this.money(s.net.withholding_amount)}`;
  });

  // ── Config de tabla ─────────────────────────────────────────────────────
  private readonly money = (v: unknown): string =>
    this.currencyService.format(Number(v ?? 0));
  private readonly dash = (v: unknown): string =>
    v === null || v === undefined || v === '' ? '—' : String(v);
  private readonly issueDate = (v: unknown): string =>
    v ? formatDateOnlyUTC(String(v)) : '—';
  private readonly acceptedAt = (v: unknown): string =>
    v ? formatStoreDateTime(String(v), this.settingsFacade.timezone()) : '—';
  private readonly statusLabel = (v: unknown): string =>
    SUPPORT_STATUS_LABELS[v as SupportReportStatus] ?? String(v);

  readonly columns: TableColumn[] = [
    { key: 'issue_date', label: 'Fecha emisión', sortable: true, priority: 1, transform: this.issueDate },
    { key: 'type_label', label: 'Tipo', priority: 2 },
    { key: 'invoice_number', label: 'Número', sortable: true, priority: 1, transform: this.dash },
    { key: 'supplier_name', label: 'Proveedor', priority: 1, transform: this.dash },
    { key: 'supplier_tax_id', label: 'NIT / Documento', priority: 3, transform: this.dash },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      priority: 1,
      badge: true,
      badgeConfig: STATUS_BADGE,
      transform: this.statusLabel,
    },
    { key: 'related_invoice_number', label: 'Documento original', priority: 3, transform: this.dash },
    { key: 'subtotal_amount', label: 'Subtotal', align: 'right', priority: 2, transform: this.money },
    { key: 'tax_amount', label: 'Impuestos', align: 'right', priority: 2, transform: this.money },
    { key: 'withholding_amount', label: 'Retenciones', align: 'right', priority: 3, transform: this.money },
    { key: 'total_amount', label: 'Total', sortable: true, align: 'right', priority: 1, transform: this.money },
    { key: 'accepted_at', label: 'Aceptado DIAN', priority: 3, transform: this.acceptedAt },
    { key: 'counts_label', label: 'En totales', align: 'center', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    titleTransform: (item) => item.invoice_number || 'Sin número',
    subtitleKey: 'supplier_name',
    badgeKey: 'status',
    badgeConfig: STATUS_BADGE,
    badgeTransform: this.statusLabel,
    detailKeys: [
      { key: 'type_label', label: 'Tipo', icon: 'file-text' },
      { key: 'total_amount', label: 'Total', icon: 'wallet', transform: this.money },
      { key: 'issue_date', label: 'Fecha', icon: 'calendar', transform: this.issueDate },
      { key: 'counts_label', label: 'En totales', icon: 'percent' },
    ],
  };

  // ── Carga ───────────────────────────────────────────────────────────────
  private readonly reload$ = new Subject<void>();
  private readonly reloadSummary$ = new Subject<void>();

  constructor() {
    this.reload$
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(() =>
          this.service.getList(this.currentQuery()).pipe(
            catchError((err) => {
              this.toast.error(
                extractApiErrorMessage(err) ||
                  'No se pudieron cargar los documentos soporte',
              );
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.loading.set(false);
        this.rows.set(res?.data ?? []);
        this.totalItems.set(res?.meta?.total ?? 0);
        this.totalPages.set(res?.meta?.totalPages ?? 0);
      });

    this.reloadSummary$
      .pipe(
        tap(() => this.loadingSummary.set(true)),
        switchMap(() =>
          this.service.getSummary(this.currentQuery()).pipe(
            catchError(() => of(null)),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((s) => {
        this.loadingSummary.set(false);
        this.summary.set(s);
      });

    // Incluye proveedores inactivos: el período puede traer documentos suyos.
    this.suppliersService
      .getSuppliers({ limit: 500 })
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.suppliers.set(res?.data ?? []));

    this.reloadAll();
  }

  /**
   * Filtros -> query. Los presets viajan por nombre y el backend los resuelve
   * en la zona de la tienda; un rango propio o un día viajan como fechas.
   */
  currentQuery(): SupportDocumentsReportQuery {
    const range = this.dateRange();
    const query: SupportDocumentsReportQuery = {
      page: this.page(),
      limit: this.limit,
    };
    if (range.preset && range.preset !== 'custom' && range.preset !== 'day') {
      query.date_preset = range.preset;
    } else {
      query.date_preset = 'custom';
      query.date_from = range.start_date;
      query.date_to = range.end_date;
    }
    if (this.statuses().length) query.status = [...this.statuses()];
    if (this.types().length) query.invoice_type = [...this.types()];
    const supplier = this.supplierId();
    if (supplier) query.supplier_id = supplier;
    const sort = this.sortBy();
    if (sort) {
      query.sort_by = sort;
      query.sort_order = this.sortOrder();
    }
    return query;
  }

  private reloadAll(): void {
    this.page.set(1);
    this.reload$.next();
    this.reloadSummary$.next();
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  onDateRangeChange(range: DateRangeFilter): void {
    if (!range?.start_date || !range?.end_date) return;
    const cur = this.dateRange();
    if (
      cur.start_date === range.start_date &&
      cur.end_date === range.end_date &&
      cur.preset === range.preset
    ) {
      return;
    }
    this.dateRange.set(range);
    this.reloadAll();
  }

  onFilterChange(values: FilterValues): void {
    this.statuses.set(asArray(values['status']).filter(isStatus));
    this.types.set(asArray(values['invoice_type']).filter(isType));
    const supplier = Number(values['supplier_id']);
    this.supplierId.set(Number.isInteger(supplier) && supplier > 0 ? supplier : null);
    this.reloadAll();
  }

  onClearAll(): void {
    this.dateRange.set(getDefaultDateRange());
    this.statuses.set([]);
    this.types.set([]);
    this.supplierId.set(null);
    this.reloadAll();
  }

  onSort(event: { column: string; direction: SortDirection }): void {
    const column = event.column as SupportDocumentsSortBy;
    if (!event.direction || !SORTABLE.includes(column)) {
      this.sortBy.set(null);
      this.sortOrder.set('desc');
    } else {
      this.sortBy.set(column);
      this.sortOrder.set(event.direction);
    }
    this.page.set(1);
    this.reload$.next();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.reload$.next();
  }

  onActionClick(action: string): void {
    if (action === 'export-xlsx') this.exportXlsx();
  }

  private exportXlsx(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    // Dataset completo: sin page/limit (el backend exporta todo el rango).
    const query = this.currentQuery();
    delete query.page;
    delete query.limit;
    this.service
      .exportXlsx(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          this.exportService.downloadBlob(
            blob,
            `documentos_soporte_${storeToday(this.settingsFacade.timezone())}`,
          );
        },
        error: (err) => {
          this.exporting.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo exportar el reporte',
          );
        },
      });
  }

  formatMoney(v: number | null | undefined): string {
    return this.money(v);
  }
}

import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  TemplateRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';

import { SupportDocumentService } from '../../services/support-document.service';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { supportStatusLabel, supportTypeLabel } from './support-document-status.util';
import type {
  SupportDocumentQuery,
  SupportDocumentRow,
  SupportDocumentStatus,
  SupportDocumentType,
} from '../../interfaces/support-document.interface';
import type {
  SelectorOption,
  DropdownAction,
  FilterConfig,
  FilterValues,
  ItemListCardConfig,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { describeApiFailure } from '../../utils/invoicing-errors.util';

interface SupportDocumentFilters {
  page: number;
  limit: number;
  search: string;
  status: SupportDocumentStatus | '';
  invoice_type: SupportDocumentType;
  cuds: string;
  date_from: string;
  date_to: string;
  supplier_id: number | null;
}

/** Lista server-side de documentos soporte (QUI-682). */
@Component({
  selector: 'app-support-document-list',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    CardComponent,
    ButtonComponent,
    InputComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    IconComponent,
  ],
  templateUrl: './support-document-list.component.html',
})
export class SupportDocumentListComponent {
  /** Filtro inicial (ej: si el padre quiere aterrizar con `?supplier_id=42`). */
  readonly initialSupplierId = input<number | null>(null);

  /** Eventos hacia arriba: crear, refrescar, ver detalle. */
  readonly create = output<void>();
  readonly refresh = output<void>();
  readonly view = output<SupportDocumentRow>();

  private readonly service = inject(SupportDocumentService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<SupportDocumentQuery>();

  /** Celda «OC de origen»: enlace al detalle de la orden de compra. */
  readonly purchaseOrderTemplate = viewChild<TemplateRef<unknown>>('purchaseOrderTemplate');
  /** Proveedores para el filtro; si la carga falla el filtro queda sin opciones. */
  readonly supplierOptions = signal<SelectorOption[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<SupportDocumentRow[]>([]);
  readonly totalItems = signal(0);
  readonly filters = signal<SupportDocumentFilters>({
    page: 1,
    limit: 10,
    search: '',
    status: '',
    invoice_type: 'support_document',
    cuds: '',
    date_from: '',
    date_to: '',
    supplier_id: null,
  });
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );
  readonly filterValues = computed<FilterValues>(() => {
    const filters = this.filters();
    return {
      status: filters.status || null,
      invoice_type: filters.invoice_type,
      supplier_id: filters.supplier_id != null ? String(filters.supplier_id) : null,
      date_from: filters.date_from || null,
      date_to: filters.date_to || null,
    };
  });

  /** ngModel accessor keeps the shared search CVA synchronized with signal state. */
  get searchTerm(): string {
    return this.filters().search;
  }

  set searchTerm(term: string) {
    this.filters.update((current) => ({ ...current, search: term }));
  }

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'validated', label: 'Validado' },
        { value: 'sent', label: 'Enviado' },
        { value: 'accepted', label: 'Aceptado' },
        { value: 'rejected', label: 'Rechazado' },
        { value: 'cancelled', label: 'Cancelado' },
        { value: 'voided', label: 'Anulado' },
      ],
    },
    {
      key: 'invoice_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: 'support_document', label: 'Documento soporte' },
        { value: 'support_adjustment_note', label: 'Nota de ajuste' },
      ],
      defaultValue: 'support_document',
    },
    {
      key: 'supplier_id',
      label: 'Proveedor',
      type: 'select',
      options: [{ value: '', label: 'Todos los proveedores' }, ...this.supplierOptions()],
    },
    { key: 'date_from', label: 'Desde', type: 'date' },
    { key: 'date_to', label: 'Hasta', type: 'date' },
  ]);

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Nuevo documento soporte', icon: 'plus', action: 'create', variant: 'primary' },
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh' },
  ];

  constructor() {
    this.suppliersService
      .getSuppliers({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) =>
          this.supplierOptions.set(
            (response?.data ?? []).map((supplier) => ({
              value: String(supplier.id),
              label: supplier.name,
            })),
          ),
        error: () => this.supplierOptions.set([]),
      });

    // La plantilla de la celda se engancha a la columna cuando la vista la resuelve.
    effect(() => {
      const template = this.purchaseOrderTemplate();
      const column = this.columns.find((col) => col.key === 'purchase_order');
      if (template && column) column.template = template;
    });

    this.requests
      .pipe(
        switchMap((query) =>
          this.service.list(query).pipe(
            catchError((err: unknown) => {
              this.error.set(this.extractError(err));
              this.rows.set([]);
              this.totalItems.set(0);
              this.loading.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.rows.set(response.data ?? []);
          this.totalItems.set(response.meta?.total ?? 0);
          if (this.filters().page > this.totalPages()) {
            this.filters.update((current) => ({ ...current, page: this.totalPages() }));
            this.load();
            return;
          }
          this.loading.set(false);
          this.error.set(null);
        },
      });

    let initialized = false;
    effect(() => {
      const supplierId = this.initialSupplierId();
      untracked(() => {
        if (!initialized) {
          initialized = true;
          this.filters.update((current) => ({
            ...current,
            supplier_id: supplierId,
            page: 1,
          }));
          this.load();
          return;
        }

        if (this.filters().supplier_id !== supplierId) {
          this.filters.update((current) => ({
            ...current,
            supplier_id: supplierId,
            page: 1,
          }));
          this.load();
        }
      });
    });
  }

  /** Carga pública conservada para que el padre refresque tras crear. */
  load(): void {
    const filters = this.filters();
    const query: SupportDocumentQuery = {
      page: filters.page,
      limit: filters.limit,
      search: filters.search || undefined,
      status: filters.status || undefined,
      invoice_type: filters.invoice_type,
      cuds: filters.cuds || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      supplier_id: filters.supplier_id ?? undefined,
    };
    this.loading.set(true);
    this.error.set(null);
    this.requests.next(query);
  }

  private extractError(err: unknown): string {
    return (
      describeApiFailure(err).message ||
      'No se pudo cargar el listado de documentos soporte.'
    );
  }

  onSearch(term: string): void {
    if (term !== this.filters().search) return;
    this.filters.update((current) => ({ ...current, search: term, page: 1 }));
    this.load();
  }

  onCudsChange(cuds: string): void {
    this.filters.update((current) => ({ ...current, cuds, page: 1 }));
    this.load();
  }

  onFilterChange(values: FilterValues): void {
    const status = this.statusFromFilter(values['status']);
    const invoiceType = this.typeFromFilter(values['invoice_type']);
    this.filters.update((current) => ({
      ...current,
      status,
      invoice_type: invoiceType,
      supplier_id: this.supplierFromFilter(values['supplier_id']),
      date_from: this.stringFilterValue(values['date_from']),
      date_to: this.stringFilterValue(values['date_to']),
      page: 1,
    }));
    this.load();
  }

  private stringFilterValue(value: FilterValues[string]): string {
    return typeof value === 'string' ? value : '';
  }

  private statusFromFilter(value: FilterValues[string]): SupportDocumentStatus | '' {
    const statuses: SupportDocumentStatus[] = [
      'draft', 'validated', 'sent', 'accepted', 'rejected', 'cancelled', 'voided',
    ];
    return typeof value === 'string'
      ? statuses.find((status) => status === value) ?? ''
      : '';
  }

  private supplierFromFilter(value: FilterValues[string]): number | null {
    if (typeof value !== 'string' || value === '') return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private typeFromFilter(value: FilterValues[string]): SupportDocumentType {
    return value === 'support_adjustment_note'
      ? 'support_adjustment_note'
      : 'support_document';
  }

  clearFilters(): void {
    this.filters.set({
      page: 1,
      limit: this.filters().limit,
      search: '',
      status: '',
      invoice_type: 'support_document',
      cuds: '',
      date_from: '',
      date_to: '',
      supplier_id: this.initialSupplierId(),
    });
    this.load();
  }

  onPageChange(page: number): void {
    const nextPage = Number.isFinite(page)
      ? Math.min(Math.max(1, Math.trunc(page)), this.totalPages())
      : 1;
    this.filters.update((current) => ({ ...current, page: nextPage }));
    this.load();
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.onCreate();
    } else if (action === 'refresh') {
      this.refresh.emit();
      this.load();
    }
  }

  onCreate(): void {
    this.create.emit();
  }

  onView(row: SupportDocumentRow): void {
    this.view.emit(row);
  }

  readonly columns: TableColumn[] = [
    { key: 'invoice_number', label: 'N° Documento', priority: 1 },
    {
      key: 'invoice_type',
      label: 'Tipo',
      priority: 2,
      transform: (value: unknown) => this.getTypeLabel(String(value)),
    },
    {
      key: 'customer_name',
      label: 'Proveedor',
      priority: 1,
      transform: (value: unknown, row?: SupportDocumentRow) =>
        (typeof value === 'string' && value) || row?.customer_name || 'Sin proveedor',
    },
    {
      key: 'purchase_order',
      label: 'OC de origen',
      priority: 2,
      // Texto de respaldo; la celda real es el enlace de #purchaseOrderTemplate.
      transform: (value: unknown) => this.purchaseOrderNumber(value),
    },
    {
      key: 'cufe',
      label: 'CUDS',
      priority: 3,
      transform: (value: unknown) => this.formatCuds(String(value ?? '')),
    },
    {
      key: 'total_amount',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (value: unknown) =>
        this.currencyService.format(Number(value) || 0),
    },
    {
      key: 'issue_date',
      label: 'Fecha',
      align: 'center',
      priority: 2,
      transform: (value: unknown) =>
        value ? formatDateOnlyUTC(String(value)) : '',
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          draft: 'var(--color-text-muted)',
          validated: 'var(--color-info)',
          sent: 'var(--color-info)',
          accepted: 'var(--color-success)',
          rejected: 'var(--color-error)',
          cancelled: 'var(--color-text-muted)',
          voided: 'var(--color-warning)',
        },
      },
      transform: (value: unknown) => this.getStatusLabel(String(value)),
      badgeTransform: (value: unknown) => this.getStatusLabel(String(value)),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    subtitleTransform: (item: SupportDocumentRow) =>
      item?.customer_name || 'Sin proveedor',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        draft: 'var(--color-text-muted)',
        validated: 'var(--color-info)',
        sent: 'var(--color-info)',
        accepted: 'var(--color-success)',
        rejected: 'var(--color-error)',
        cancelled: 'var(--color-text-muted)',
        voided: 'var(--color-warning)',
      },
    },
    badgeTransform: (value: unknown) => this.getStatusLabel(String(value)),
    footerKey: 'total_amount',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (value: unknown) =>
      this.currencyService.format(Number(value) || 0),
    detailKeys: [
      {
        key: 'issue_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (value: unknown) =>
          value ? formatDateOnlyUTC(String(value)) : '-',
      },
      {
        key: 'invoice_type',
        label: 'Tipo',
        icon: 'file-text',
        transform: (value: unknown) => this.getTypeLabel(String(value)),
      },
      {
        key: 'purchase_order',
        label: 'OC de origen',
        icon: 'shopping-cart',
        transform: (value: unknown) => this.purchaseOrderNumber(value),
      },
      {
        key: 'cufe',
        label: 'CUDS',
        icon: 'hash',
        transform: (value: unknown) => this.formatCuds(String(value ?? '')),
      },
    ],
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'primary',
      action: (row: SupportDocumentRow) => this.onView(row),
    },
  ];

  get hasFilters(): boolean {
    const filters = this.filters();
    return Boolean(
      filters.search ||
        filters.status ||
        filters.cuds ||
        filters.invoice_type !== 'support_document' ||
        (filters.supplier_id != null && filters.supplier_id !== this.initialSupplierId()) ||
        filters.date_from ||
        filters.date_to,
    );
  }

  getEmptyStateTitle(): string {
    if (this.error()) return 'No se pudo cargar el listado';
    return this.hasFilters
      ? 'Ningún documento soporte coincide con sus filtros'
      : 'Aún no hay documentos soporte';
  }

  getEmptyStateDescription(): string {
    if (this.error()) return 'Actualiza para reintentar. No se pudo comprobar si hay registros.';
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros.'
      : 'Emita el primer documento soporte desde un proveedor.';
  }

  getStatusLabel(status: string): string {
    return supportStatusLabel(status);
  }

  getTypeLabel(type: string): string {
    return supportTypeLabel(type, true);
  }

  /** `order_number` de la OC de origen, o «—» cuando el documento no viene de una OC. */
  purchaseOrderNumber(value: unknown): string {
    if (value && typeof value === 'object' && 'order_number' in value) {
      return String((value as { order_number: unknown }).order_number) || '—';
    }
    return '—';
  }

  /** CUDS: el backend lo guarda en `cufe`; mostrar sólo el final en listas. */
  formatCuds(cuds: string): string {
    if (!cuds) return '—';
    if (cuds.length <= 14) return cuds;
    return `…${cuds.slice(-12)}`;
  }
}

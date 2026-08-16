import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { SupportDocumentService } from '../../services/support-document.service';
import type { SupportDocumentRow } from '../../interfaces/support-document.interface';
import type {
  ItemListCardConfig,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import { FilterConfig } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  IconComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { describeApiFailure } from '../../utils/invoicing-errors.util';

/**
 * Listado de documentos soporte (QUI-682).
 *
 * Self-contained: usa signals locales y `takeUntilDestroyed` para no depender
 * de NgRx. El backend ya sabe filtrar por `invoice_type=support_document`
 * (cambio en `QueryInvoiceDto`) y por `cuds` / `supplier_id`.
 */
@Component({
  selector: 'app-support-document-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
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

  private service = inject(SupportDocumentService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  // ── State ──────────────────────────────────────────────
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<SupportDocumentRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(10);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit())),
  );

  // Filtros reactivos (todo el grupo es opcional; cualquier cambio dispara reload).
  readonly filters = new FormGroup({
    search: new FormControl<string>(''),
    status: new FormControl<string>(''),
    invoice_type: new FormControl<string>('support_document'),
    supplier_id: new FormControl<number | null>(null),
    cuds: new FormControl<string>(''),
    date_from: new FormControl<string>(''),
    date_to: new FormControl<string>(''),
  });

  // ── Lifecycle ──────────────────────────────────────────
  constructor() {
    const initial_supplier = this.initialSupplierId();
    if (initial_supplier != null) {
      this.filters.controls.supplier_id.setValue(initial_supplier);
    }
    this.filters.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });
    this.load();
  }

  // ── Carga ──────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const raw = this.filters.getRawValue();
    this.service
      .list({
        search: raw.search || undefined,
        status: (raw.status || undefined) as any,
        invoice_type: (raw.invoice_type || 'support_document') as any,
        supplier_id: raw.supplier_id ?? undefined,
        cuds: raw.cuds || undefined,
        date_from: raw.date_from || undefined,
        date_to: raw.date_to || undefined,
        page: this.page(),
        limit: this.limit(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response.data || []);
          this.total.set(response.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(this.extractError(err));
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  /**
   * EL `message` DE UN `HttpErrorResponse` NO ES PARA EL USUARIO.
   *
   * Este método leía `err.message` a secas, y esa clave SIEMPRE existe en un
   * `HttpErrorResponse`: no es el mensaje del backend sino el que fabrica
   * Angular — «Http failure response for https://…/store/invoicing?…: 500
   * Internal Server Error». Al comerciante le aparecía la URL con sus filtros y
   * un código HTTP, y el `error_code` que el backend sí había mandado se perdía
   * por el camino. `describeApiFailure` es el mismo punto por el que pasan los
   * effects del módulo: copy curado de `ERROR_MESSAGES[error_code]` cuando el
   * error viene tipado, y sólo si no lo está cae al texto genérico.
   */
  private extractError(err: unknown): string {
    return (
      describeApiFailure(err).message ||
      'No se pudo cargar el listado de documentos soporte.'
    );
  }

  // ── Eventos de tabla / paginación ──────────────────────
  onSearch(term: string): void {
    this.filters.controls.search.setValue(term);
  }

  onFilterChange(values: Record<string, unknown>): void {
    // Sólo `status` e `invoice_type` están declarados en `filterConfigs` (los
    // que renderiza el `app-options-dropdown`). `cuds` y `supplier_id` tienen
    // inputs dedicados en el HTML — parcharlos aquí leía `undefined` y pisaba
    // valores válidos.
    this.filters.patchValue({
      status: (values['status'] as string) || '',
      invoice_type:
        ((values['invoice_type'] as string) || 'support_document'),
    });
  }

  onClearFilters(): void {
    this.filters.reset({
      search: '',
      status: '',
      invoice_type: 'support_document',
      supplier_id: this.initialSupplierId(),
      cuds: '',
      date_from: '',
      date_to: '',
    });
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  onCreate(): void {
    this.create.emit();
  }

  onView(row: SupportDocumentRow): void {
    this.view.emit(row);
  }

  // ── Columnas y cards ───────────────────────────────────
  readonly columns: TableColumn[] = [
    { key: 'invoice_number', label: 'N° Documento', sortable: true, priority: 1 },
    {
      key: 'invoice_type',
      label: 'Tipo',
      priority: 2,
      transform: (val: unknown) => this.getTypeLabel(String(val)),
    },
    {
      key: 'customer_name',
      label: 'Proveedor',
      sortable: true,
      priority: 1,
      transform: (val: unknown, row: SupportDocumentRow) =>
        (val as string) || row?.customer_name || 'Sin proveedor',
    },
    {
      key: 'cufe',
      label: 'CUDS',
      priority: 3,
      transform: (val: unknown) => this.formatCuds(String(val ?? '')),
    },
    {
      key: 'total_amount',
      label: 'Total',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: unknown) =>
        this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'issue_date',
      label: 'Fecha',
      sortable: true,
      align: 'center',
      priority: 2,
      transform: (val: unknown) => (val ? formatDateOnlyUTC(String(val)) : ''),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          draft: 'default',
          validated: 'info',
          sent: 'info',
          accepted: 'success',
          rejected: 'danger',
          cancelled: 'warn',
          voided: 'default',
        },
      },
      transform: (val: unknown) => this.getStatusLabel(String(val)),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    subtitleTransform: (item: SupportDocumentRow) =>
      item?.customer_name || 'Sin proveedor',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'default',
        validated: 'info',
        sent: 'info',
        accepted: 'success',
        rejected: 'danger',
        cancelled: 'warn',
        voided: 'default',
      },
    },
    badgeTransform: (val: unknown) => this.getStatusLabel(String(val)),
    footerKey: 'total_amount',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val: unknown) =>
      this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'issue_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: unknown) =>
          val ? formatDateOnlyUTC(String(val)) : '-',
      },
      {
        key: 'invoice_type',
        label: 'Tipo',
        icon: 'file-text',
        transform: (val: unknown) => this.getTypeLabel(String(val)),
      },
      {
        key: 'cufe',
        label: 'CUDS',
        icon: 'hash',
        transform: (val: unknown) => this.formatCuds(String(val ?? '')),
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

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'invoice_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: 'support_document', label: 'Documento soporte' },
        { value: 'support_adjustment_note', label: 'Nota de ajuste' },
      ],
    },
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'validated', label: 'Validado' },
        { value: 'sent', label: 'Enviado' },
        { value: 'accepted', label: 'Aceptado' },
        { value: 'rejected', label: 'Rechazado' },
        { value: 'cancelled', label: 'Cancelado' },
        { value: 'voided', label: 'Anulado' },
      ],
    },
  ];

  // ── Helpers de presentación ────────────────────────────
  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      validated: 'Validado',
      sent: 'Enviado',
      accepted: 'Aceptado',
      rejected: 'Rechazado',
      cancelled: 'Cancelado',
      voided: 'Anulado',
    };
    return labels[status] || status;
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      support_document: 'Documento soporte',
      support_adjustment_note: 'Nota de ajuste',
      purchase_invoice: 'Factura de compra',
    };
    return labels[type] || type;
  }

  /** CUDS: el backend lo guarda en `cufe`. Mostrar los últimos 12 chars para no inundar la tabla. */
  formatCuds(cuds: string): string {
    if (!cuds) return '—';
    if (cuds.length <= 14) return cuds;
    return `…${cuds.slice(-12)}`;
  }

  get hasFilters(): boolean {
    const v = this.filters.getRawValue();
    return Boolean(
      v.search ||
        v.status ||
        v.cuds ||
        (v.invoice_type && v.invoice_type !== 'support_document') ||
        (v.supplier_id != null && v.supplier_id !== this.initialSupplierId()) ||
        v.date_from ||
        v.date_to,
    );
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún documento soporte coincide con sus filtros'
      : 'Aún no hay documentos soporte';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros.'
      : 'Emita el primer documento soporte desde un proveedor.';
  }
}
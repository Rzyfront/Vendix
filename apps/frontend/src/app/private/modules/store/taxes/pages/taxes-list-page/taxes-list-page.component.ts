import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';

import {
  TaxCategory,
  taxFiscalLabel,
  taxIsActive,
  taxIsExempt,
  taxIsInclusive,
  taxRatePercent,
} from '../../interfaces';
import { TaxesService } from '../../services';
import { TaxFormModalComponent } from '../../components/tax-form-modal/tax-form-modal.component';

interface TaxesStats {
  total: number;
  active: number;
  iva: number;
  inc: number;
  exempt: number;
  inclusive: number;
}

/**
 * Lista admin de impuestos (tax_categories). Espejo de
 * `PriceTiersListPageComponent` con el contrato real de `/store/taxes`:
 * sin caché, sin filtro de estado/tipo en servidor (el backend solo honra
 * `page/limit/search` en v1) y envelope con `meta` plana.
 */
@Component({
  selector: 'app-taxes-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    TaxFormModalComponent,
  ],
  templateUrl: './taxes-list-page.component.html',
  styleUrl: './taxes-list-page.component.scss',
})
export class TaxesListPageComponent implements OnInit {
  private readonly taxesService = inject(TaxesService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly taxes = signal<TaxCategory[]>([]);
  readonly stats = signal<TaxesStats>({
    total: 0,
    active: 0,
    iva: 0,
    inc: 0,
    exempt: 0,
    inclusive: 0,
  });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');

  /** Modal crear/editar: `null` = creación. */
  readonly modalOpen = signal(false);
  readonly editingTax = signal<TaxCategory | null>(null);

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly fiscalSummary = computed(() => {
    const s = this.stats();
    return `${s.inc} INC · ${s.exempt} exentos`;
  });

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Cargar impuestos base', icon: 'download', action: 'seed' },
    { label: 'Nuevo Impuesto', icon: 'plus', action: 'create', variant: 'primary' },
  ]);

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'tax_type',
      label: 'Tipo fiscal',
      priority: 1,
      width: '170px',
      transform: (value: string | null) => taxFiscalLabel(value),
    },
    {
      key: 'rate',
      label: 'Tasa %',
      priority: 1,
      width: '100px',
      transform: (_value: unknown, item?: TaxCategory) => {
        const percent = item ? taxRatePercent(item) : null;
        return percent == null ? '—' : `${percent}%`;
      },
    },
    {
      key: 'is_inclusive',
      label: 'Incluido/Agregado',
      priority: 2,
      width: '150px',
      transform: (_value: unknown, item?: TaxCategory) =>
        item && taxIsInclusive(item) ? 'Incluido' : 'Agregado',
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (_value: unknown, item?: TaxCategory) =>
        !item || taxIsActive(item) ? 'Activa' : 'Inactiva',
      badge: true,
      badgeConfig: { type: 'status' },
    },
  ];

  readonly tableActions = computed<TableAction[]>(() => [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: TaxCategory) => this.editTax(item),
    },
    {
      label: 'Archivar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: TaxCategory) => this.confirmDelete(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    avatarFallbackIcon: 'receipt',
    avatarShape: 'square',
    badgeKey: 'tax_type',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: string | null) => taxFiscalLabel(val),
    detailKeys: [
      {
        key: 'rate',
        label: 'Tasa',
        icon: 'percent',
        transform: (_v: unknown, item?: TaxCategory) => {
          const percent = item ? taxRatePercent(item) : null;
          return percent == null ? '—' : `${percent}%`;
        },
      },
      {
        key: 'is_inclusive',
        label: 'Precio',
        icon: 'tag',
        transform: (_v: unknown, item?: TaxCategory) =>
          item && taxIsInclusive(item) ? 'Incluido' : 'Agregado',
      },
      {
        key: 'is_active',
        label: 'Estado',
        icon: 'check-circle',
        transform: (_v: unknown, item?: TaxCategory) =>
          !item || taxIsActive(item) ? 'Activa' : 'Inactiva',
      },
    ],
  };

  ngOnInit(): void {
    this.loadTaxes();
  }

  loadTaxes(): void {
    this.isLoading.set(true);

    const query: { page: number; limit: number; search?: string } = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm()) {
      query.search = this.searchTerm();
    }

    this.taxesService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.taxes.set(data);
          this.totalItems.set(response.meta?.total ?? data.length);
          this.recalculateStats(data);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al cargar los impuestos',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalculateStats(list: TaxCategory[]): void {
    this.stats.set({
      total: this.totalItems(),
      active: list.filter((t) => taxIsActive(t)).length,
      iva: list.filter((t) => (t.tax_type ?? 'iva') === 'iva').length,
      inc: list.filter((t) => t.tax_type === 'inc').length,
      exempt: list.filter((t) => taxIsExempt(t)).length,
      inclusive: list.filter((t) => taxIsInclusive(t)).length,
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadTaxes();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadTaxes();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadTaxes();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.createTax();
        break;
      case 'seed':
        this.seedDefaults();
        break;
      case 'refresh':
        this.loadTaxes();
        break;
    }
  }

  createTax(): void {
    this.editingTax.set(null);
    this.modalOpen.set(true);
  }

  editTax(tax: TaxCategory): void {
    this.editingTax.set(tax);
    this.modalOpen.set(true);
  }

  onRowClick(tax: TaxCategory): void {
    this.editTax(tax);
  }

  onSaved(): void {
    this.modalOpen.set(false);
    this.loadTaxes();
  }

  seedDefaults(): void {
    this.isLoading.set(true);
    this.taxesService
      .seedDefault()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Impuestos base cargados correctamente');
          this.filters.update((f) => ({ ...f, page: 1 }));
          this.loadTaxes();
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar los impuestos base',
          );
          this.isLoading.set(false);
        },
      });
  }

  confirmDelete(tax: TaxCategory): void {
    this.dialogService
      .confirm({
        title: 'Archivar Impuesto',
        message: `¿Archivar "${tax.name}"? Esta acción lo elimina del catálogo de la tienda.`,
        confirmText: 'Archivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteTax(tax);
        }
      });
  }

  private deleteTax(tax: TaxCategory): void {
    this.taxesService
      .remove(tax.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Impuesto archivado correctamente');
          this.loadTaxes();
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al archivar el impuesto',
          );
        },
      });
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0;
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún impuesto coincide con tu búsqueda'
      : 'No tienes impuestos registrados';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta la búsqueda para encontrar impuestos.'
      : 'Carga los impuestos colombianos base o crea el primero manualmente.';
  }
}

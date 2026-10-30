import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, of } from 'rxjs';

import {
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import {
  ProductProfileModalComponent,
  ProductProfileProduct,
  ProductProfileRecipe,
} from '../../../../../../../shared/components/product-profile/index';

import {
  FORMULA_STATUS_COLORS,
  FORMULA_STATUS_LABELS,
  Formula,
  FormulaStatus,
} from '../../../interfaces';
import { ManufacturingFormulasService } from '../../../services';

type StatusFilter = 'all' | FormulaStatus;

/** Fila de la tabla: fórmula + costo teórico unitario + miniatura resuelta. */
interface FormulaRow extends Formula {
  theoretical_cost: number | null;
  /** Foto principal del producto (o `null` → placeholder). */
  image_url: string | null;
}

@Component({
  selector: 'app-formulas-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    ProductProfileModalComponent,
  ],
  templateUrl: './formulas-list-page.component.html',
  styles: [
    `
      /* Miniatura del producto en la tabla: no agranda la fila. */
      .formula-product-cell {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        line-height: 1.3;
      }

      .formula-product-thumb {
        width: 2rem;
        height: 2rem;
        flex: 0 0 auto;
        border-radius: 0.5rem;
        object-fit: cover;
        border: 1px solid var(--color-border, #e5e7eb);
        background: var(--color-surface-secondary, #f3f4f6);
      }

      .formula-product-thumb--empty {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-secondary, #4b5563);
      }

      .formula-product-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class FormulasListPageComponent implements OnInit {
  private readonly formulasService = inject(ManufacturingFormulasService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly formulas = signal<Formula[]>([]);

  /**
   * Ficha del producto que se está costeando (S1/S6). Se abre desde la lista
   * con el detalle completo de la fórmula: producto + insumos con foto y nota,
   * el mismo componente que usan recetas, producción y KDS.
   */
  readonly isProfileOpen = signal(false);
  readonly isProfileLoading = signal(false);
  readonly profileProduct = signal<ProductProfileProduct | null>(null);
  readonly profileRecipe = signal<ProductProfileRecipe | null>(null);

  /** Miniatura de la columna Producto (mismo patrón que `recipes-list-page`). */
  readonly productCellTemplate = viewChild<TemplateRef<any>>(
    'productCellTemplate',
  );

  /** Costo teórico unitario por id de fórmula (resuelto con `/:id/cost`). */
  private readonly costs = signal<Record<number, number>>({});
  readonly rows = computed<FormulaRow[]>(() => {
    const costs = this.costs();
    return this.formulas().map((f) => ({
      ...f,
      theoretical_cost: costs[f.id] ?? this.toNumber(f.unit_cost),
      image_url: this.productImage(f),
    }));
  });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<StatusFilter>('all');
  filterValues: FilterValues = {};

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );
  readonly hasFilters = computed(
    () => this.searchTerm().length > 0 || this.statusFilter() !== 'all',
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'draft', label: FORMULA_STATUS_LABELS.draft },
        { value: 'active', label: FORMULA_STATUS_LABELS.active },
        { value: 'archived', label: FORMULA_STATUS_LABELS.archived },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Nueva fórmula', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  readonly tableColumns: TableColumn[] = [
    {
      key: 'code',
      label: 'Código',
      sortable: false,
      priority: 2,
      transform: (v: string | null | undefined, row: Formula) =>
        v || `F-${row.id}`,
    },
    {
      key: 'product',
      label: 'Producto',
      sortable: false,
      priority: 1,
      transform: (_: unknown, row: Formula) =>
        row.product?.name ?? `Producto #${row.product_id}`,
    },
    {
      key: 'yield_quantity',
      label: 'Rendimiento',
      priority: 2,
      transform: (v: number | string, row: Formula) =>
        `${this.formatNumber(v)} ${row.yield_unit ?? ''}`.trim(),
    },
    {
      key: 'version',
      label: 'Versión',
      priority: 3,
      transform: (v: number | string | null | undefined) =>
        v != null && v !== '' ? `v${v}` : '—',
    },
    {
      key: 'theoretical_cost',
      label: 'Costo teórico / unidad',
      priority: 2,
      align: 'right',
      transform: (v: number | null) =>
        v == null ? '—' : this.currencyService.format(v),
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorFn: (v: FormulaStatus) => FORMULA_STATUS_COLORS[v],
      },
      transform: (v: FormulaStatus) => FORMULA_STATUS_LABELS[v] ?? String(v),
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver ficha',
      icon: 'eye',
      variant: 'ghost',
      action: (item: Formula) => this.openProfile(item),
    },
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: Formula) => this.editFormula(item),
    },
    {
      label: 'Archivar',
      icon: 'archive',
      variant: 'danger',
      show: (item: Formula) => item.status !== 'archived',
      action: (item: Formula) => this.archiveFormula(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product',
    titleTransform: (row: Formula) =>
      row.product?.name ?? `Producto #${row.product_id}`,
    subtitleKey: 'code',
    // Miniatura del producto en la card móvil; sin foto cae a `flask-conical`.
    avatarKey: 'image_url',
    subtitleTransform: (row: Formula) =>
      `${row.code || `F-${row.id}`}${row.version != null && row.version !== '' ? ` · v${row.version}` : ''}`,
    avatarFallbackIcon: 'flask-conical',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorFn: (v: FormulaStatus) => FORMULA_STATUS_COLORS[v],
    },
    badgeTransform: (v: FormulaStatus) => FORMULA_STATUS_LABELS[v] ?? String(v),
    detailKeys: [
      {
        key: 'yield_quantity',
        label: 'Rinde',
        icon: 'package',
        transform: (v: number | string, row?: Formula) =>
          `${this.formatNumber(v)} ${row?.yield_unit ?? ''}`.trim(),
      },
      {
        key: 'theoretical_cost',
        label: 'Costo teórico',
        icon: 'calculator',
        transform: (v: number | null | undefined) =>
          v == null ? '—' : this.currencyService.format(v),
      },
    ],
  };

  ngOnInit(): void {
    this.loadFormulas();
  }

  constructor() {
    // Enchufa la celda custom de Producto cuando el template resuelve.
    // Mismo patrón que `recipes-list-page`: solo muta `template`, sin signals.
    effect(() => {
      const tpl = this.productCellTemplate();
      if (!tpl) return;
      const productCol = this.tableColumns.find((col) => col.key === 'product');
      if (productCol) productCol.template = tpl;
    });
  }

  /** Foto principal del producto: `is_main` → primera de la galería. */
  productImage(formula: Formula): string | null {
    const images = formula.product?.product_images ?? [];
    if (images.length > 0) {
      const main = images.find((img) => img?.is_main) ?? images[0];
      return main?.image_url ?? null;
    }
    return formula.product?.image_url ?? null;
  }

  /**
   * Abre la ficha (S1) de la fórmula. El listado no trae insumos, así que se
   * pide el detalle una vez y se mapea al contrato de la ficha; el modal se
   * abre ya con el producto para que no parpadee.
   */
  openProfile(formula: Formula): void {
    this.profileProduct.set({
      id: formula.product?.id ?? formula.product_id,
      name: formula.product?.name ?? `Producto #${formula.product_id}`,
      sku: formula.product?.sku ?? null,
      description: formula.product?.description ?? null,
      stock_unit: formula.product?.stock_unit ?? null,
      preparation_time_minutes:
        formula.product?.preparation_time_minutes ?? null,
      image_url: this.productImage(formula),
      product_images: formula.product?.product_images ?? [],
    });
    this.profileRecipe.set(null);
    this.isProfileOpen.set(true);
    this.isProfileLoading.set(true);

    this.formulasService
      .getById(formula.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.profileRecipe.set(this.toProfileRecipe(detail));
          this.isProfileLoading.set(false);
        },
        error: () => {
          this.toastService.error(
            'No se pudieron cargar los insumos de la fórmula',
          );
          this.isProfileLoading.set(false);
        },
      });
  }

  private toProfileRecipe(formula: Formula): ProductProfileRecipe {
    return {
      id: formula.id,
      yield_quantity: formula.yield_quantity,
      yield_unit: formula.yield_unit,
      waste_percent: formula.waste_percent,
      preparation_notes: formula.preparation_notes ?? null,
      is_active: formula.is_active,
      items: (formula.items ?? []).map((item) => ({
        id: item.id,
        name:
          item.component_product?.name ?? `Producto #${item.component_product_id}`,
        sku: item.component_product?.sku ?? null,
        quantity: item.quantity,
        stock_unit: item.component_product?.stock_unit ?? null,
        waste_percent: item.waste_percent,
        notes: item.notes ?? null,
        product_images: item.component_product?.product_images ?? [],
      })),
    };
  }

  loadFormulas(): void {
    this.isLoading.set(true);
    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm()) query['search'] = this.searchTerm();
    if (this.statusFilter() !== 'all') query['status'] = this.statusFilter();

    this.formulasService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.formulas.set(data);
          this.totalItems.set(response.meta?.pagination?.total ?? data.length);
          this.isLoading.set(false);
          this.loadCosts(data);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al cargar las fórmulas',
          );
          this.isLoading.set(false);
        },
      });
  }

  /** Resuelve el costo teórico por unidad de las fórmulas visibles. */
  private loadCosts(formulas: Formula[]): void {
    const pending = formulas.filter((f) => this.costs()[f.id] === undefined);
    if (pending.length === 0) return;
    forkJoin(
      pending.map((f) =>
        this.formulasService.getCost(f.id).pipe(catchError(() => of(null))),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        const next = { ...this.costs() };
        results.forEach((cost, i) => {
          if (cost) next[pending[i].id] = Number(cost.unit_cost) || 0;
        });
        this.costs.set(next);
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadFormulas();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const raw = values['status'] as string | undefined;
    this.statusFilter.set(
      raw === 'draft' || raw === 'active' || raw === 'archived' ? raw : 'all',
    );
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadFormulas();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadFormulas();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadFormulas();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.createFormula();
    if (action === 'refresh') this.loadFormulas();
  }

  onRowClick(formula: Formula): void {
    this.editFormula(formula);
  }

  createFormula(): void {
    this.router.navigate(['/admin/manufacturing/formulas/new']);
  }

  editFormula(formula: Formula): void {
    this.router.navigate(['/admin/manufacturing/formulas', formula.id, 'edit']);
  }

  private archiveFormula(formula: Formula): void {
    this.dialogService
      .confirm({
        title: 'Archivar fórmula',
        message: `¿Archivar la fórmula "${formula.product?.name ?? `#${formula.id}`}"? Dejará de estar disponible para nuevas órdenes de producción.`,
        confirmText: 'Archivar',
        cancelText: 'Volver',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.formulasService
          .archive(formula.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toastService.success('Fórmula archivada');
              this.loadFormulas();
            },
            error: (error) =>
              this.toastService.error(
                typeof error === 'string' ? error : 'Error al archivar la fórmula',
              ),
          });
      });
  }

  emptyTitle(): string {
    return this.hasFilters()
      ? 'Ninguna fórmula coincide con tus filtros'
      : 'Aún no tienes fórmulas';
  }

  emptyDescription(): string {
    return this.hasFilters()
      ? 'Ajusta los filtros o la búsqueda para encontrar fórmulas.'
      : 'Crea tu primera fórmula para definir qué insumos lleva cada producto y cuánto cuesta producirlo.';
  }

  private toNumber(value: number | string | null | undefined): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private formatNumber(value: number | string | null | undefined): string {
    if (value == null) return '0';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Number.isInteger(n) ? n.toString() : n.toFixed(2);
  }
}

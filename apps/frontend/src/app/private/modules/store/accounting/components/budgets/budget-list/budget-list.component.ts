import {Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router } from '@angular/router';


import { AccountingService } from '../../../services/accounting.service';
import { Budget, FiscalPeriod } from '../../../interfaces/accounting.interface';
import { BudgetCreateModalComponent } from '../budget-create-modal/budget-create-modal.component';
import {
  CardComponent,
  InputsearchComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
  FilterConfig,
  FilterValues,
  ToastService,
  ButtonComponent} from '../../../../../../../shared/components/index';

interface BudgetStats {
  total: number;
  draft: number;
  active: number;
  closed: number;
}

@Component({
  selector: 'vendix-budget-list',
  standalone: true,
  imports: [
    CardComponent,
    InputsearchComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    BudgetCreateModalComponent
],
  templateUrl: './budget-list.component.html',
  styleUrls: ['./budget-list.component.scss']})
export class BudgetListComponent {
  private destroyRef = inject(DestroyRef);
private accounting_service = inject(AccountingService);
  private router = inject(Router);
  private toast_service = inject(ToastService);

  budgets = signal<Budget[]>([]);
  loading = signal(false);
  search_term = signal('');
  filter_values = signal<FilterValues>({});

  // Pagination state — backend paginates; we mirror the current page slice.
  readonly filters = signal({ page: 1, limit: 20 });
  readonly totalItems = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );

  // ✅ Migrated to model() for two-way binding (Section 2 — model API)
  readonly isCreateModalOpen = signal(false);

  stats = computed<BudgetStats>(() => {
    // Stats reflect the server-side total (not just the current page slice).
    return {
      total: this.totalItems(),
      draft: this._statsBreakdown().draft,
      active: this._statsBreakdown().active,
      closed: this._statsBreakdown().closed,
    };
  });

  /**
   * Local post-filter on top of the server-side page.
   * Search is not supported by the backend query DTO, so we filter the
   * current page slice in the client. Status filter is sent server-side.
   */
  filtered_budgets = computed(() => {
    let items = this.budgets();
    const search = this.search_term().toLowerCase();
    const filters = this.filter_values();

    if (search) {
      items = items.filter(
        (b) =>
          b.name.toLowerCase().includes(search) ||
          (b.description && b.description.toLowerCase().includes(search)),
      );
    }

    const status_filter = filters['status'] as string;
    if (status_filter) {
      items = items.filter((b) => b.status === status_filter);
    }

    return items;
  });

  /**
   * Approximate status breakdown from the current page slice.
   * Backend stats endpoint would be the ideal source — placeholder until
   * the accounting stats endpoint is wired.
   */
  private _statsBreakdown = computed(() => {
    const items = this.budgets();
    return {
      draft: items.filter((b) => b.status === 'draft').length,
      active: items.filter(
        (b) => b.status === 'active' || b.status === 'approved',
      ).length,
      closed: items.filter((b) => b.status === 'closed').length,
    };
  });

  filter_configs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'approved', label: 'Aprobado' },
        { value: 'active', label: 'Activo' },
        { value: 'closed', label: 'Cerrado' },
      ]},
  ];

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nuevo Presupuesto',
      icon: 'plus',
      action: 'create',
      variant: 'primary'},
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (row: Budget) => this.onEdit(row)},
    {
      label: 'Varianza',
      icon: 'bar-chart-2',
      variant: 'secondary',
      action: (row: Budget) => this.onVariance(row),
      show: (row: Budget) =>
        row.status === 'active' ||
        row.status === 'approved' ||
        row.status === 'closed'},
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: Budget) => this.onDelete(row),
      show: (row: Budget) => row.status === 'draft'},
  ];

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'fiscal_period',
      label: 'Periodo Fiscal',
      sortable: false,
      priority: 2,
      transform: (val: FiscalPeriod | undefined) => val?.name || '-'},
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (val: string) => this.getStatusLabel(val)},
    {
      key: 'variance_threshold',
      label: 'Umbral %',
      align: 'right',
      priority: 2,
      transform: (val: number | undefined) =>
        val !== undefined && val !== null ? `${val}%` : '-'},
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      priority: 2,
      transform: (val: string) =>
        val ? new Date(val).toLocaleDateString() : '-'},
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'description',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'warn',
        approved: 'info',
        active: 'success',
        closed: 'neutral'}},
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'fiscal_period',
        label: 'Periodo',
        icon: 'calendar',
        transform: (val: FiscalPeriod | undefined) => val?.name || '-'},
      {
        key: 'variance_threshold',
        label: 'Umbral',
        icon: 'percent',
        transform: (val: number | undefined) =>
          val !== undefined && val !== null ? `${val}%` : '-'},
    ]};

  constructor() {
    this.loadBudgets();
  }
loadBudgets(): void {
    this.loading.set(true);
    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    const statusFilter = this.filter_values()['status'] as string | undefined;
    if (statusFilter) {
      query['status'] = statusFilter;
    }
    this.accounting_service
      .getBudgets(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.budgets.set(res.data || []);
          this.totalItems.set(res.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }});
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadBudgets();
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
    // Reset to page 1 when searching so the user sees the first match
    // from the current page slice (search is local until the backend
    // grows a `search` field on QueryBudgetDto).
    this.filters.update((f) => ({ ...f, page: 1 }));
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values.set({ ...values });
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadBudgets();
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.isCreateModalOpen.set(true);
    }
  }

  onRowClick(budget: Budget): void {
    if (budget.status === 'draft') {
      this.onEdit(budget);
    } else {
      this.onVariance(budget);
    }
  }

  onEdit(budget: Budget): void {
    this.router.navigate(['/store/accounting/budgets', budget.id, 'editor']);
  }

  onVariance(budget: Budget): void {
    this.router.navigate(['/store/accounting/budgets', budget.id, 'variance']);
  }

  onDelete(budget: Budget): void {
    if (!confirm(`Eliminar presupuesto "${budget.name}"?`)) return;
    this.accounting_service
      .deleteBudget(budget.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast_service.show({
            variant: 'success',
            description: 'Presupuesto eliminado'});
          this.loadBudgets();
        },
        error: () => {
          this.toast_service.show({
            variant: 'error',
            description: 'Error al eliminar presupuesto'});
        }});
  }

  onBudgetCreated(): void {
    this.isCreateModalOpen.set(false);
    this.loadBudgets();
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      approved: 'Aprobado',
      active: 'Activo',
      closed: 'Cerrado'};
    return labels[status] || status;
  }
}

import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';

import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { AccountingService } from '../../../services/accounting.service';
import { Budget, FiscalPeriod } from '../../../interfaces/accounting.interface';
import { BudgetCreateModalComponent } from '../budget-create-modal/budget-create-modal.component';
import {
  CardComponent,
  InputsearchComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
  FilterConfig,
  FilterValues,
  ToastService,
  ButtonComponent,
} from '../../../../../../../shared/components/index';

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
    BudgetCreateModalComponent
],
  templateUrl: './budget-list.component.html',
  styleUrls: ['./budget-list.component.scss'],
})
export class BudgetListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private accounting_service = inject(AccountingService);
  private router = inject(Router);
  private toast_service = inject(ToastService);

  budgets = signal<Budget[]>([]);
  loading = signal(false);
  search_term = signal('');
  filter_values = signal<FilterValues>({});

  is_create_modal_open = false;

  stats = computed<BudgetStats>(() => {
    const items = this.budgets();
    return {
      total: items.length,
      draft: items.filter((b) => b.status === 'draft').length,
      active: items.filter(
        (b) => b.status === 'active' || b.status === 'approved',
      ).length,
      closed: items.filter((b) => b.status === 'closed').length,
    };
  });

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
      ],
    },
  ];

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nuevo Presupuesto',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (row: Budget) => this.onEdit(row),
    },
    {
      label: 'Varianza',
      icon: 'bar-chart-2',
      variant: 'secondary',
      action: (row: Budget) => this.onVariance(row),
      show: (row: Budget) =>
        row.status === 'active' ||
        row.status === 'approved' ||
        row.status === 'closed',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: Budget) => this.onDelete(row),
      show: (row: Budget) => row.status === 'draft',
    },
  ];

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'fiscal_period',
      label: 'Periodo Fiscal',
      sortable: false,
      priority: 2,
      transform: (val: FiscalPeriod | undefined) => val?.name || '-',
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (val: string) => this.getStatusLabel(val),
    },
    {
      key: 'variance_threshold',
      label: 'Umbral %',
      align: 'right',
      priority: 2,
      transform: (val: number | undefined) =>
        val !== undefined && val !== null ? `${val}%` : '-',
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      priority: 2,
      transform: (val: string) =>
        val ? new Date(val).toLocaleDateString() : '-',
    },
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
        closed: 'neutral',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'fiscal_period',
        label: 'Periodo',
        icon: 'calendar',
        transform: (val: FiscalPeriod | undefined) => val?.name || '-',
      },
      {
        key: 'variance_threshold',
        label: 'Umbral',
        icon: 'percent',
        transform: (val: number | undefined) =>
          val !== undefined && val !== null ? `${val}%` : '-',
      },
    ],
  };

  ngOnInit(): void {
    this.loadBudgets();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadBudgets(): void {
    this.loading.set(true);
    this.accounting_service
      .getBudgets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.budgets.set(res.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values.set({ ...values });
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.is_create_modal_open = true;
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
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.show({
            variant: 'success',
            description: 'Presupuesto eliminado',
          });
          this.loadBudgets();
        },
        error: () => {
          this.toast_service.show({
            variant: 'error',
            description: 'Error al eliminar presupuesto',
          });
        },
      });
  }

  onBudgetCreated(): void {
    this.is_create_modal_open = false;
    this.loadBudgets();
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      approved: 'Aprobado',
      active: 'Activo',
      closed: 'Cerrado',
    };
    return labels[status] || status;
  }
}

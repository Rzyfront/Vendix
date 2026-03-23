import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../services/payroll.service';
import { EmployeeAdvance, AdvanceStats } from '../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { ResponsiveDataViewComponent, TableColumn, TableAction, ItemListCardConfig } from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

import { AdvanceCreateComponent } from '../components/advances/advance-create/advance-create.component';
import { AdvanceDetailComponent } from '../components/advances/advance-detail/advance-detail.component';

@Component({
  selector: 'vendix-payroll-advances-page',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    AdvanceCreateComponent,
    AdvanceDetailComponent,
  ],
  template: `
    <div class="w-full">

      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Activos"
          [value]="stats()?.total_active || 0"
          iconName="repeat"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pendientes Aprobacion"
          [value]="stats()?.total_pending_approval || 0"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Monto Pendiente"
          [value]="formatCurrency(stats()?.total_amount_pending || 0)"
          iconName="dollar-sign"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Deducido Este Mes"
          [value]="formatCurrency(stats()?.total_deducted_this_month || 0)"
          iconName="trending-down"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Search Section -->
      <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                  md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary">
            Adelantos ({{ advances().length }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar adelanto..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              (filterChange)="onFilterChange($event)"
            ></app-options-dropdown>
            <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16"></app-icon>
              <span class="hidden md:inline ml-1">Nuevo</span>
            </app-button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
                  md:border md:border-border md:min-h-[600px] md:overflow-hidden">
        <app-responsive-data-view
          [data]="advances()"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [actions]="actions"
          [loading]="loading()"
          emptyMessage="No hay adelantos registrados"
          emptyIcon="hand-coins"
          (rowClick)="viewAdvance($event)"
        ></app-responsive-data-view>
      </div>

      <!-- Create Modal -->
      <app-advance-create
        [(isOpen)]="isCreateModalOpen"
        (created)="onAdvanceCreated()"
      ></app-advance-create>

      <!-- Detail Modal -->
      <app-advance-detail
        [(isOpen)]="isDetailModalOpen"
        [advance]="selectedAdvance"
        (updated)="onAdvanceUpdated()"
      ></app-advance-detail>
    </div>
  `,
})
export class PayrollAdvancesPageComponent implements OnInit, OnDestroy {
  private payrollService = inject(PayrollService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  // State
  advances = signal<EmployeeAdvance[]>([]);
  stats = signal<AdvanceStats | null>(null);
  loading = signal(false);

  // Filters
  private searchTerm = '';
  private statusFilter = '';

  // Modal state
  isCreateModalOpen = false;
  isDetailModalOpen = false;
  selectedAdvance: EmployeeAdvance | null = null;

  columns: TableColumn[] = [
    { key: 'advance_number', label: '# Adelanto', sortable: true },
    {
      key: 'employee',
      label: 'Empleado',
      transform: (val: any) => val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'amount_requested',
      label: 'Solicitado',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'amount_approved',
      label: 'Aprobado',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'amount_pending',
      label: 'Pendiente',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'installments',
      label: 'Cuotas',
      transform: (val: any) => `${val || 0}`,
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          pending: 'yellow',
          approved: 'blue',
          repaying: 'purple',
          paid: 'green',
          rejected: 'red',
          cancelled: 'gray',
        },
      },
      transform: (val: string) => this.getStatusLabel(val),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'advance_number',
    subtitleKey: 'employee',
    subtitleTransform: (val: any) => val ? `${val.first_name} ${val.last_name}` : '-',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#eab308',
        approved: '#3b82f6',
        repaying: '#a855f7',
        paid: '#22c55e',
        rejected: '#ef4444',
        cancelled: '#9ca3af',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'amount_requested',
        label: 'Solicitado',
        transform: (v: any) => this.currencyService.format(Number(v) || 0),
      },
    ],
    footerKey: 'amount_pending',
    footerLabel: 'Pendiente',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.currencyService.format(Number(v) || 0),
  };

  actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (item: EmployeeAdvance) => this.viewAdvance(item),
    },
    {
      label: 'Aprobar',
      icon: 'check-circle',
      variant: 'success',
      show: (item: EmployeeAdvance) => item.status === 'pending',
      action: (item: EmployeeAdvance) => this.onQuickApprove(item),
    },
    {
      label: 'Rechazar',
      icon: 'x-circle',
      variant: 'danger',
      show: (item: EmployeeAdvance) => item.status === 'pending',
      action: (item: EmployeeAdvance) => this.onQuickReject(item),
    },
  ];

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Pendiente', value: 'pending' },
        { label: 'Aprobado', value: 'approved' },
        { label: 'En Pago', value: 'repaying' },
        { label: 'Pagado', value: 'paid' },
        { label: 'Rechazado', value: 'rejected' },
        { label: 'Cancelado', value: 'cancelled' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadAdvances();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAdvances(): void {
    this.loading.set(true);
    const query: Record<string, any> = {};
    if (this.searchTerm) query['search'] = this.searchTerm;
    if (this.statusFilter) query['status'] = this.statusFilter;

    this.payrollService.getAdvances(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.advances.set(res.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error cargando adelantos' });
        },
      });
  }

  loadStats(): void {
    this.payrollService.getAdvanceStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.stats.set(res.data),
      });
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadAdvances();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.statusFilter = (values['status'] as string) || '';
    this.loadAdvances();
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  viewAdvance(advance: EmployeeAdvance): void {
    this.selectedAdvance = advance;
    this.isDetailModalOpen = true;
    // Fetch full detail with payments
    this.payrollService.getAdvance(advance.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.selectedAdvance = res.data,
      });
  }

  onAdvanceCreated(): void {
    this.loadAdvances();
    this.loadStats();
  }

  onAdvanceUpdated(): void {
    this.loadAdvances();
    this.loadStats();
  }

  onQuickApprove(advance: EmployeeAdvance): void {
    this.payrollService.approveAdvance(advance.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Adelanto aprobado' });
          this.onAdvanceUpdated();
        },
        error: () => this.toastService.show({ variant: 'error', description: 'Error al aprobar' }),
      });
  }

  onQuickReject(advance: EmployeeAdvance): void {
    this.payrollService.rejectAdvance(advance.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Adelanto rechazado' });
          this.onAdvanceUpdated();
        },
        error: () => this.toastService.show({ variant: 'error', description: 'Error al rechazar' }),
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      repaying: 'En Pago',
      paid: 'Pagado',
      rejected: 'Rechazado',
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  }
}

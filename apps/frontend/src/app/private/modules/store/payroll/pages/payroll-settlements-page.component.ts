import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../services/payroll.service';
import {
  PayrollSettlement,
  SettlementStats,
} from '../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CardComponent } from '../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

import { SettlementCreateComponent } from '../components/settlements/settlement-create/settlement-create.component';
import { SettlementDetailComponent } from '../components/settlements/settlement-detail/settlement-detail.component';

@Component({
  selector: 'vendix-payroll-settlements-page',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    SettlementCreateComponent,
    SettlementDetailComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="totalSettlements()"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Calculadas"
          [value]="stats()?.by_status?.calculated || 0"
          iconName="calculator"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        ></app-stats>

        <app-stats
          title="Aprobadas"
          [value]="stats()?.by_status?.approved || 0"
          iconName="check-circle"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Pagadas"
          [value]="stats()?.by_status?.paid || 0"
          iconName="banknote"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Search Section -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                  md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
          >
            Liquidaciones ({{ settlements().length }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar liquidacion..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              (filterChange)="onFilterChange($event)"
            ></app-options-dropdown>
            <app-button
              variant="primary"
              size="sm"
              (clicked)="openCreateModal()"
            >
              <app-icon name="plus" [size]="16"></app-icon>
              <span class="hidden md:inline ml-1">Nueva</span>
            </app-button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <app-card
        [responsive]="true"
        [padding]="false"
        customClasses="md:min-h-[600px] md:overflow-hidden"
      >
        <app-responsive-data-view
          [data]="settlements()"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [actions]="actions"
          [loading]="loading()"
          emptyMessage="No hay liquidaciones registradas"
          emptyIcon="file-minus"
          (rowClick)="viewSettlement($event)"
        ></app-responsive-data-view>
      </app-card>

      <!-- Create Modal -->
      <app-settlement-create
        [(isOpen)]="isCreateModalOpen"
        (created)="onSettlementCreated()"
      ></app-settlement-create>

      <!-- Detail Modal -->
      <app-settlement-detail
        [(isOpen)]="isDetailModalOpen"
        [settlement]="selectedSettlement"
        (updated)="onSettlementUpdated()"
      ></app-settlement-detail>
    </div>
  `,
})
export class PayrollSettlementsPageComponent implements OnInit, OnDestroy {
  private payrollService = inject(PayrollService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  // State
  settlements = signal<PayrollSettlement[]>([]);
  stats = signal<SettlementStats | null>(null);
  loading = signal(false);

  // Filters
  private searchTerm = '';
  private statusFilter = '';

  // Modal state
  isCreateModalOpen = false;
  isDetailModalOpen = false;
  selectedSettlement: PayrollSettlement | null = null;

  totalSettlements = computed(() => {
    const s = this.stats();
    if (!s) return 0;
    return (
      (s.by_status.draft || 0) +
      (s.by_status.calculated || 0) +
      (s.by_status.approved || 0) +
      (s.by_status.paid || 0) +
      (s.by_status.cancelled || 0)
    );
  });

  columns: TableColumn[] = [
    { key: 'settlement_number', label: '# Liquidacion', sortable: true },
    {
      key: 'employee',
      label: 'Empleado',
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'termination_date',
      label: 'Fecha Terminacion',
      transform: (val: string) =>
        val
          ? new Date(val).toLocaleDateString('es-CO', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })
          : '-',
    },
    {
      key: 'termination_reason',
      label: 'Motivo',
      transform: (val: string) => this.getReasonLabel(val),
    },
    {
      key: 'gross_settlement',
      label: 'Bruto',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'net_settlement',
      label: 'Neto',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          draft: 'gray',
          calculated: 'blue',
          approved: 'yellow',
          paid: 'green',
          cancelled: 'gray',
        },
      },
      transform: (val: string) => this.getStatusLabel(val),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'settlement_number',
    subtitleKey: 'employee',
    subtitleTransform: (val: any) =>
      val ? `${val.first_name} ${val.last_name}` : '-',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        draft: '#9ca3af',
        calculated: '#3b82f6',
        approved: '#eab308',
        paid: '#22c55e',
        cancelled: '#9ca3af',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'termination_reason',
        label: 'Motivo',
        transform: (v: any) => this.getReasonLabel(v),
      },
    ],
    footerKey: 'net_settlement',
    footerLabel: 'Neto',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.currencyService.format(Number(v) || 0),
  };

  actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (item: PayrollSettlement) => this.viewSettlement(item),
    },
    {
      label: 'Aprobar',
      icon: 'check-circle',
      variant: 'success',
      show: (item: PayrollSettlement) => item.status === 'calculated',
      action: (item: PayrollSettlement) => this.onApprove(item),
    },
    {
      label: 'Pagar',
      icon: 'banknote',
      variant: 'success',
      show: (item: PayrollSettlement) => item.status === 'approved',
      action: (item: PayrollSettlement) => this.onPay(item),
    },
    {
      label: 'Cancelar',
      icon: 'x-circle',
      variant: 'danger',
      show: (item: PayrollSettlement) =>
        item.status !== 'paid' && item.status !== 'cancelled',
      action: (item: PayrollSettlement) => this.onCancel(item),
    },
  ];

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Borrador', value: 'draft' },
        { label: 'Calculada', value: 'calculated' },
        { label: 'Aprobada', value: 'approved' },
        { label: 'Pagada', value: 'paid' },
        { label: 'Cancelada', value: 'cancelled' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadSettlements();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadSettlements(): void {
    this.loading.set(true);
    const query: Record<string, any> = {};
    if (this.searchTerm) query['search'] = this.searchTerm;
    if (this.statusFilter) query['status'] = this.statusFilter;

    this.payrollService
      .getSettlements(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.settlements.set(res.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error cargando liquidaciones',
          });
        },
      });
  }

  loadStats(): void {
    this.payrollService
      .getSettlementStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.stats.set(res.data),
      });
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadSettlements();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.statusFilter = (values['status'] as string) || '';
    this.loadSettlements();
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  viewSettlement(settlement: PayrollSettlement): void {
    this.selectedSettlement = settlement;
    this.isDetailModalOpen = true;
    // Fetch full detail
    this.payrollService
      .getSettlement(settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => (this.selectedSettlement = res.data),
      });
  }

  onSettlementCreated(): void {
    this.loadSettlements();
    this.loadStats();
  }

  onSettlementUpdated(): void {
    this.loadSettlements();
    this.loadStats();
  }

  onApprove(settlement: PayrollSettlement): void {
    this.payrollService
      .approveSettlement(settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({
            variant: 'success',
            description: 'Liquidacion aprobada',
          });
          this.onSettlementUpdated();
        },
        error: () =>
          this.toastService.show({
            variant: 'error',
            description: 'Error al aprobar',
          }),
      });
  }

  onPay(settlement: PayrollSettlement): void {
    this.payrollService
      .paySettlement(settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({
            variant: 'success',
            description: 'Liquidacion pagada',
          });
          this.onSettlementUpdated();
        },
        error: () =>
          this.toastService.show({
            variant: 'error',
            description: 'Error al pagar',
          }),
      });
  }

  onCancel(settlement: PayrollSettlement): void {
    this.payrollService
      .cancelSettlement(settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({
            variant: 'success',
            description: 'Liquidacion cancelada',
          });
          this.onSettlementUpdated();
        },
        error: () =>
          this.toastService.show({
            variant: 'error',
            description: 'Error al cancelar',
          }),
      });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      paid: 'Pagada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      voluntary_resignation: 'Renuncia Voluntaria',
      just_cause_dismissal: 'Despido con Justa Causa',
      unjust_cause_dismissal: 'Despido sin Justa Causa',
      mutual_agreement: 'Mutuo Acuerdo',
      contract_expiration: 'Vencimiento Contrato',
      retirement: 'Jubilacion',
    };
    return labels[reason] || reason || '-';
  }
}

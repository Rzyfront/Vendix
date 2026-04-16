import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';

import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../services/payroll.service';
import {
  PayrollSettlement,
  SettlementStats,
} from '../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import { SettlementListComponent } from '../components/settlements/settlement-list/settlement-list.component';
import { SettlementCreateComponent } from '../components/settlements/settlement-create/settlement-create.component';
import { SettlementDetailComponent } from '../components/settlements/settlement-detail/settlement-detail.component';

@Component({
  selector: 'vendix-payroll-settlements-page',
  standalone: true,
  imports: [
    StatsComponent,
    SettlementListComponent,
    SettlementCreateComponent,
    SettlementDetailComponent
],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="totalSettlements()"
          [smallText]="'Bruto: ' + currencyService.format(stats()?.total_gross || 0)"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Calculadas"
          [value]="stats()?.by_status?.['calculated']?.count || 0"
          smallText="Pendientes de revision"
          iconName="calculator"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        ></app-stats>

        <app-stats
          title="Aprobadas"
          [value]="stats()?.by_status?.['approved']?.count || 0"
          smallText="Listas para pago"
          iconName="check-circle"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Pagadas"
          [value]="stats()?.by_status?.['paid']?.count || 0"
          [smallText]="'Neto: ' + currencyService.format(stats()?.total_net || 0)"
          iconName="banknote"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- List Component -->
      <app-settlement-list
        [settlements]="settlements()"
        [isLoading]="loading()"
        (search)="onSearch($event)"
        (filter)="onFilterChange($event)"
        (create)="openCreateModal()"
        (view)="viewSettlement($event)"
        (approve)="onApprove($event)"
        (pay)="onPay($event)"
        (cancel)="onCancel($event)"
      ></app-settlement-list>

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
  protected currencyService = inject(CurrencyFormatService);
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
    if (!s?.by_status) return 0;
    return Object.values(s.by_status).reduce((sum, entry) => sum + (entry?.count || 0), 0);
  });

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
    this.statusFilter = (values['status'] as string) || '';
    this.loadSettlements();
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  viewSettlement(settlement: PayrollSettlement): void {
    this.selectedSettlement = settlement;
    this.isDetailModalOpen = true;
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
}

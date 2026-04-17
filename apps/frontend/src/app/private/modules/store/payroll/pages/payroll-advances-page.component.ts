import { Component, inject, DestroyRef, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


import { PayrollService } from '../services/payroll.service';
import { EmployeeAdvance, AdvanceStats } from '../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';

import { AdvanceListComponent } from '../components/advances/advance-list/advance-list.component';
import { AdvanceCreateComponent } from '../components/advances/advance-create/advance-create.component';
import { AdvanceDetailComponent } from '../components/advances/advance-detail/advance-detail.component';

@Component({
  selector: 'vendix-payroll-advances-page',
  standalone: true,
  imports: [
    StatsComponent,
    AdvanceListComponent,
    AdvanceCreateComponent,
    AdvanceDetailComponent
],
  template: `
    <div class="w-full">

      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Activos"
          [value]="stats()?.total_active || 0"
          smallText="Adelantos vigentes"
          iconName="repeat"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pendientes Aprobacion"
          [value]="stats()?.total_pending_approval || 0"
          smallText="Por aprobar"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Monto Pendiente"
          [value]="formatCurrency(stats()?.total_amount_pending || 0)"
          smallText="Total por cobrar"
          iconName="dollar-sign"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Deducido Este Mes"
          [value]="formatCurrency(stats()?.total_deducted_this_month || 0)"
          smallText="Mes actual"
          iconName="trending-down"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Advance List -->
      <app-advance-list
        [advances]="advances()"
        [loading]="loading()"
        (create)="openCreateModal()"
        (search)="onSearch($event)"
        (filter)="onFilterChange($event)"
        (viewDetail)="viewAdvance($event)"
        (quickApprove)="onQuickApprove($event)"
        (quickReject)="onQuickReject($event)"
      />

      <!-- Create Modal -->
      <app-advance-create
        [(isOpen)]="isCreateModalOpen"
        (created)="onAdvanceCreated()"
      ></app-advance-create>

      <!-- Detail Modal -->
      <app-advance-detail
        [(isOpen)]="isDetailModalOpen"
        [advanceInput]="selectedAdvance"
        (updated)="onAdvanceUpdated()"
      ></app-advance-detail>
    </div>
  ` })
export class PayrollAdvancesPageComponent {
  private payrollService = inject(PayrollService);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);
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

  constructor() {
    this.currencyService.loadCurrency();
    this.loadAdvances();
    this.loadStats();

    this.destroyRef.onDestroy(() => {
    });
  }

  loadAdvances(): void {
    this.loading.set(true);
    const query: Record<string, any> = {};
    if (this.searchTerm) query['search'] = this.searchTerm;
    if (this.statusFilter) query['status'] = this.statusFilter;

    this.payrollService.getAdvances(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advances.set(res.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error cargando adelantos' });
        } });
  }

  loadStats(): void {
    this.payrollService.getAdvanceStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.stats.set(res.data) });
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadAdvances();
  }

  onFilterChange(values: FilterValues): void {
    this.statusFilter = (values['status'] as string) || '';
    this.loadAdvances();
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  viewAdvance(advance: EmployeeAdvance): void {
    this.selectedAdvance = advance;
    this.isDetailModalOpen = true;
    this.payrollService.getAdvance(advance.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.selectedAdvance = res.data });
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
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Adelanto aprobado' });
          this.onAdvanceUpdated();
        },
        error: () => this.toastService.show({ variant: 'error', description: 'Error al aprobar' }) });
  }

  onQuickReject(advance: EmployeeAdvance): void {
    this.payrollService.rejectAdvance(advance.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Adelanto rechazado' });
          this.onAdvanceUpdated();
        },
        error: () => this.toastService.show({ variant: 'error', description: 'Error al rechazar' }) });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}

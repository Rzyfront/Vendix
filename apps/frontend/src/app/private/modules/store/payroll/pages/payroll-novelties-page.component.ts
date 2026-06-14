import { Component, inject, DestroyRef, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PayrollService } from '../services/payroll.service';
import {
  Employee,
  PayrollNovelty,
  QueryNoveltyDto,
  NoveltyStatus,
  NoveltyType,
} from '../interfaces/payroll.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  getDefaultStartDate,
  getDefaultEndDate,
} from '../../../../../shared/utils/date.util';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { PaginationComponent } from '../../../../../shared/components/pagination/pagination.component';

import { NoveltiesListComponent } from '../components/novelties/novelties-list.component';
import { NoveltyFormModalComponent } from '../components/novelties/novelty-form-modal.component';
import { getNoveltyTypeLabel } from '../components/novelties/novelty-labels';

@Component({
  selector: 'vendix-payroll-novelties-page',
  standalone: true,
  imports: [
    StatsComponent,
    PaginationComponent,
    NoveltiesListComponent,
    NoveltyFormModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Pendientes"
          [value]="pendingCount()"
          smallText="Por aplicar en nómina"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Aplicadas del Mes"
          [value]="appliedThisMonth()"
          smallText="Mes actual"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Tipo Más Frecuente"
          [value]="topTypeLabel()"
          smallText="Mes actual"
          iconName="list-checks"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Total del Mes"
          [value]="monthTotal()"
          smallText="Novedades registradas"
          iconName="calendar-days"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Novelties List -->
      <app-novelties-list
        [novelties]="novelties()"
        [loading]="loading()"
        [employeeOptions]="employeeOptions()"
        (create)="openCreateModal()"
        (search)="onSearch($event)"
        (filter)="onFilterChange($event)"
        (edit)="openEditModal($event)"
        (remove)="onDelete($event)"
      />

      <!-- Pagination -->
      <div class="mt-4 flex justify-center">
        <app-pagination
          [currentPage]="filters().page"
          [totalPages]="totalPages()"
          [total]="totalItems()"
          [limit]="filters().limit"
          (pageChange)="onPageChange($event)"
        />
      </div>

      <!-- Create/Edit Modal -->
      @defer (when isFormModalOpen()) {
        <app-novelty-form-modal
          [(isOpen)]="isFormModalOpen"
          [novelty]="selectedNovelty()"
          [employeeOptions]="employeeOptions()"
          (saved)="onSaved()"
        ></app-novelty-form-modal>
      }
    </div>
  `,
})
export class PayrollNoveltiesPageComponent {
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // List state
  readonly novelties = signal<PayrollNovelty[]>([]);
  readonly loading = signal(false);

  // Stats state
  readonly pendingCount = signal(0);
  readonly appliedThisMonth = signal(0);
  readonly monthTotal = signal(0);
  readonly topTypeLabel = signal('—');

  // Employee options (selector de empleado en filtros y formulario)
  readonly employeeOptions = signal<Array<{ label: string; value: number }>>([]);

  // Filters + pagination
  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );

  private searchTerm = '';
  private employeeFilter: number | null = null;
  private typeFilter: NoveltyType | '' = '';
  private statusFilter: NoveltyStatus | '' = '';

  // Modal state
  readonly isFormModalOpen = signal(false);
  readonly selectedNovelty = signal<PayrollNovelty | null>(null);

  constructor() {
    this.loadNovelties();
    this.loadStats();
    this.loadEmployees();
  }

  loadNovelties(): void {
    this.loading.set(true);
    const query: QueryNoveltyDto = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm) query.search = this.searchTerm;
    if (this.employeeFilter) query.employee_id = this.employeeFilter;
    if (this.typeFilter) query.novelty_type = this.typeFilter;
    if (this.statusFilter) query.status = this.statusFilter;

    this.payrollService
      .getNovelties(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.novelties.set(res.data || []);
          this.totalItems.set(res.meta?.total ?? (res.data?.length ?? 0));
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error cargando novedades',
          });
        },
      });
  }

  /**
   * Stats sin endpoint dedicado: se derivan de meta.total de consultas
   * acotadas (limit=1) + un slice del mes para el tipo más frecuente.
   */
  loadStats(): void {
    const monthStart = getDefaultStartDate();
    const monthEnd = getDefaultEndDate();

    this.payrollService
      .getNovelties({ status: 'pending', limit: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.pendingCount.set(res.meta?.total ?? 0),
      });

    this.payrollService
      .getNovelties({
        status: 'applied',
        date_from: monthStart,
        date_to: monthEnd,
        limit: 1,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.appliedThisMonth.set(res.meta?.total ?? 0),
      });

    this.payrollService
      .getNovelties({ date_from: monthStart, date_to: monthEnd, limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.monthTotal.set(res.meta?.total ?? (res.data?.length ?? 0));
          this.topTypeLabel.set(this.computeTopType(res.data || []));
        },
      });
  }

  private computeTopType(novelties: PayrollNovelty[]): string {
    if (novelties.length === 0) return '—';
    const counts = new Map<string, number>();
    for (const novelty of novelties) {
      counts.set(
        novelty.novelty_type,
        (counts.get(novelty.novelty_type) || 0) + 1,
      );
    }
    let topType = '';
    let topCount = 0;
    for (const [type, count] of counts) {
      if (count > topCount) {
        topType = type;
        topCount = count;
      }
    }
    return topType ? getNoveltyTypeLabel(topType) : '—';
  }

  private loadEmployees(): void {
    this.payrollService
      .getEmployees({ status: 'active', limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.employeeOptions.set(
            (res.data || []).map((emp: Employee) => ({
              label: `${emp.first_name} ${emp.last_name} (${emp.document_number})`,
              value: emp.id,
            })),
          );
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadNovelties();
  }

  onFilterChange(values: FilterValues): void {
    this.employeeFilter = values['employee_id']
      ? Number(values['employee_id'])
      : null;
    this.typeFilter = (values['novelty_type'] as NoveltyType) || '';
    this.statusFilter = (values['status'] as NoveltyStatus) || '';
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadNovelties();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadNovelties();
  }

  openCreateModal(): void {
    this.selectedNovelty.set(null);
    this.isFormModalOpen.set(true);
  }

  openEditModal(novelty: PayrollNovelty): void {
    if (novelty.status !== 'pending') return;
    this.selectedNovelty.set(novelty);
    this.isFormModalOpen.set(true);
  }

  onDelete(novelty: PayrollNovelty): void {
    if (novelty.status !== 'pending') return;
    this.payrollService
      .deleteNovelty(novelty.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.show({
            variant: 'success',
            description: 'Novedad eliminada',
          });
          this.onSaved();
        },
        error: () => {
          this.toastService.show({
            variant: 'error',
            description: 'Error al eliminar la novedad',
          });
        },
      });
  }

  onSaved(): void {
    this.loadNovelties();
    this.loadStats();
  }
}

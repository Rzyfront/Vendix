import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';

import {
  StatsComponent,
  ToastService,
  FilterValues,
  SelectorOption,
} from '../../../../../shared/components/index';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { environment } from '../../../../../../environments/environment';

import { AdjustmentDetailModalComponent } from './components/adjustment-detail-modal.component';
import { AdjustmentCreateModalComponent } from './components/adjustment-create-modal.component';
import { AdjustmentListComponent } from './components/adjustment-list';

import { InventoryService } from '../services';
import {
  InventoryAdjustment,
  AdjustmentType,
  BatchCreateAdjustmentsRequest,
} from '../interfaces';

@Component({
  selector: 'app-stock-adjustments',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    AdjustmentDetailModalComponent,
    AdjustmentCreateModalComponent,
    AdjustmentListComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Ajustes"
          [value]="stats.total"
          smallText="Movimientos registrados"
          iconName="clipboard-list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pérdidas"
          [value]="stats.losses"
          smallText="Productos extraviados"
          iconName="trending-down"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Daños"
          [value]="stats.damages"
          smallText="Productos dañados"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Correcciones"
          [value]="stats.corrections"
          smallText="Ajustes de inventario"
          iconName="edit-3"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Adjustments List -->
      <app-adjustment-list
        [adjustments]="filtered_adjustments"
        [isLoading]="is_loading"
        [paginationData]="pagination"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="viewDetail($event)"
        (pageChange)="changePage($event)"
      ></app-adjustment-list>

      <!-- Create Modal (Wizard) -->
      <app-adjustment-create-modal
        [isOpen]="showCreateModal()"
        [isSubmitting]="isSubmitting()"
        [locations]="locationOptions()"
        (isOpenChange)="showCreateModal.set($event)"
        (cancel)="showCreateModal.set(false)"
        (save)="onCreateDraft($event)"
        (saveAndComplete)="onCreateAndComplete($event)"
      ></app-adjustment-create-modal>

      <!-- Detail Modal -->
      <app-adjustment-detail-modal
        [isOpen]="is_detail_modal_open"
        [adjustment]="selected_adjustment"
        [isProcessing]="isSubmitting()"
        (isOpenChange)="is_detail_modal_open = $event"
        (close)="closeDetailModal()"
        (approve)="onApprove($event)"
        (deleteAdjustment)="onDelete($event)"
      ></app-adjustment-detail-modal>
    </div>
  `,
})
export class StockAdjustmentsComponent implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private http = inject(HttpClient);

  // Data
  adjustments: InventoryAdjustment[] = [];
  filtered_adjustments: InventoryAdjustment[] = [];

  // Stats
  stats = { total: 0, losses: 0, damages: 0, corrections: 0 };

  // Pagination
  pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };

  // Filters
  current_type: AdjustmentType | 'all' = 'all';
  search_term = '';

  // UI State
  is_loading = false;
  is_detail_modal_open = false;
  selected_adjustment: InventoryAdjustment | null = null;

  // Signals
  showCreateModal = signal(false);
  isSubmitting = signal(false);
  locationOptions = signal<SelectorOption[]>([]);

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadAdjustments();
    this.loadLocations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ============================================================
  // Data Loading
  // ============================================================

  loadAdjustments(): void {
    this.is_loading = true;
    const query: any = {
      ...(this.current_type !== 'all' ? { type: this.current_type } : {}),
      limit: this.pagination.limit,
      offset: (this.pagination.page - 1) * this.pagination.limit,
    };

    this.inventoryService.getAdjustments(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.data?.adjustments) {
            this.adjustments = response.data.adjustments;
            this.pagination.total = response.data.total;
            this.pagination.totalPages = Math.ceil(
              response.data.total / this.pagination.limit,
            );
            this.applyFilters();
            this.calculateStats();
          }
          if (this.adjustments.length === 0 && this.pagination.page > 1) {
            this.pagination.page--;
            this.loadAdjustments();
            return;
          }
          this.is_loading = false;
        },
        error: (error) => {
          this.toastService.error(error || 'Error al cargar ajustes');
          this.is_loading = false;
        },
      });
  }

  loadLocations(): void {
    this.http.get<any>(`${environment.apiUrl}/store/inventory/locations`)
      .pipe(
        map((r) => r.data || r),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (locations: any[]) => {
          const arr = Array.isArray(locations) ? locations : [];
          this.locationOptions.set(
            arr.map((l) => ({ value: l.id, label: l.name })),
          );
        },
        error: () => {},
      });
  }

  applyFilters(): void {
    let filtered = [...this.adjustments];

    if (this.current_type !== 'all') {
      filtered = filtered.filter(
        (a) => a.adjustment_type === this.current_type,
      );
    }

    if (this.search_term) {
      const term = this.search_term.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.products?.name?.toLowerCase().includes(term) ||
          a.product?.name?.toLowerCase().includes(term) ||
          a.description?.toLowerCase().includes(term),
      );
    }

    this.filtered_adjustments = filtered;
  }

  calculateStats(): void {
    this.stats.total = this.adjustments.length;
    this.stats.losses = this.adjustments.filter(
      (a) => a.adjustment_type === 'loss',
    ).length;
    this.stats.damages = this.adjustments.filter(
      (a) => a.adjustment_type === 'damage',
    ).length;
    this.stats.corrections = this.adjustments.filter(
      (a) => a.adjustment_type === 'manual_correction',
    ).length;
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onSearch(term: string): void {
    this.search_term = term;
    this.applyFilters();
  }

  onFilterChange(values: FilterValues): void {
    const typeValue = values['adjustment_type'] as string;
    this.current_type = typeValue ? (typeValue as AdjustmentType) : 'all';
    this.pagination.page = 1;
    this.loadAdjustments();
  }

  onClearFilters(): void {
    this.current_type = 'all';
    this.search_term = '';
    this.pagination.page = 1;
    this.loadAdjustments();
  }

  changePage(page: number): void {
    this.pagination.page = page;
    this.loadAdjustments();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.showCreateModal.set(true);
        break;
      case 'refresh':
        this.loadAdjustments();
        break;
    }
  }

  viewDetail(adjustment: InventoryAdjustment): void {
    this.selected_adjustment = adjustment;
    this.is_detail_modal_open = true;
  }

  closeDetailModal(): void {
    this.is_detail_modal_open = false;
    this.selected_adjustment = null;
  }

  // ============================================================
  // Create Actions
  // ============================================================

  onCreateDraft(dto: BatchCreateAdjustmentsRequest): void {
    this.isSubmitting.set(true);
    this.inventoryService.batchCreateAdjustments(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Ajustes creados como borrador');
          this.showCreateModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err || 'Error al crear ajustes');
          this.isSubmitting.set(false);
        },
      });
  }

  onCreateAndComplete(dto: BatchCreateAdjustmentsRequest): void {
    this.isSubmitting.set(true);
    this.inventoryService.batchCreateAndComplete(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Ajustes creados y aprobados. Movimientos de inventario aplicados.');
          this.showCreateModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err || 'Error al crear y aprobar ajustes');
          this.isSubmitting.set(false);
        },
      });
  }

  // ============================================================
  // Detail Actions
  // ============================================================

  async onApprove(adjustment: InventoryAdjustment): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Aprobar ajuste',
      message: `¿Aprobar el ajuste de ${adjustment.products?.name || 'producto'}? (${adjustment.quantity_change > 0 ? '+' : ''}${adjustment.quantity_change} unidades)`,
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.inventoryService.approveAdjustment(adjustment.id, 0)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Ajuste aprobado');
          this.is_detail_modal_open = false;
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err || 'Error al aprobar');
          this.isSubmitting.set(false);
        },
      });
  }

  async onDelete(adjustment: InventoryAdjustment): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar ajuste',
      message: `¿Eliminar el ajuste de ${adjustment.products?.name || 'producto'}? Esta accion no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.inventoryService.deleteAdjustment(adjustment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Ajuste eliminado');
          this.is_detail_modal_open = false;
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err || 'Error al eliminar');
          this.isSubmitting.set(false);
        },
      });
  }

  private refresh(): void {
    this.inventoryService.invalidateCache();
    this.loadAdjustments();
  }
}

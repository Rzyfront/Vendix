import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';

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
import { BulkAdjustmentModalComponent } from './components/bulk-adjustment-modal.component';
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
    StatsComponent,
    AdjustmentDetailModalComponent,
    AdjustmentCreateModalComponent,
    BulkAdjustmentModalComponent,
    AdjustmentListComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Ajustes"
          [value]="stats().total"
          smallText="Movimientos registrados"
          iconName="clipboard-list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pérdidas"
          [value]="stats().losses"
          smallText="Productos extraviados"
          iconName="trending-down"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Daños"
          [value]="stats().damages"
          smallText="Productos dañados"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Correcciones"
          [value]="stats().corrections"
          smallText="Ajustes de inventario"
          iconName="edit-3"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Adjustments List -->
      <app-adjustment-list
        [adjustments]="filtered_adjustments()"
        [isLoading]="is_loading()"
        [paginationData]="pagination()"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="viewDetail($event)"
        (pageChange)="changePage($event)"
      ></app-adjustment-list>

      @defer (when showCreateModal()) {
        <app-adjustment-create-modal
          [isOpen]="showCreateModal()"
          [isSubmitting]="isSubmitting()"
          [locations]="locationOptions()"
          (isOpenChange)="showCreateModal.set($event)"
          (cancel)="showCreateModal.set(false)"
          (save)="onCreateDraft($event)"
          (saveAndComplete)="onCreateAndComplete($event)"
        ></app-adjustment-create-modal>
      }

      @defer (when showBulkModal()) {
        <app-bulk-adjustment-modal
          [isOpen]="showBulkModal()"
          [locations]="locationOptions()"
          (isOpenChange)="showBulkModal.set($event)"
          (completed)="refresh()"
        ></app-bulk-adjustment-modal>
      }

      @defer (when is_detail_modal_open()) {
        <app-adjustment-detail-modal
          [isOpen]="is_detail_modal_open()"
          [adjustment]="selected_adjustment()"
          [isProcessing]="isSubmitting()"
          (isOpenChange)="is_detail_modal_open.set($event)"
          (close)="closeDetailModal()"
          (approve)="onApprove($event)"
          (deleteAdjustment)="onDelete($event)"
        ></app-adjustment-detail-modal>
      }
    </div>
  `,
})
export class StockAdjustmentsComponent implements OnInit, OnDestroy {
  private inventoryService = inject(InventoryService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private http = inject(HttpClient);

  // Data
  readonly adjustments = signal<InventoryAdjustment[]>([]);
  readonly filtered_adjustments = signal<InventoryAdjustment[]>([]);

  // Stats
  readonly stats = signal({ total: 0, losses: 0, damages: 0, corrections: 0 });

  // Pagination
  readonly pagination = signal({ page: 1, limit: 10, total: 0, totalPages: 0 });

  // Filters
  current_type: AdjustmentType | 'all' = 'all';
  search_term = '';

  // UI State
  readonly is_loading = signal(false);
  readonly is_detail_modal_open = signal(false);
  readonly selected_adjustment = signal<InventoryAdjustment | null>(null);

  // Signals
  showCreateModal = signal(false);
  showBulkModal = signal(false);
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
    this.is_loading.set(true);
    const pag = this.pagination();
    const query: any = {
      ...(this.current_type !== 'all' ? { type: this.current_type } : {}),
      limit: pag.limit,
      offset: (pag.page - 1) * pag.limit,
    };

    this.inventoryService
      .getAdjustments(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.data?.adjustments) {
            this.adjustments.set(response.data.adjustments);
            this.pagination.update(p => ({
              ...p,
              total: response.data.total,
              totalPages: Math.ceil(response.data.total / p.limit),
            }));
            this.applyFilters();
            this.calculateStats();
          }
          if (this.adjustments().length === 0 && this.pagination().page > 1) {
            this.pagination.update(p => ({ ...p, page: p.page - 1 }));
            this.loadAdjustments();
            return;
          }
          this.is_loading.set(false);
        },
        error: (error) => {
          this.toastService.error(error || 'Error al cargar ajustes');
          this.is_loading.set(false);
        },
      });
  }

  loadLocations(): void {
    this.http
      .get<any>(`${environment.apiUrl}/store/inventory/locations`)
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
    let filtered = [...this.adjustments()];

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

    this.filtered_adjustments.set(filtered);
  }

  calculateStats(): void {
    const adjs = this.adjustments();
    this.stats.set({
      total: adjs.length,
      losses: adjs.filter((a) => a.adjustment_type === 'loss').length,
      damages: adjs.filter((a) => a.adjustment_type === 'damage').length,
      corrections: adjs.filter((a) => a.adjustment_type === 'manual_correction').length,
    });
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
    this.pagination.update(p => ({ ...p, page: 1 }));
    this.loadAdjustments();
  }

  onClearFilters(): void {
    this.current_type = 'all';
    this.search_term = '';
    this.pagination.update(p => ({ ...p, page: 1 }));
    this.loadAdjustments();
  }

  changePage(page: number): void {
    this.pagination.update(p => ({ ...p, page }));
    this.loadAdjustments();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.showCreateModal.set(true);
        break;
      case 'bulk':
        this.showBulkModal.set(true);
        break;
      case 'refresh':
        this.loadAdjustments();
        break;
    }
  }

  viewDetail(adjustment: InventoryAdjustment): void {
    this.selected_adjustment.set(adjustment);
    this.is_detail_modal_open.set(true);
  }

  closeDetailModal(): void {
    this.is_detail_modal_open.set(false);
    this.selected_adjustment.set(null);
  }

  // ============================================================
  // Create Actions
  // ============================================================

  onCreateDraft(dto: BatchCreateAdjustmentsRequest): void {
    this.isSubmitting.set(true);
    this.inventoryService
      .batchCreateAdjustments(dto)
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
    this.inventoryService
      .batchCreateAndComplete(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success(
            'Ajustes creados y aprobados. Movimientos de inventario aplicados.',
          );
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
    this.inventoryService
      .approveAdjustment(adjustment.id, 0)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Ajuste aprobado');
          this.is_detail_modal_open.set(false);
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
    this.inventoryService
      .deleteAdjustment(adjustment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Ajuste eliminado');
          this.is_detail_modal_open.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err || 'Error al eliminar');
          this.isSubmitting.set(false);
        },
      });
  }

  refresh(): void {
    this.inventoryService.invalidateCache();
    this.loadAdjustments();
  }
}

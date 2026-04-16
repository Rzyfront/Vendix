import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';

import { Subject, takeUntil } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { SelectorOption } from '../../../../../shared/components/index';
import { environment } from '../../../../../../environments/environment';
import { TransfersService } from './services';
import { TransferListComponent } from './components/transfer-list.component';
import { TransferCreateModalComponent } from './components/transfer-create-modal.component';
import { TransferDetailModalComponent } from './components/transfer-detail-modal.component';
import {
  StockTransfer,
  TransferStats,
  TransferQuery,
  CreateTransferRequest,
  CompleteTransferItem,
} from './interfaces';

@Component({
  selector: 'app-transfers',
  standalone: true,
  imports: [
    StatsComponent,
    TransferListComponent,
    TransferCreateModalComponent,
    TransferDetailModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Transferencias creadas"
          iconName="repeat"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Borradores"
          [value]="stats().draft"
          smallText="Por aprobar"
          iconName="file-text"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="En Tránsito"
          [value]="stats().in_transit"
          smallText="En camino"
          iconName="truck"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Completadas"
          [value]="stats().completed"
          smallText="Recibidas"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="statsLoading()"
        ></app-stats>
      </div>

      <!-- List -->
      <app-transfer-list
        [transfers]="transfers()"
        [isLoading]="loading()"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="onViewDetail($event)"
        (approve)="onApprove($event)"
        (complete)="onStartComplete($event)"
        (cancel)="onCancel($event)"
        (deleteTransfer)="onDelete($event)"
      ></app-transfer-list>

      @defer (when showCreateModal()) {
        <app-transfer-create-modal
          [isOpen]="showCreateModal()"
          [isSubmitting]="isSubmitting()"
          [locations]="locationOptions()"
          (isOpenChange)="showCreateModal.set($event)"
          (cancel)="showCreateModal.set(false)"
          (save)="onCreate($event)"
          (saveAndComplete)="onCreateAndComplete($event)"
        ></app-transfer-create-modal>
      }

      @defer (when showDetailModal()) {
        <app-transfer-detail-modal
          [isOpen]="showDetailModal()"
          [transfer]="selectedTransfer()"
          [isProcessing]="isSubmitting()"
          (isOpenChange)="showDetailModal.set($event)"
          (closed)="showDetailModal.set(false)"
          (approveTransfer)="onApprove($event)"
          (cancelTransfer)="onCancel($event)"
          (completeTransfer)="onComplete($event)"
        ></app-transfer-detail-modal>
      }
    </div>
  `,
})
export class TransfersComponent implements OnInit, OnDestroy {
  private transfersService = inject(TransfersService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private http = inject(HttpClient);

  stats = signal<TransferStats>({
    total: 0,
    draft: 0,
    in_transit: 0,
    completed: 0,
    cancelled: 0,
  });
  transfers = signal<StockTransfer[]>([]);
  loading = signal(false);
  statsLoading = signal(false);
  isSubmitting = signal(false);

  showCreateModal = signal(false);
  showDetailModal = signal(false);
  selectedTransfer = signal<StockTransfer | null>(null);
  locationOptions = signal<SelectorOption[]>([]);

  searchTerm = '';
  statusFilter = '';

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadStats();
    this.loadTransfers();
    this.loadLocations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.transfersService
      .getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.stats.set(s);
          this.statsLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar estadísticas');
          this.statsLoading.set(false);
        },
      });
  }

  loadTransfers(): void {
    this.loading.set(true);
    const query: TransferQuery = {
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.statusFilter && { status: this.statusFilter as any }),
    };

    this.transfersService
      .getAll(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.transfers.set(Array.isArray(data) ? data : []);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar transferencias');
          this.loading.set(false);
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

  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadTransfers();
  }

  onFilterChange(values: Record<string, any>): void {
    this.statusFilter = values['status'] || '';
    this.loadTransfers();
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.loadTransfers();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.showCreateModal.set(true);
    if (action === 'refresh') this.refresh();
  }

  onViewDetail(transfer: StockTransfer): void {
    this.selectedTransfer.set(transfer);
    this.showDetailModal.set(true);
  }

  onCreate(dto: CreateTransferRequest): void {
    this.isSubmitting.set(true);
    this.transfersService
      .create(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia creada exitosamente');
          this.showCreateModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(
            err.message || 'Error al crear transferencia',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  onCreateAndComplete(dto: CreateTransferRequest): void {
    this.isSubmitting.set(true);
    this.transfersService
      .createAndComplete(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success(
            'Transferencia creada y completada. Movimientos de inventario aplicados.',
          );
          this.showCreateModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(
            err.message || 'Error al crear y completar transferencia',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  async onApprove(transfer: StockTransfer): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Aprobar transferencia',
      message: `¿Aprobar la transferencia ${transfer.transfer_number}? El stock será reservado en la ubicación de origen.`,
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.transfersService
      .approve(transfer.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia aprobada');
          this.showDetailModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err.message || 'Error al aprobar');
          this.isSubmitting.set(false);
        },
      });
  }

  onStartComplete(transfer: StockTransfer): void {
    this.selectedTransfer.set(transfer);
    this.showDetailModal.set(true);
  }

  onComplete(items: CompleteTransferItem[]): void {
    const transfer = this.selectedTransfer();
    if (!transfer) return;

    this.isSubmitting.set(true);
    this.transfersService
      .complete(transfer.id, items)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia completada');
          this.showDetailModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err.message || 'Error al completar');
          this.isSubmitting.set(false);
        },
      });
  }

  async onCancel(transfer: StockTransfer): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar transferencia',
      message: `¿Cancelar la transferencia ${transfer.transfer_number}?${transfer.status === 'in_transit' ? ' El stock reservado será liberado.' : ''}`,
      confirmText: 'Cancelar transferencia',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.transfersService
      .cancel(transfer.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia cancelada');
          this.showDetailModal.set(false);
          this.refresh();
        },
        error: (err) =>
          this.toastService.error(err.message || 'Error al cancelar'),
      });
  }

  async onDelete(transfer: StockTransfer): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar transferencia',
      message: `¿Eliminar la transferencia ${transfer.transfer_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.transfersService
      .delete(transfer.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia eliminada');
          this.refresh();
        },
        error: (err) =>
          this.toastService.error(err.message || 'Error al eliminar'),
      });
  }

  private refresh(): void {
    this.transfersService.invalidateCache();
    this.loadStats();
    this.loadTransfers();
  }
}

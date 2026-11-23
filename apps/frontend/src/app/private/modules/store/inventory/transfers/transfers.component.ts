import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
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
import { TransferQuickMoveModalComponent } from './quick-move/transfer-quick-move-modal.component';
import type {
  TransferCloseWithLossRequest,
  TransferDispatchRequest,
} from './advanced/transfer-flow-panel.component';
import type { TransferFlowNote } from './advanced/transfer-advanced';
import type {
  TransferPayload,
  TransferPickerRow,
  TransferProductSearchFn,
} from './quick-move/transfer-draft';
import {
  StockTransfer,
  TransferStats,
  TransferQuery,
  CreateTransferRequest,
  CompleteTransferItem} from './interfaces';

@Component({
  selector: 'app-transfers',
  standalone: true,
  imports: [
    StatsComponent,
    TransferListComponent,
    TransferCreateModalComponent,
    TransferDetailModalComponent,
    TransferQuickMoveModalComponent,
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

      <!-- Movimiento rápido (D1): la vía principal para mover inventario -->
      @defer (when showQuickMoveModal()) {
        <app-transfer-quick-move-modal
          [isOpen]="showQuickMoveModal()"
          [isSubmitting]="isSubmitting()"
          [locations]="locationOptions()"
          [searchFn]="searchProductsFn"
          advancedRoute="/admin/inventory/transfers/new"
          (isOpenChange)="showQuickMoveModal.set($event)"
          (cancel)="showQuickMoveModal.set(false)"
          (quickMove)="onQuickMove($event)"
          (useDetailedFlow)="onUseDetailedFlow()"
        ></app-transfer-quick-move-modal>
      }

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
          (dispatchTransfer)="onDispatch($event)"
          (closeWithLoss)="onCloseWithLoss($event)"
          (openNote)="onOpenNote($event)"
        ></app-transfer-detail-modal>
      }
    </div>
  `})
export class TransfersComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private transfersService = inject(TransfersService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private http = inject(HttpClient);
  private router = inject(Router);

  stats = signal<TransferStats>({
    total: 0,
    draft: 0,
    in_transit: 0,
    completed: 0,
    cancelled: 0});
  transfers = signal<StockTransfer[]>([]);
  loading = signal(false);
  statsLoading = signal(false);
  isSubmitting = signal(false);

  showCreateModal = signal(false);
  showQuickMoveModal = signal(false);
  showDetailModal = signal(false);
  selectedTransfer = signal<StockTransfer | null>(null);
  locationOptions = signal<SelectorOption[]>([]);

  searchTerm = '';
  statusFilter = '';
  alertFilter = false;
ngOnInit(): void {
    this.loadStats();
    this.loadTransfers();
    this.loadLocations();
  }
loadStats(): void {
    this.statsLoading.set(true);
    this.transfersService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.stats.set(s);
          this.statsLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar estadísticas');
          this.statsLoading.set(false);
        }});
  }

  loadTransfers(): void {
    this.loading.set(true);
    const query: TransferQuery = {
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.statusFilter && { status: this.statusFilter as any }),
      ...(this.alertFilter && { with_alert: true })};

    this.transfersService
      .getAll(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.transfers.set(Array.isArray(data) ? data : []);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar transferencias');
          this.loading.set(false);
        }});
  }

  loadLocations(): void {
    this.http
      .get<any>(`${environment.apiUrl}/store/inventory/locations`)
      .pipe(
        map((r) => r.data || r),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (locations: any[]) => {
          const arr = Array.isArray(locations) ? locations : [];
          this.locationOptions.set(
            arr.map((l) => ({ value: l.id, label: l.name })),
          );
        },
        error: (err) => this.toastService.error('Error al cargar ubicaciones: ' + (err?.error?.message || err?.message || err)),
      });
  }

  /**
   * Búsqueda del picker del modal rápido. Cada variante llega como fila propia
   * con su disponible en origen y destino.
   */
  readonly searchProductsFn: TransferProductSearchFn = (
    term: string,
    from: number,
    to: number,
  ): Observable<TransferPickerRow[]> =>
    this.transfersService.searchTransferableProducts(term, from, to, 30);

  /** D1: mover ahora — crea y completa en una transacción. */
  onQuickMove(payload: TransferPayload): void {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.transfersService
      .createAndComplete(payload as CreateTransferRequest)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            'Inventario movido: el origen ya descontó y el destino ya sumó.',
          );
          this.isSubmitting.set(false);
          this.showQuickMoveModal.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(
            err.message || 'Error al mover el inventario',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  /** El comerciante pidió el flujo con borrador, aprobación y despacho. */
  onUseDetailedFlow(): void {
    this.showQuickMoveModal.set(false);
    this.showCreateModal.set(true);
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadTransfers();
  }

  onFilterChange(values: Record<string, any>): void {
    this.statusFilter = values['status'] || '';
    this.alertFilter = values['alert'] === 'with_alert';
    this.loadTransfers();
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.alertFilter = false;
    this.loadTransfers();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.showQuickMoveModal.set(true);
    if (action === 'advanced') void this.router.navigate(['/admin/inventory/transfers/new']);
    if (action === 'refresh') this.refresh();
  }

  onViewDetail(transfer: StockTransfer): void {
    this.selectedTransfer.set(transfer);
    this.showDetailModal.set(true);
    this.reloadSelected(transfer.id);
  }

  /**
   * El listado no trae remisiones ni lotes: el detalle se completa con
   * `GET :id` (mismo shape que devuelven despachar/recibir).
   */
  private reloadSelected(id: number): void {
    this.transfersService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full) => {
          if (full && this.selectedTransfer()?.id === id) {
            this.selectedTransfer.set(full);
          }
        },
        error: () => {
          /* el detalle del listado sigue sirviendo */
        },
      });
  }

  /** D3 — despacho con conteo de salida. El modal queda abierto con la remisión. */
  onDispatch(body: TransferDispatchRequest): void {
    const transfer = this.selectedTransfer();
    if (!transfer || this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.transfersService
      .dispatch(transfer.id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.isSubmitting.set(false);
          this.toastService.success(
            updated?.dispatch_note
              ? `Despachada. Remisión de salida ${updated.dispatch_note.dispatch_number}.`
              : 'Transferencia despachada.',
          );
          if (updated) this.selectedTransfer.set(updated);
          this.refresh();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.toastService.error(err.message || 'Error al despachar');
        },
      });
  }

  /** D4 — cierra el pendiente como pérdida (solo tras la fecha límite). */
  onCloseWithLoss(body: TransferCloseWithLossRequest): void {
    const transfer = this.selectedTransfer();
    if (!transfer || this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.transfersService
      .closeWithLoss(transfer.id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.isSubmitting.set(false);
          this.toastService.success('Pendiente cerrado como pérdida.');
          if (updated) this.selectedTransfer.set(updated);
          this.refresh();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.toastService.error(err.message || 'Error al cerrar como pérdida');
        },
      });
  }

  /** Abre la remisión ligada en su módulo (imprimir / PDF desde ahí). */
  onOpenNote(note: TransferFlowNote): void {
    this.showDetailModal.set(false);
    void this.router.navigate(['/admin/orders/dispatch-notes', note.id]);
  }

  onCreate(dto: CreateTransferRequest): void {
    this.isSubmitting.set(true);
    this.transfersService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
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
        }});
  }

  onCreateAndComplete(dto: CreateTransferRequest): void {
    this.isSubmitting.set(true);
    this.transfersService
      .createAndComplete(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
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
        }});
  }

  async onApprove(transfer: StockTransfer): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Aprobar transferencia',
      message: `¿Aprobar la transferencia ${transfer.transfer_number}? El stock será reservado en la ubicación de origen.`,
      confirmText: 'Aprobar',
      cancelText: 'Cancelar'});
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.transfersService
      .approve(transfer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
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
        }});
  }

  onStartComplete(transfer: StockTransfer): void {
    this.onViewDetail(transfer);
  }

  onComplete(items: CompleteTransferItem[]): void {
    const transfer = this.selectedTransfer();
    if (!transfer) return;

    this.isSubmitting.set(true);
    this.transfersService
      .complete(transfer.id, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          // D4 — una recepción parcial deja la transferencia abierta.
          this.toastService.success(
            updated?.status === 'partially_received'
              ? 'Recepción registrada. Quedan productos por llegar.'
              : 'Transferencia recibida',
          );
          this.showDetailModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toastService.error(err.message || 'Error al completar');
          this.isSubmitting.set(false);
        }});
  }

  async onCancel(transfer: StockTransfer): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar transferencia',
      message: `¿Cancelar la transferencia ${transfer.transfer_number}?${transfer.status === 'in_transit' ? ' El stock reservado será liberado.' : ''}`,
      confirmText: 'Cancelar transferencia',
      cancelText: 'Volver',
      confirmVariant: 'danger'});
    if (!confirmed) return;

    this.transfersService
      .cancel(transfer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia cancelada');
          this.showDetailModal.set(false);
          this.refresh();
        },
        error: (err) =>
          this.toastService.error(err.message || 'Error al cancelar')});
  }

  async onDelete(transfer: StockTransfer): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar transferencia',
      message: `¿Eliminar la transferencia ${transfer.transfer_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'});
    if (!confirmed) return;

    this.transfersService
      .delete(transfer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Transferencia eliminada');
          this.refresh();
        },
        error: (err) =>
          this.toastService.error(err.message || 'Error al eliminar')});
  }

  private refresh(): void {
    this.transfersService.invalidateCache();
    this.loadStats();
    this.loadTransfers();
  }
}

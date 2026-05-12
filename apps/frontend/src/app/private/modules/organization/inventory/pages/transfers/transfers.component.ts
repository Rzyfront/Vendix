import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  AlertBannerComponent,
  DialogService,
  FilterValues,
  SelectorOption,
  StatsComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  OrgInventoryService,
  OrgLocationRow,
} from '../../services/org-inventory.service';
import { OrgTransfersService } from '../../services/org-transfers.service';
import {
  CompleteOrgTransferItemRequest,
  CreateOrgTransferRequest,
  normalizeOrgTransferStatus,
  OrgTransfer,
  OrgTransferQuery,
  OrgTransferStats,
  OrgTransferStatus,
} from '../../interfaces/org-transfer.interface';
import { OrgTransferListComponent } from './components/transfer-list.component';
import { OrgTransferCreateModalComponent } from './components/transfer-create-modal.component';
import { OrgTransferDetailModalComponent } from './components/transfer-detail-modal.component';

/**
 * ORG_ADMIN — Transferencias de stock con lifecycle completo
 * (pending → approved → in_transit → received) y opción de cancelar en cualquier
 * estado no terminal.
 *
 * Permission gating:
 *   - `organization:inventory:transfers:read`     → entrar
 *   - `organization:inventory:transfers:create`   → "Nueva transferencia"
 *   - `organization:inventory:transfers:approve`  → "Aprobar"
 *   - `organization:inventory:transfers:dispatch` → "Despachar" (origen pierde stock)
 *   - `organization:inventory:transfers:complete` → "Completar recepción"
 *   - `organization:inventory:transfers:cancel`   → "Cancelar"
 *
 * Todos los gates exigen además `operatingScope === 'ORGANIZATION'`. STORE-scoped
 * orgs siguen usando `/store/inventory/transfers`.
 */
@Component({
  selector: 'vendix-org-transfers',
  standalone: true,
  imports: [
    RouterLink,
    AlertBannerComponent,
    StatsComponent,
    OrgTransferListComponent,
    OrgTransferCreateModalComponent,
    OrgTransferDetailModalComponent,
  ],
  template: `
    <div class="w-full">
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
        />
        <app-stats
          title="Pendientes"
          [value]="stats().pending"
          smallText="Por aprobar"
          iconName="clock"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-500"
          [loading]="statsLoading()"
        />
        <app-stats
          title="En tránsito"
          [value]="stats().in_transit"
          smallText="En camino"
          iconName="truck"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="statsLoading()"
        />
        <app-stats
          title="Recibidas"
          [value]="stats().received"
          smallText="Stock aplicado"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="statsLoading()"
        />
      </div>

      @if (!isOrgScope()) {
        <app-alert-banner variant="warning" icon="lock" class="mx-2 md:mx-0 mb-2 md:mb-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <span>
              Modo STORE activo. Las transferencias inter-tienda están disponibles solo en modo ORGANIZATION.
            </span>
            <a
              routerLink="/admin/settings/operating-scope"
              class="text-sm font-medium underline hover:no-underline whitespace-nowrap"
            >
              Cambiar modo →
            </a>
          </div>
        </app-alert-banner>
      }

      <app-org-transfer-list
        [transfers]="transfers()"
        [isLoading]="loading()"
        [paginationData]="pagination()"
        [canCreate]="canCreate()"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearFilters)="onClearFilters()"
        (actionClick)="onActionClick($event)"
        (viewDetail)="onViewDetail($event)"
        (pageChange)="onPageChange($event)"
      />

      @defer (when showCreateModal()) {
        <app-org-transfer-create-modal
          [isOpen]="showCreateModal()"
          [isSubmitting]="isSubmitting()"
          [locations]="locationOptions()"
          (isOpenChange)="showCreateModal.set($event)"
          (cancel)="showCreateModal.set(false)"
          (save)="onCreate($event)"
        />
      }

      @defer (when showDetailModal()) {
        <app-org-transfer-detail-modal
          [isOpen]="showDetailModal()"
          [transfer]="selectedTransfer()"
          [isProcessing]="isSubmitting()"
          [canApprove]="canApprove()"
          [canDispatch]="canDispatch()"
          [canComplete]="canComplete()"
          [canCancel]="canCancel()"
          (isOpenChange)="showDetailModal.set($event)"
          (closed)="showDetailModal.set(false)"
          (approveTransfer)="onApprove($event)"
          (dispatchTransfer)="onDispatch($event)"
          (completeTransfer)="onComplete($event.transfer, $event.items)"
          (cancelTransfer)="onCancel($event)"
        />
      }
    </div>
  `,
})
export class OrgTransfersComponent implements OnInit {
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly orgInventory = inject(OrgInventoryService);
  private readonly orgTransfers = inject(OrgTransfersService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly transfers = signal<OrgTransfer[]>([]);
  readonly loading = signal(false);
  readonly statsLoading = signal(false);
  readonly isSubmitting = signal(false);

  readonly showCreateModal = signal(false);
  readonly showDetailModal = signal(false);
  readonly selectedTransfer = signal<OrgTransfer | null>(null);

  readonly locationOptions = signal<SelectorOption[]>([]);
  readonly pagination = signal({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
  readonly stats = signal<OrgTransferStats>({
    total: 0,
    pending: 0,
    approved: 0,
    in_transit: 0,
    received: 0,
    cancelled: 0,
  });

  searchTerm = '';
  statusFilter: OrgTransferStatus | '' = '';

  // ─── Permission / scope gating ──────────────────────────────────────────
  readonly isOrgScope = computed(
    () => this.authFacade.operatingScope() === 'ORGANIZATION',
  );
  readonly canCreate = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:transfers:create'),
  );
  readonly canApprove = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:transfers:approve'),
  );
  readonly canDispatch = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:transfers:dispatch'),
  );
  readonly canComplete = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:transfers:complete'),
  );
  readonly canCancel = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:transfers:cancel'),
  );

  ngOnInit(): void {
    this.loadStats();
    this.loadTransfers();
    this.loadLocations();
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.orgTransfers
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.stats.set(s);
          this.statsLoading.set(false);
        },
        error: () => {
          this.statsLoading.set(false);
        },
      });
  }

  loadTransfers(): void {
    this.loading.set(true);
    const pag = this.pagination();
    const query: OrgTransferQuery = {
      page: pag.page,
      limit: pag.limit,
      ...(this.statusFilter ? { status: this.statusFilter } : {}),
      ...(this.searchTerm ? { search: this.searchTerm } : {}),
    };
    this.orgTransfers
      .list(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res.data ?? [];
          this.transfers.set(data);
          const total = res.meta?.total ?? data.length;
          const limit = res.meta?.limit ?? pag.limit;
          this.pagination.update((p) => ({
            ...p,
            total,
            limit,
            page: res.meta?.page ?? p.page,
            totalPages: res.meta?.total_pages ?? Math.ceil(total / Math.max(limit, 1)),
          }));
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al cargar transferencias');
          this.loading.set(false);
        },
      });
  }

  loadLocations(): void {
    this.orgInventory
      .getLocations({ is_active: true, limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const rows: OrgLocationRow[] = Array.isArray(res?.data) ? res.data : [];
          this.locationOptions.set(rows.map((row) => this.toLocationOption(row)));
        },
        error: () => this.locationOptions.set([]),
      });
  }

  // ─── Filter / search handlers ──────────────────────────────────────────

  onSearch(term: string): void {
    this.searchTerm = term;
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransfers();
  }

  onFilterChange(values: FilterValues): void {
    this.statusFilter = (values['status'] as OrgTransferStatus) || '';
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransfers();
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadTransfers();
  }

  onPageChange(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadTransfers();
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      if (!this.canCreate()) {
        this.toast.error('No tienes permisos para crear transferencias');
        return;
      }
      this.showCreateModal.set(true);
    } else if (action === 'refresh') {
      this.refresh();
    }
  }

  onViewDetail(transfer: OrgTransfer): void {
    this.selectedTransfer.set(transfer);
    this.showDetailModal.set(true);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────

  onCreate(dto: CreateOrgTransferRequest): void {
    if (!this.canCreate()) return;
    this.isSubmitting.set(true);
    this.orgTransfers
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(
            'Transferencia creada en estado pendiente. Aprueba y despacha desde el detalle.',
          );
          this.showCreateModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al crear transferencia');
          this.isSubmitting.set(false);
        },
      });
  }

  async onApprove(transfer: OrgTransfer): Promise<void> {
    if (!this.canApprove()) return;
    const confirmed = await this.dialog.confirm({
      title: 'Aprobar transferencia',
      message: `¿Aprobar la transferencia ${transfer.transfer_number}? El stock aún no se moverá; el siguiente paso es despacharla.`,
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.orgTransfers
      .approve(transfer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.toast.success('Transferencia aprobada');
          this.selectedTransfer.set(updated);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al aprobar');
          this.isSubmitting.set(false);
        },
      });
  }

  async onDispatch(transfer: OrgTransfer): Promise<void> {
    if (!this.canDispatch()) return;
    const confirmed = await this.dialog.confirm({
      title: 'Despachar transferencia',
      message: `Al despachar ${transfer.transfer_number} el origen perderá stock inmediatamente. ¿Continuar?`,
      confirmText: 'Despachar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.orgTransfers
      .dispatch(transfer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.toast.success('Transferencia despachada');
          this.selectedTransfer.set(updated);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al despachar');
          this.isSubmitting.set(false);
        },
      });
  }

  onComplete(
    transfer: OrgTransfer,
    items: CompleteOrgTransferItemRequest[],
  ): void {
    if (!this.canComplete()) return;
    if (items.length === 0) {
      this.toast.error('Indica al menos una cantidad recibida.');
      return;
    }
    this.isSubmitting.set(true);
    this.orgTransfers
      .complete(transfer.id, { items })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const fully =
            normalizeOrgTransferStatus(updated.status) === 'received';
          this.toast.success(
            fully
              ? 'Transferencia recibida en su totalidad'
              : 'Recepción parcial registrada',
          );
          this.selectedTransfer.set(updated);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al completar la recepción');
          this.isSubmitting.set(false);
        },
      });
  }

  async onCancel(transfer: OrgTransfer): Promise<void> {
    if (!this.canCancel()) return;
    const reason = await this.dialog.prompt({
      title: 'Cancelar transferencia',
      message:
        'Indica el motivo de la cancelación. Si la transferencia ya está en tránsito, el stock pendiente se devolverá al origen.',
      placeholder: 'Motivo de la cancelación',
      confirmText: 'Cancelar transferencia',
      cancelText: 'Volver',
    });
    // `undefined` means user dismissed the prompt; empty string is allowed.
    if (reason === undefined) return;

    this.isSubmitting.set(true);
    this.orgTransfers
      .cancel(transfer.id, { reason: reason || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.toast.success('Transferencia cancelada');
          this.selectedTransfer.set(updated);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al cancelar');
          this.isSubmitting.set(false);
        },
      });
  }

  refresh(): void {
    this.orgTransfers.invalidateCache();
    this.loadStats();
    this.loadTransfers();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private toLocationOption(row: OrgLocationRow): SelectorOption {
    const storeLabel = row.is_central_warehouse
      ? '📦 Bodega Central'
      : `🏪 ${row.store_name || (row.store_id ? `Tienda #${row.store_id}` : 'Sin tienda')}`;
    return {
      value: row.id,
      label: `${row.name} · ${storeLabel}`,
    };
  }
}

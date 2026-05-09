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
import { OrgAdjustmentsService } from '../../services/org-adjustments.service';
import {
  CreateOrgAdjustmentBulkRequest,
  OrgAdjustment,
  OrgAdjustmentQuery,
  OrgAdjustmentType,
} from '../../interfaces/org-adjustment.interface';
import { OrgAdjustmentListComponent } from './components/adjustment-list.component';
import { OrgAdjustmentFormModalComponent } from './components/adjustment-form-modal.component';
import { OrgAdjustmentDetailModalComponent } from './components/adjustment-detail-modal.component';

interface AdjustmentStats {
  total: number;
  pending: number;
  approved: number;
  losses: number;
}

/**
 * ORG_ADMIN — Ajustes de inventario (CRUD + lifecycle).
 *
 * Permission gating:
 *   - `organization:inventory:adjustments:read`     → enter the page
 *   - `organization:inventory:adjustments:create`   → "Crear ajuste"
 *   - `organization:inventory:adjustments:approve`  → "Aprobar"
 *   - `organization:inventory:adjustments:delete`   → "Cancelar"
 *
 * All write actions require `operatingScope === 'ORGANIZATION'`. STORE-scoped
 * orgs land on the existing `/store/inventory/adjustments` page instead.
 */
@Component({
  selector: 'vendix-org-adjustments',
  standalone: true,
  imports: [
    RouterLink,
    AlertBannerComponent,
    StatsComponent,
    OrgAdjustmentListComponent,
    OrgAdjustmentFormModalComponent,
    OrgAdjustmentDetailModalComponent,
  ],
  template: `
    <div class="w-full">
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          smallText="Ajustes registrados"
          iconName="clipboard-list"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Pendientes"
          [value]="stats().pending"
          smallText="Esperan aprobación"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Aprobados"
          [value]="stats().approved"
          smallText="Stock ya aplicado"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Pérdidas"
          [value]="stats().losses"
          smallText="Daño / pérdida / robo"
          iconName="trending-down"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="loading()"
        />
      </div>

      @if (!isOrgScope()) {
        <app-alert-banner variant="warning" icon="lock" class="mx-2 md:mx-0 mb-2 md:mb-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <span>
              Modo STORE activo. Los ajustes consolidados org-wide están disponibles solo en modo ORGANIZATION.
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

      <app-org-adjustment-list
        [adjustments]="adjustments()"
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
        <app-org-adjustment-form-modal
          [isOpen]="showCreateModal()"
          [isSubmitting]="isSubmitting()"
          [locations]="locationOptions()"
          (isOpenChange)="showCreateModal.set($event)"
          (cancel)="showCreateModal.set(false)"
          (save)="onCreate($event)"
        />
      }

      @defer (when showDetailModal()) {
        <app-org-adjustment-detail-modal
          [isOpen]="showDetailModal()"
          [adjustment]="selectedAdjustment()"
          [isProcessing]="isSubmitting()"
          [canApprove]="canApprove()"
          [canCancel]="canCancel()"
          (isOpenChange)="showDetailModal.set($event)"
          (closed)="showDetailModal.set(false)"
          (approve)="onApprove($event)"
          (cancel)="onCancel($event)"
        />
      }
    </div>
  `,
})
export class OrgAdjustmentsComponent implements OnInit {
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly orgInventory = inject(OrgInventoryService);
  private readonly orgAdjustments = inject(OrgAdjustmentsService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly adjustments = signal<OrgAdjustment[]>([]);
  readonly loading = signal(false);
  readonly isSubmitting = signal(false);

  readonly showCreateModal = signal(false);
  readonly showDetailModal = signal(false);
  readonly selectedAdjustment = signal<OrgAdjustment | null>(null);

  readonly locationOptions = signal<SelectorOption[]>([]);
  readonly pagination = signal({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });

  searchTerm = '';
  typeFilter: OrgAdjustmentType | '' = '';
  statusFilter: 'pending' | 'approved' | '' = '';

  // ─── Permission / scope gating ──────────────────────────────────────────
  readonly isOrgScope = computed(
    () => this.authFacade.operatingScope() === 'ORGANIZATION',
  );

  readonly canCreate = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:adjustments:create'),
  );

  readonly canApprove = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:adjustments:approve'),
  );

  readonly canCancel = computed(
    () =>
      this.isOrgScope() &&
      this.authFacade.hasPermission('organization:inventory:adjustments:delete'),
  );

  readonly stats = signal<AdjustmentStats>({
    total: 0,
    pending: 0,
    approved: 0,
    losses: 0,
  });

  ngOnInit(): void {
    this.loadAdjustments();
    this.loadLocations();
  }

  loadAdjustments(): void {
    this.loading.set(true);
    const pag = this.pagination();
    const query: OrgAdjustmentQuery = {
      page: pag.page,
      limit: pag.limit,
      ...(this.typeFilter ? { type: this.typeFilter } : {}),
      ...(this.statusFilter ? { status: this.statusFilter } : {}),
      ...(this.searchTerm ? { search: this.searchTerm } : {}),
    };
    this.orgAdjustments
      .list(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res.data ?? [];
          this.adjustments.set(data);
          const total = res.meta?.total ?? data.length;
          const limit = res.meta?.limit ?? pag.limit;
          this.pagination.update((p) => ({
            ...p,
            total,
            limit,
            page: res.meta?.page ?? p.page,
            totalPages: res.meta?.total_pages ?? Math.ceil(total / Math.max(limit, 1)),
          }));
          this.recomputeStats(data);
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al cargar ajustes');
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
    this.loadAdjustments();
  }

  onFilterChange(values: FilterValues): void {
    this.typeFilter = (values['type'] as OrgAdjustmentType) || '';
    this.statusFilter = (values['status'] as 'pending' | 'approved') || '';
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadAdjustments();
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.typeFilter = '';
    this.statusFilter = '';
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadAdjustments();
  }

  onPageChange(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadAdjustments();
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      if (!this.canCreate()) {
        this.toast.error('No tienes permisos para crear ajustes');
        return;
      }
      this.showCreateModal.set(true);
    } else if (action === 'refresh') {
      this.refresh();
    }
  }

  onViewDetail(adjustment: OrgAdjustment): void {
    this.selectedAdjustment.set(adjustment);
    this.showDetailModal.set(true);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────

  onCreate(dto: CreateOrgAdjustmentBulkRequest): void {
    if (!this.canCreate()) return;
    this.isSubmitting.set(true);
    this.orgAdjustments
      .createBulk(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(
            dto.auto_approve
              ? 'Ajustes creados y aplicados al inventario'
              : 'Ajustes creados como pendientes',
          );
          this.showCreateModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al crear ajustes');
          this.isSubmitting.set(false);
        },
      });
  }

  async onApprove(adjustment: OrgAdjustment): Promise<void> {
    if (!this.canApprove()) {
      this.toast.error('No tienes permisos para aprobar ajustes');
      return;
    }
    const confirmed = await this.dialog.confirm({
      title: 'Aprobar ajuste',
      message: `¿Aprobar el ajuste de ${
        adjustment.products?.name || 'producto'
      } (${adjustment.quantity_change > 0 ? '+' : ''}${
        adjustment.quantity_change
      })? Se aplicará el movimiento al inventario.`,
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.orgAdjustments
      .approve(adjustment.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Ajuste aprobado');
          this.showDetailModal.set(false);
          this.isSubmitting.set(false);
          this.refresh();
        },
        error: (err) => {
          this.toast.error(err?.message || 'Error al aprobar');
          this.isSubmitting.set(false);
        },
      });
  }

  async onCancel(adjustment: OrgAdjustment): Promise<void> {
    if (!this.canCancel()) {
      this.toast.error('No tienes permisos para cancelar ajustes');
      return;
    }
    const confirmed = await this.dialog.confirm({
      title: 'Cancelar ajuste',
      message: `¿Cancelar el ajuste #${adjustment.id}? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar ajuste',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.isSubmitting.set(true);
    this.orgAdjustments
      .cancel(adjustment.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Ajuste cancelado');
          this.showDetailModal.set(false);
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
    this.orgAdjustments.invalidateCache();
    this.loadAdjustments();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private recomputeStats(rows: OrgAdjustment[]): void {
    const pending = rows.filter((r) => r.approved_by_user_id == null).length;
    const approved = rows.length - pending;
    const losses = rows.filter((r) =>
      ['damage', 'loss', 'theft', 'expiration'].includes(r.adjustment_type),
    ).length;
    this.stats.set({
      total: this.pagination().total || rows.length,
      pending,
      approved,
      losses,
    });
  }

  private toLocationOption(row: OrgLocationRow): SelectorOption {
    const storeLabel = row.is_central_warehouse
      ? 'Bodega Central'
      : row.store_name || (row.store_id ? `Tienda #${row.store_id}` : 'Sin tienda');
    return {
      value: row.id,
      label: `${row.name} · ${storeLabel}`,
    };
  }
}

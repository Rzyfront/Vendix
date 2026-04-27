import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { PartnerPayout } from '../../interfaces/subscription-admin.interface';
import { environment } from '../../../../../../../environments/environment';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ResponsiveDataViewComponent, TableColumn, TableAction, ItemListCardConfig } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-partner-payouts',
  standalone: true,
  imports: [
    StatsComponent,
    ButtonComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    CardComponent,
    EmptyStateComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Pagos pendientes"
          [value]="pendingCount()"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Pagos aprobados"
          [value]="approvedCount()"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Pagos pagados"
          [value]="paidCount()"
          iconName="banknote"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Monto total"
          [value]="totalAmount() | currency"
          iconName="wallet"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Total pagos <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto justify-end">
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="loadPayouts()"
                  title="Refrescar"
                >
                  <app-icon slot="icon" name="refresh" [size]="18"></app-icon>
                </app-button>
              </div>
            </div>
          </div>

          <!-- Loading -->
          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Cargando...</p>
            </div>
          }

          <!-- Empty -->
          @if (!loading() && payouts().length === 0) {
            <app-empty-state
              icon="dollar-sign"
              title="No hay pagos"
              description="No hay pagos para revisar."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && payouts().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="payouts()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
              />
              @if (pagination().totalPages > 1) {
                <div class="mt-4 flex justify-center">
                  <app-pagination
                    [currentPage]="pagination().page"
                    [totalPages]="pagination().totalPages"
                    [total]="pagination().total"
                    [limit]="pagination().limit"
                    infoStyle="none"
                    (pageChange)="changePage($event)"
                  />
                </div>
              }
            </div>
          }
        </app-card>
      </div>
    </div>
  `,
})
export class PartnerPayoutsComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  readonly router = inject(Router);

  readonly payouts = signal<PartnerPayout[]>([]);
  readonly loading = signal(false);
  readonly pendingCount = signal(0);
  readonly approvedCount = signal(0);
  readonly paidCount = signal(0);
  readonly totalAmount = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  columns: TableColumn[] = [
    { key: 'partner_name', label: 'Partner', sortable: true, width: '200px', priority: 1 },
    { key: 'period_start', label: 'Inicio periodo', sortable: true, width: '130px', priority: 3 },
    { key: 'period_end', label: 'Fin periodo', sortable: true, width: '130px', priority: 3 },
    { key: 'total_amount', label: 'Monto total', sortable: true, width: '120px', align: 'right', priority: 1 },
    { key: 'store_count', label: 'Tiendas', sortable: true, width: '80px', align: 'center', priority: 2 },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '110px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#f59e0b',
          approved: '#3b82f6',
          rejected: '#ef4444',
          paid: '#22c55e',
        },
      },
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Detalle',
      icon: 'eye',
      variant: 'info',
      action: (item: PartnerPayout) => this.router.navigate(['/super-admin/subscriptions/payouts', item.id]),
    },
    {
      label: 'Aprobar',
      icon: 'check',
      variant: 'success',
      show: (item: PartnerPayout) => item.status === 'pending',
      action: (item: PartnerPayout) => this.approvePayout(item.id),
    },
    {
      label: 'Rechazar',
      icon: 'x',
      variant: 'danger',
      show: (item: PartnerPayout) => item.status === 'pending',
      action: (item: PartnerPayout) => this.rejectPayout(item.id),
    },
    {
      label: 'Marcar pagado',
      icon: 'banknote',
      variant: 'primary',
      show: (item: PartnerPayout) => item.status === 'approved',
      action: (item: PartnerPayout) => this.markAsPaid(item.id),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'partner_name',
    subtitleKey: 'period_start',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#f59e0b',
        approved: '#3b82f6',
        rejected: '#ef4444',
        paid: '#22c55e',
      },
    },
    detailKeys: [
      { key: 'total_amount', label: 'Monto total' },
      { key: 'store_count', label: 'Tiendas' },
      { key: 'period_end', label: 'Fin periodo' },
    ],
  };

  constructor() {
    this.loadPayouts();
  }

  loadPayouts(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getPayouts({ page: pag.page, limit: pag.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.payouts.set(res.data);
            this.pagination.update((p) => ({
              ...p,
              total: res.meta.total,
              totalPages: res.meta.totalPages,
            }));
            this.computeStats(res.data);
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  computeStats(data: PartnerPayout[]): void {
    this.pendingCount.set(data.filter((p) => p.status === 'pending').length);
    this.approvedCount.set(data.filter((p) => p.status === 'approved').length);
    this.paidCount.set(data.filter((p) => p.status === 'paid').length);
    this.totalAmount.set(data.reduce((sum, p) => sum + p.total_amount, 0));
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadPayouts();
  }

  approvePayout(id: string): void {
    this.service
      .approvePayout(id, { status: 'approved' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.toast.show({ variant: 'success', description: 'Pago aprobado' });
            this.loadPayouts();
          }
        },
        error: () => this.toast.show({ variant: 'error', description: 'Error al aprobar el pago' }),
      });
  }

  rejectPayout(id: string): void {
    const reason = window.prompt('Motivo del rechazo (mínimo 3 caracteres):');
    if (!reason || reason.trim().length < 3) {
      this.toast.show({ variant: 'error', description: 'Motivo requerido (mínimo 3 caracteres)' });
      return;
    }
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/reject`, { reason: reason.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.show({ variant: 'success', description: 'Pago rechazado' });
          this.loadPayouts();
        },
        error: () => this.toast.show({ variant: 'error', description: 'Error al rechazar el pago' }),
      });
  }

  markAsPaid(id: string): void {
    this.http
      .patch(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/pay`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.show({ variant: 'success', description: 'Pago marcado como pagado' });
          this.loadPayouts();
        },
        error: () => this.toast.show({ variant: 'error', description: 'Error al marcar como pagado' }),
      });
  }
}

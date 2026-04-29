import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { DunningSubscription } from '../../interfaces/subscription-admin.interface';
import {
  StatsComponent,
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  PaginationComponent,
  CardComponent,
  EmptyStateComponent,
  ToastService,
  DialogService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { environment } from '../../../../../../../environments/environment';
import { DunningPreviewModalComponent } from '../../components/dunning-preview-modal.component';
import { DunningPreviewTargetState } from '../../interfaces/subscription-admin.interface';

@Component({
  selector: 'app-dunning-board',
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
    DunningPreviewModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="En gracia"
          [value]="graceCount()"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Suspendidas"
          [value]="suspendedCount()"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
        <app-stats
          title="Total en mora"
          [value]="totalOverdue() | currency"
          iconName="banknote"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>
        <app-stats
          title="Promedio días en mora"
          [value]="avgDaysOverdue()"
          iconName="calendar"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Dunning <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto justify-end">
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="loadDunning()"
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
          @if (!loading() && dunning().length === 0) {
            <app-empty-state
              icon="alert-circle"
              title="No hay suscripciones en cobranza"
              description="No subscriptions in dunning right now."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && dunning().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="dunning()"
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

    <!-- Force-transition preview modal (S4.1) -->
    <app-dunning-preview-modal
      [isOpen]="previewOpen()"
      [subscriptionId]="previewSubscriptionId()"
      [targetState]="previewTargetState()"
      (closed)="closePreview()"
      (confirmed)="confirmTransition($event)"
    />
  `,
})
export class DunningBoardComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private dialog = inject(DialogService);

  readonly dunning = signal<DunningSubscription[]>([]);
  readonly loading = signal(false);
  readonly graceCount = signal(0);
  readonly suspendedCount = signal(0);
  readonly totalOverdue = signal(0);
  readonly avgDaysOverdue = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  // S4.1 — Force-transition preview modal state.
  readonly previewOpen = signal(false);
  readonly previewSubscriptionId = signal<string | null>(null);
  readonly previewTargetState = signal<DunningPreviewTargetState>('cancelled');

  columns: TableColumn[] = [
    { key: 'store_name', label: 'Tienda', sortable: true, width: '200px', priority: 1 },
    { key: 'organization_name', label: 'Organización', sortable: true, width: '200px', priority: 2 },
    { key: 'plan_name', label: 'Plan', sortable: true, width: '150px', priority: 2 },
    { key: 'price', label: 'Monto', sortable: true, width: '120px', align: 'right', priority: 2 },
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
        colorMap: { grace: '#f59e0b', suspended: '#ef4444' },
      },
    },
    { key: 'days_overdue', label: 'Días en mora', sortable: true, width: '120px', align: 'center', priority: 1 },
    { key: 'payment_attempts', label: 'Intentos', sortable: true, width: '100px', align: 'center', priority: 3 },
  ];

  actions: TableAction[] = [
    {
      label: 'Recordar',
      icon: 'bell',
      variant: 'info',
      action: (item: DunningSubscription) => this.sendReminder(item.id),
    },
    {
      label: 'Reintentar pago',
      icon: 'refresh-cw',
      variant: 'primary',
      action: (item: DunningSubscription) => this.retryPayment(item.id),
    },
    {
      label: 'Cancelar',
      icon: 'x-circle',
      variant: 'danger',
      action: (item: DunningSubscription) => this.cancelSubscription(item.id),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleKey: 'organization_name',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { grace: '#f59e0b', suspended: '#ef4444' },
    },
    detailKeys: [
      { key: 'plan_name', label: 'Plan' },
      { key: 'days_overdue', label: 'Días en mora' },
      { key: 'payment_attempts', label: 'Intentos' },
    ],
  };

  constructor() {
    this.loadDunning();
  }

  loadDunning(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getDunningSubscriptions({ page: pag.page, limit: pag.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.dunning.set(res.data);
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

  computeStats(data: DunningSubscription[]): void {
    this.graceCount.set(data.filter((d) => d.status === 'grace').length);
    this.suspendedCount.set(data.filter((d) => d.status === 'suspended').length);
    this.totalOverdue.set(data.reduce((sum, d) => sum + d.price, 0));
    const avg = data.length > 0 ? data.reduce((sum, d) => sum + d.days_overdue, 0) / data.length : 0;
    this.avgDaysOverdue.set(Math.round(avg));
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadDunning();
  }

  onViewDetails(item: DunningSubscription): void {
    this.router.navigate(['/super-admin/subscriptions/events'], { queryParams: { subscriptionId: item.id } });
  }

  sendReminder(id: string): void {
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/dunning/${id}/remind`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toast.success('Recordatorio enviado'),
        error: () => this.toast.error('Error al enviar recordatorio'),
      });
  }

  retryPayment(id: string): void {
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/dunning/${id}/retry-payment`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Reintento de pago en cola');
          this.loadDunning();
        },
        error: () => this.toast.error('Error al encolar reintento'),
      });
  }

  /**
   * Open the force-transition preview modal targeting `cancelled` for the
   * given subscription. The modal computes the side-effects (emails, feature
   * deltas, invoices, commissions) before the operator confirms. Replaces
   * the old plain confirm dialog (S4.1).
   */
  cancelSubscription(id: string): void {
    this.openPreview(id, 'cancelled');
  }

  openPreview(id: string, target: DunningPreviewTargetState): void {
    this.previewSubscriptionId.set(id);
    this.previewTargetState.set(target);
    this.previewOpen.set(true);
  }

  closePreview(): void {
    this.previewOpen.set(false);
    this.previewSubscriptionId.set(null);
  }

  /**
   * Fired by DunningPreviewModalComponent after the operator ticks the
   * acknowledgement and confirms. Currently only the `cancelled` target is
   * wired to a backend endpoint (cancel). Other targets are reserved for
   * future force-transition endpoints.
   */
  confirmTransition(target: DunningPreviewTargetState): void {
    const id = this.previewSubscriptionId();
    if (!id) return;

    if (target === 'cancelled') {
      this.http
        .post(
          `${environment.apiUrl}/superadmin/subscriptions/dunning/${id}/cancel`,
          {},
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toast.success('Suscripción cancelada');
            this.closePreview();
            this.loadDunning();
          },
          error: () => {
            this.toast.error('Error al cancelar');
            this.closePreview();
          },
        });
      return;
    }

    // Defensive: no other target is wired yet.
    this.toast.error(`Transición a "${target}" no está soportada todavía.`);
    this.closePreview();
  }
}

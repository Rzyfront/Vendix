import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  EmptyStateComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { PartnerCommissionsService } from '../../services/partner-commissions.service';
import {
  CommissionEntry,
  CommissionSummary,
  PayoutEntry,
} from '../../interfaces/org-subscription.interface';

@Component({
  selector: 'app-partner-commissions',
  standalone: true,
  imports: [
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Acumulado"
          [value]="formatCurrency(summary().accrued)"
          smallText="Comisiones"
          iconName="trending-up"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Pendiente Pago"
          [value]="formatCurrency(summary().pending_payout)"
          smallText="Por liquidar"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Pagado"
          [value]="formatCurrency(summary().paid)"
          smallText="Total pagado"
          iconName="check-circle"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Histórico Total"
          [value]="formatCurrency(summary().total_history)"
          smallText="Acumulado histórico"
          iconName="bar-chart"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
               md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Comisiones ({{ commissions().length }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar comisión..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
          </div>
        </div>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && commissions().length === 0) {
        <app-empty-state
          icon="wallet"
          title="Sin comisiones"
          description="Aún no hay comisiones registradas"
        ></app-empty-state>
      }

      @if (!loading() && commissions().length > 0) {
        <div class="bg-surface rounded-card shadow-card border border-border md:min-h-[400px]">
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="filteredCommissions()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
            ></app-responsive-data-view>
          </div>
        </div>
      }

      @if (payouts().length > 0) {
        <div class="mt-6 space-y-4">
          <h3 class="text-lg font-semibold text-text-primary">Historial de Pagos</h3>
          <div class="bg-surface rounded-card shadow-card border border-border">
            <div class="p-2 md:p-4">
              <app-responsive-data-view
                [data]="payouts()"
                [columns]="payoutColumns"
                [cardConfig]="payoutCardConfig"
                [loading]="loadingPayouts()"
              ></app-responsive-data-view>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class PartnerCommissionsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private commissionsService = inject(PartnerCommissionsService);
  private toastService = inject(ToastService);

  readonly summary = signal<CommissionSummary>({
    accrued: 0,
    pending_payout: 0,
    paid: 0,
    total_history: 0,
    currency: 'COP',
  });
  readonly commissions = signal<CommissionEntry[]>([]);
  readonly payouts = signal<PayoutEntry[]>([]);
  readonly loading = signal(false);
  readonly loadingPayouts = signal(false);
  readonly searchTerm = signal('');
  readonly filteredCommissions = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.commissions();
    if (!term) return items;
    return items.filter(
      (c) =>
        c.store_name.toLowerCase().includes(term) ||
        c.invoice_number.toLowerCase().includes(term),
    );
  });

  columns: TableColumn[] = [
    { key: 'invoice_number', label: 'Factura', sortable: true, priority: 1 },
    { key: 'store_name', label: 'Tienda', sortable: true, priority: 1 },
    {
      key: 'amount',
      label: 'Monto',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'state',
      label: 'Estado',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          accrued: '#22c55e',
          pending_payout: '#f59e0b',
          paid: '#3b82f6',
          failed: '#ef4444',
        },
      },
      transform: (val: string) => this.getStateLabel(val),
    },
    {
      key: 'period_end',
      label: 'Período',
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleKey: 'invoice_number',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        accrued: '#22c55e',
        pending_payout: '#f59e0b',
        paid: '#3b82f6',
        failed: '#ef4444',
      },
    },
    badgeTransform: (val: string) => this.getStateLabel(val),
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'period_end',
        label: 'Período',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
      },
    ],
  };

  payoutColumns: TableColumn[] = [
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'state',
      label: 'Estado',
      align: 'center',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: { pending: '#f59e0b', completed: '#22c55e', failed: '#ef4444' },
      },
      transform: (val: string) => this.getStateLabel(val),
    },
    {
      key: 'commissions_count',
      label: 'Comisiones',
      align: 'center',
    },
    {
      key: 'paid_at',
      label: 'Fecha Pago',
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
  ];

  payoutCardConfig: ItemListCardConfig = {
    titleKey: 'id',
    titleTransform: (item: any) => `Pago #${item.id?.slice(-6) || '-'}`,

    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      colorMap: { pending: '#f59e0b', completed: '#22c55e', failed: '#ef4444' },
    },
    badgeTransform: (val: string) => this.getStateLabel(val),
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadSummary();
    this.loadCommissions();
    this.loadPayouts();
  }

  private loadSummary(): void {
    this.commissionsService.getCommissionsSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.summary.set(res.data);
        },
      });
  }

  private loadCommissions(): void {
    this.loading.set(true);
    this.commissionsService.getCommissions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.commissions.set(res.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar comisiones');
        },
      });
  }

  private loadPayouts(): void {
    this.loadingPayouts.set(true);
    this.commissionsService.getPayouts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.payouts.set(res.data);
          this.loadingPayouts.set(false);
        },
        error: () => this.loadingPayouts.set(false),
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0, 0);
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      accrued: 'Acumulado',
      pending_payout: 'Pendiente',
      paid: 'Pagado',
      failed: 'Fallido',
      pending: 'Pendiente',
      completed: 'Completado',
    };
    return labels[state] || state;
  }
}

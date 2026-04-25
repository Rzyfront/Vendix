import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  IconComponent,
  ButtonComponent,
  CardComponent,
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  EmptyStateComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { OrgSubscriptionsService } from '../../services/org-subscriptions.service';
import { InvoiceEntry } from '../../interfaces/org-subscription.interface';

@Component({
  selector: 'app-subscription-invoices',
  standalone: true,
  imports: [
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full space-y-6">
      <div class="flex items-center gap-3">
        <button (click)="goBack()" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <div>
          <h1 class="text-xl font-bold text-text-primary">Facturas</h1>
          <p class="text-sm text-text-secondary">Historial de facturas de suscripción</p>
        </div>
      </div>

      <div class="stats-container !mb-0">
        <app-stats
          title="Total Facturado"
          [value]="formatCurrency(stats().total_billed)"
          smallText="Acumulado"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Pendiente"
          [value]="formatCurrency(stats().total_pending)"
          smallText="Por cobrar"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Pagado"
          [value]="formatCurrency(stats().total_paid)"
          smallText="Cobrado"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <div class="flex items-center gap-2 w-full md:w-auto">
        <app-inputsearch
          class="flex-1 md:w-64"
          placeholder="Buscar factura..."
          [debounceTime]="300"
          (searchChange)="onSearch($event)"
        ></app-inputsearch>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && invoices().length === 0) {
        <app-empty-state
          icon="file-text"
          title="Sin facturas"
          description="No hay facturas de suscripción registradas"
        ></app-empty-state>
      }

      @if (!loading() && invoices().length > 0) {
        <div class="bg-surface rounded-card shadow-card border border-border">
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="filteredInvoices()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
            ></app-responsive-data-view>
          </div>
        </div>
      }
    </div>
  `,
})
export class SubscriptionInvoicesComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private orgSubsService = inject(OrgSubscriptionsService);

  readonly invoices = signal<InvoiceEntry[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly stats = signal({
    total_billed: 0,
    total_pending: 0,
    total_paid: 0,
    currency: 'COP',
  });

  readonly filteredInvoices = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.invoices();
    if (!term) return items;
    return items.filter(
      (inv) =>
        inv.invoice_number.toLowerCase().includes(term) ||
        inv.state.toLowerCase().includes(term),
    );
  });

  columns: TableColumn[] = [
    { key: 'invoice_number', label: 'Número', sortable: true, priority: 1 },
    {
      key: 'total',
      label: 'Monto',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status' as const, size: 'sm' as const },
      transform: (val: string) => this.getStateLabel(val),
    },
    {
      key: 'period_start',
      label: 'Período',
      sortable: true,
      priority: 2,
      transform: (val: any) => this.formatPeriod(val),
    },
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      priority: 2,
      transform: (val: any) => val ? new Date(val).toLocaleDateString() : '-',
    },
  ];

  cardConfig = {
    titleKey: 'invoice_number',
    badgeKey: 'state',
    badgeConfig: { type: 'status' as const, size: 'sm' as const },
    badgeTransform: (val: string) => this.getStateLabel(val),
    footerKey: 'total',
    footerLabel: 'Total',
    footerStyle: 'prominent' as const,
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'period_start',
        label: 'Período',
        icon: 'calendar',
        transform: (val: any) => this.formatPeriod(val),
      },
    ],
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadInvoices();
  }

  private loadInvoices(): void {
    this.loading.set(true);
    this.orgSubsService.getInvoices()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.invoices.set(res.data);
            this.computeStats(res.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar facturas');
        },
      });
  }

  private computeStats(invoices: InvoiceEntry[]): void {
    let total_billed = 0;
    let total_pending = 0;
    let total_paid = 0;

    for (const inv of invoices) {
      const total = Number(inv.total) || 0;
      total_billed += total;
      if (inv.state === 'paid') {
        total_paid += total;
      } else if (inv.state === 'issued') {
        total_pending += total;
      }
    }

    this.stats.set({ total_billed, total_pending, total_paid, currency: 'COP' });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  goBack(): void {
    history.back();
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0, 0);
  }

  formatPeriod(periodStart: string): string {
    if (!periodStart) return '-';
    const start = new Date(periodStart);
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      issued: 'Emitida',
      paid: 'Pagada',
      void: 'Anulada',
      partially_paid: 'Parcial',
      overdue: 'Vencida',
      refunded: 'Reembolsada',
    };
    return labels[state] || state;
  }
}

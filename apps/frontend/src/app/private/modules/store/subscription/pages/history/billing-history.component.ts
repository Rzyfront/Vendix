import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  EmptyStateComponent,
  CardComponent,
  StickyHeaderComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { Invoice } from '../../interfaces/store-subscription.interface';

@Component({
  selector: 'app-billing-history',
  standalone: true,
  imports: [
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    CardComponent,
    StickyHeaderComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Historial de Facturación"
        [subtitle]="headerSubtitle()"
        icon="receipt"
        [showBackButton]="true"
        backRoute="/admin/subscription"
        [badgeText]="headerBadgeText()"
        [badgeColor]="headerBadgeColor()"
      />

      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Facturas"
          [value]="stats().totalCount"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Total Facturado"
          [value]="(stats().totalAmount | currency) ?? ''"
          iconName="receipt"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Total Pagado"
          [value]="(stats().paidAmount | currency) ?? ''"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
        ></app-stats>
        <app-stats
          title="Total Pendiente"
          [value]="(stats().pendingAmount | currency) ?? ''"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Search Section -->
      <div class="sticky top-[155px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Historial de Facturación ({{ invoices().length }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar factura..."
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

      @if (!loading() && invoices().length === 0) {
        <app-empty-state
          icon="file-text"
          title="Sin facturas"
          description="Aún no hay historial de facturación"
          [showActionButton]="false"
        ></app-empty-state>
      }

      @if (!loading() && invoices().length > 0) {
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="filteredInvoices()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="rowActions"
              [loading]="loading()"
              (rowClick)="goToDetail($event)"
            ></app-responsive-data-view>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class BillingHistoryComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private facade = inject(SubscriptionFacade);

  readonly headerBadgeText = computed(() => {
    const s = this.facade.status();
    const labels: Record<string, string> = {
      active: 'Activa',
      trial: 'Prueba',
      trialing: 'Prueba',
      past_due: 'Vencida',
      cancelled: 'Cancelada',
      expired: 'Expirada',
      grace_soft: 'Gracia',
      grace_hard: 'Gracia',
      blocked: 'Bloqueada',
      none: 'Sin suscripción',
    };
    return labels[s] || s;
  });

  readonly headerBadgeColor = computed(() => {
    const s = this.facade.status();
    if (s === 'active' || s === 'trial' || s === 'trialing') return 'green';
    if (s === 'past_due' || s === 'grace_soft' || s === 'grace_hard') return 'yellow';
    if (s === 'blocked') return 'red';
    if (s === 'cancelled' || s === 'expired') return 'gray';
    return 'blue';
  });

  readonly headerSubtitle = computed(() => {
    const count = this.stats().totalCount;
    return count + ' factura' + (count !== 1 ? 's' : '') + ' registrada' + (count !== 1 ? 's' : '');
  });

  readonly rowActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      tooltip: 'Ver detalle de la factura',
      variant: 'ghost',
      action: (item: Invoice) => this.goToDetail(item),
    },
    {
      label: 'Descargar PDF',
      icon: 'download',
      tooltip: 'Descargar factura como PDF',
      variant: 'ghost',
      action: (item: Invoice) => this.downloadPdf(item),
    },
  ];

  goToDetail(invoice: Invoice): void {
    if (!invoice?.id) {
      return;
    }
    this.router.navigate(['/admin/subscription/invoices', invoice.id]);
  }

  /**
   * S3.1 — Streams the invoice PDF and triggers a save-dialog via a
   * transient anchor element. The download is allowed even when the
   * subscription is suspended.
   */
  downloadPdf(invoice: Invoice): void {
    if (!invoice?.id) {
      return;
    }
    this.subscriptionService
      .downloadInvoicePdf(invoice.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const blob = response.body;
          if (!blob) {
            this.toastService.error('No se pudo generar el PDF');
            return;
          }
          const cd = response.headers.get('content-disposition');
          const match = cd ? /filename="?([^";]+)"?/i.exec(cd) : null;
          const filename = match?.[1] ?? `factura-${invoice.invoice_number}.pdf`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => {
          this.toastService.error('Error al descargar el PDF');
        },
      });
  }

  readonly invoices = signal<Invoice[]>([]);
  readonly filteredInvoices = signal<Invoice[]>([]);
  readonly loading = signal(false);

  readonly stats = computed(() => {
    const items = this.invoices();
    const totalCount = items.length;
    const totalAmount = items.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    const paidAmount = items.filter(i => i.state === 'paid').reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    const pendingAmount = items.filter(i => i.state === 'open').reduce((sum, i) => sum + (Number(i.total) || 0), 0);
    return { totalCount, totalAmount, paidAmount, pendingAmount };
  });

  columns: TableColumn[] = [
    { key: 'invoice_number', label: 'Factura', sortable: true, priority: 1 },
    {
      key: 'period_start',
      label: 'Período',
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
    {
      key: 'total',
      label: 'Total',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) => {
        const num = Number(val) || 0;
        return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      },
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
          draft: '#6B7280',
          open: '#3B82F6',
          paid: '#22C55E',
          void: '#9CA3AF',
          uncollectible: '#EF4444',
        },
      },
      transform: (val: string) => this.getStateLabel(val),
    },
    {
      key: 'due_date',
      label: 'Fecha',
      sortable: true,
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        draft: '#6B7280',
        open: '#3B82F6',
        paid: '#22C55E',
        void: '#9CA3AF',
        uncollectible: '#EF4444',
      },
    },
    badgeTransform: (val: string) => this.getStateLabel(val),
    footerKey: 'total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => {
      const num = Number(val) || 0;
      return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    },
    detailKeys: [
      {
        key: 'due_date',
        label: 'Vencimiento',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
      },
    ],
  };

  ngOnInit(): void {
    this.loadInvoices();
  }

  private loadInvoices(): void {
    this.loading.set(true);
    this.subscriptionService.getInvoices()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.invoices.set(res.data);
            this.filteredInvoices.set(res.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar facturas');
        },
      });
  }

  onSearch(term: string): void {
    const lower = term.toLowerCase();
    this.filteredInvoices.update((items) =>
      items.filter((i) => i.invoice_number.toLowerCase().includes(lower)),
    );
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      open: 'Pendiente',
      paid: 'Pagada',
      void: 'Anulada',
      uncollectible: 'Incobrable',
    };
    return labels[state] || state;
  }
}

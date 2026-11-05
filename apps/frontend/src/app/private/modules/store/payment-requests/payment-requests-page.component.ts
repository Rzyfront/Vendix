import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  StickyHeaderTab,
  ToastService,
} from '../../../../shared/components';
import type {
  ItemListCardConfig,
  TableAction,
  TableColumn,
} from '../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../core/store/store-settings/store-settings.facade';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { formatStoreDateTime } from '../../../../shared/utils/date.util';
import {
  PAYMENT_REQUEST_STATUS_LABELS,
  PaymentRequest,
  PaymentRequestStatus,
} from './interfaces/payment-request.interface';
import { PaymentRequestsService } from './services/payment-requests.service';
import { PaymentRequestDetailModalComponent } from './components/payment-request-detail-modal/payment-request-detail-modal.component';

const MANAGE_PERMISSION = 'store:payment_requests:manage';
const PAGE_SIZE = 20;

/**
 * "Solicitudes de pago" (S15): the admin side of the payment page. Status tabs, one row per
 * request and a detail modal to review the transfer receipt (confirm, reject or cancel).
 */
@Component({
  selector: 'app-payment-requests-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    PaymentRequestDetailModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-requests-page.component.html',
})
export class PaymentRequestsPageComponent implements OnInit {
  private readonly api = inject(PaymentRequestsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly tabs: StickyHeaderTab[] = [
    { id: 'pending', label: 'Pendiente', icon: 'clock' },
    { id: 'awaiting_confirmation', label: 'En revisión', icon: 'receipt' },
    { id: 'paid', label: 'Pagada', icon: 'check-circle' },
    { id: 'expired', label: 'Vencida', icon: 'alert-triangle' },
    { id: 'cancelled', label: 'Cancelada', icon: 'x-circle' },
  ];

  readonly status = signal<PaymentRequestStatus>('pending');
  readonly page = signal(1);
  readonly rows = signal<PaymentRequest[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(false);
  readonly pendingCount = signal<number | null>(null);
  readonly reviewCount = signal<number | null>(null);

  readonly selected = signal<PaymentRequest | null>(null);
  readonly showDetail = signal(false);

  readonly canManage = computed(() => {
    const roles = this.authFacade.userRoles();
    return (
      this.authFacade.userPermissions().includes(MANAGE_PERMISSION) ||
      roles.includes('super_admin') ||
      roles.includes('SUPER_ADMIN')
    );
  });

  readonly statusLabel = computed(() => PAYMENT_REQUEST_STATUS_LABELS[this.status()]);

  readonly columns: TableColumn[] = [
    { key: 'amount', label: 'Monto', align: 'right', transform: (value) => this.currencyService.format(Number(value) || 0) },
    { key: 'description', label: 'Descripción', priority: 1 },
    { key: 'created_at', label: 'Creada', transform: (value) => this.formatDate(value) },
    { key: 'has_receipt', label: 'Comprobante', align: 'center', transform: (value) => (value ? 'Con comprobante' : 'Sin comprobante') },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'description',
    subtitleTransform: (item: PaymentRequest) => this.formatDate(item.created_at),
    badgeKey: 'has_receipt',
    badgeTransform: (value) => (value ? 'Con comprobante' : 'Sin comprobante'),
    badgeConfig: { type: 'custom', colorFn: (value) => (value ? '#059669' : '#6b7280') },
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerTransform: (value) => this.currencyService.format(Number(value) || 0),
    footerStyle: 'prominent',
  };

  readonly actions: TableAction[] = [
    { label: 'Ver detalle', icon: 'eye', variant: 'primary', action: (item: PaymentRequest) => this.openDetail(item) },
  ];

  ngOnInit(): void {
    this.load();
    this.loadCounters();
  }

  onTabChange(id: string): void {
    if (id === this.status()) return;
    this.status.set(id as PaymentRequestStatus);
    this.page.set(1);
    this.load();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  openDetail(row: PaymentRequest): void {
    this.selected.set(row);
    this.showDetail.set(true);
  }

  /** After confirm, reject or cancel the row changes tab, so list and counters reload. */
  onChanged(): void {
    this.load();
    this.loadCounters();
  }

  private formatDate(value: unknown): string {
    return typeof value === 'string' && value ? formatStoreDateTime(value, this.storeSettings.timezone()) : '—';
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .list(this.status(), this.page(), PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.rows.set(result.data);
          this.total.set(result.total);
          this.totalPages.set(result.totalPages);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.rows.set([]);
          this.loading.set(false);
          this.toast.error(extractApiErrorMessage(error) || 'No fue posible cargar las solicitudes de pago.');
        },
      });
  }

  /** Two light queries (one row each) feed the counters of the stats cards. */
  private loadCounters(): void {
    this.api
      .list('pending', 1, 1)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.pendingCount.set(r.total), error: () => this.pendingCount.set(null) });
    this.api
      .list('awaiting_confirmation', 1, 1)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.reviewCount.set(r.total), error: () => this.reviewCount.set(null) });
  }
}

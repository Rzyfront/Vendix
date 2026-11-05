import { Component, DestroyRef, effect, inject, input, model, signal, untracked, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import {
  ButtonComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { WebhookDeliveryRow, WebhookRow } from '../interfaces/integrations.interfaces';
import { IntegrationsApiService } from '../services/integrations-api.service';
import {
  DELIVERY_BADGE,
  DELIVERY_STATUS_LABEL,
  truncate,
  webhookEventLabel,
} from '../utils/integrations-labels.util';

interface DeliveryView extends WebhookDeliveryRow {
  badge: string;
  event_text: string;
  code_text: string;
  error_text: string;
  date_text: string;
}

/** Delivery panel of one endpoint: status chips, attempts, HTTP code and retry. */
@Component({
  selector: 'app-webhook-deliveries-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal [(isOpen)]="isOpen" title="Entregas" [subtitle]="webhook()?.url ?? ''" size="xl">
      <div class="flex flex-col gap-3">
        <div class="sm:w-60">
          <app-selector
            label="Estado"
            size="sm"
            [options]="statusOptions"
            [value]="status()"
            (valueChange)="onStatus($event)"
          />
        </div>
        @if (errorMessage()) {
          <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
        } @else if (loading()) {
          <p class="py-6 text-center text-sm text-text-secondary" role="status">Cargando...</p>
        } @else {
          <app-responsive-data-view
            [data]="rows()"
            [columns]="columns"
            [actions]="actions"
            [cardConfig]="card"
            [sortable]="false"
            emptyMessage="Aún no hay entregas"
            emptyIcon="send"
          />
          <div class="flex justify-center">
            <app-pagination
              [currentPage]="page()"
              [totalPages]="totalPages()"
              [total]="total()"
              [limit]="limit"
              (pageChange)="onPage($event)"
            />
          </div>
        }
      </div>
      <div slot="footer" class="flex w-full justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cerrar</app-button>
      </div>
    </app-modal>
  `,
})
export class WebhookDeliveriesModalComponent {
  private readonly api = inject(IntegrationsApiService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly webhook = input<WebhookRow | null>(null);

  readonly limit = 10;
  readonly page = signal(1);
  readonly total = signal(0);
  readonly status = signal('all');
  readonly items = signal<WebhookDeliveryRow[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit) || 1);

  readonly statusOptions = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'delivered', label: DELIVERY_STATUS_LABEL.delivered },
    { value: 'failed', label: DELIVERY_STATUS_LABEL.failed },
    { value: 'pending', label: DELIVERY_STATUS_LABEL.pending },
    { value: 'dead', label: DELIVERY_STATUS_LABEL.dead },
  ];

  readonly rows = computed<DeliveryView[]>(() =>
    this.items().map((row) => ({
      ...row,
      badge: DELIVERY_BADGE[row.status] ?? 'default',
      event_text: webhookEventLabel(row.event_type),
      code_text: row.status_code ? String(row.status_code) : '—',
      error_text: truncate(row.last_error),
      date_text: formatStoreDateTime(row.created_at, this.settings.timezone()),
    })),
  );

  private readonly statusText = (value: string) =>
    DELIVERY_STATUS_LABEL[
      (Object.keys(DELIVERY_BADGE) as (keyof typeof DELIVERY_BADGE)[]).find(
        (k) => DELIVERY_BADGE[k] === value,
      ) ?? 'pending'
    ];

  readonly columns: TableColumn[] = [
    { key: 'event_text', label: 'Evento', priority: 1 },
    {
      key: 'badge',
      label: 'Estado',
      priority: 1,
      width: '120px',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => this.statusText(value),
    },
    { key: 'attempts', label: 'Intentos', priority: 2, width: '90px' },
    { key: 'code_text', label: 'HTTP', priority: 2, width: '80px' },
    { key: 'error_text', label: 'Error', priority: 3 },
    { key: 'date_text', label: 'Fecha', priority: 2, width: '170px' },
  ];

  readonly card: ItemListCardConfig = {
    titleKey: 'event_text',
    subtitleKey: 'date_text',
    avatarFallbackIcon: 'send',
    avatarShape: 'square',
    badgeKey: 'badge',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: string) => this.statusText(value),
    detailKeys: [
      { key: 'attempts', label: 'Intentos', icon: 'repeat' },
      { key: 'code_text', label: 'HTTP', icon: 'globe' },
      { key: 'error_text', label: 'Error', icon: 'alert-circle' },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Reintentar',
      icon: 'rotate-ccw',
      variant: 'primary',
      show: (row: DeliveryView) => row.status === 'failed' || row.status === 'dead',
      action: (row: DeliveryView) => this.retry(row),
    },
  ];

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const hook = this.webhook();
      untracked(() => {
        if (open && hook) {
          this.page.set(1);
          this.status.set('all');
          this.load();
        }
      });
    });
  }

  onStatus(value: unknown): void {
    this.status.set(String(value ?? 'all'));
    this.page.set(1);
    this.load();
  }

  onPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  retry(row: WebhookDeliveryRow): void {
    this.api
      .retryDelivery(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Entrega reencolada');
          this.load();
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  private load(): void {
    const hook = this.webhook();
    if (!hook) return;
    this.loading.set(true);
    this.errorMessage.set('');
    const status = this.status();
    this.api
      .listDeliveries(hook.id, {
        page: this.page(),
        limit: this.limit,
        ...(status !== 'all' ? { status: status as WebhookDeliveryRow['status'] } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res.data ?? []);
          this.total.set(res.meta?.total ?? res.data?.length ?? 0);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}

import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';
import {
  PAYMENT_REQUEST_PURPOSE_LABELS,
  PAYMENT_REQUEST_STATUS_LABELS,
  PaymentRequest,
  PaymentRequestDetail,
  PaymentRequestStatus,
} from '../../interfaces/payment-request.interface';
import { PaymentRequestsService } from '../../services/payment-requests.service';

type PendingAction = 'reject' | 'cancel' | null;

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

/** Detail of one payment request: transfer receipt plus confirm, reject and cancel. */
@Component({
  selector: 'app-payment-request-detail-modal',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, BadgeComponent, ButtonComponent, IconComponent, InputComponent, ModalComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-request-detail-modal.component.html',
})
export class PaymentRequestDetailModalComponent {
  private readonly api = inject(PaymentRequestsService);
  private readonly paymentMethodsApi = inject(PaymentMethodsService);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  /** Row selected in the list; the modal fetches the detail (with the signed receipt URL) by id. */
  readonly request = input<PaymentRequest | null>(null);
  /** `store:payment_requests:manage`: without it the actions are not shown. */
  readonly canManage = input(false);
  /** Fires after confirm, reject or cancel so the list reloads. */
  readonly changed = output<void>();

  readonly detail = signal<PaymentRequestDetail | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly working = signal(false);
  readonly pendingAction = signal<PendingAction>(null);
  readonly rejectReason = signal('');
  private readonly methodNames = signal<Record<number, string>>({});
  private methodsLoaded = false;

  /** The list row is the fallback while the detail loads. */
  readonly view = computed<PaymentRequest | null>(() => this.detail() ?? this.request());
  readonly status = computed<PaymentRequestStatus | null>(() => this.view()?.status ?? null);
  readonly statusLabel = computed(() => (this.status() ? PAYMENT_REQUEST_STATUS_LABELS[this.status()!] : ''));
  readonly purposeLabel = computed(() => {
    const purpose = this.view()?.purpose ?? '';
    return PAYMENT_REQUEST_PURPOSE_LABELS[purpose] ?? purpose;
  });
  readonly receiptUrl = computed(() => this.detail()?.receipt_url ?? null);
  readonly receiptIsImage = computed(() => {
    const url = this.receiptUrl();
    return !!url && IMAGE_EXTENSION.test(url.split('?')[0]);
  });
  readonly transferMethod = computed(() => {
    const id = this.view()?.transfer_store_payment_method_id;
    return id ? (this.methodNames()[id] ?? 'Transferencia') : null;
  });
  readonly canConfirm = computed(() => this.canManage() && this.status() === 'awaiting_confirmation');
  readonly canReject = computed(() => this.canManage() && this.status() === 'awaiting_confirmation');
  readonly canCancel = computed(() => {
    const status = this.status();
    return this.canManage() && (status === 'pending' || status === 'awaiting_confirmation' || status === 'expired');
  });
  readonly badgeVariant = computed<'success' | 'warning' | 'info' | 'error' | 'neutral'>(() => {
    switch (this.status()) {
      case 'paid':
        return 'success';
      case 'awaiting_confirmation':
        return 'warning';
      case 'pending':
        return 'info';
      case 'expired':
        return 'error';
      default:
        return 'neutral';
    }
  });

  constructor() {
    effect(() => {
      const row = this.request();
      if (this.isOpen() && row) untracked(() => this.open(row));
    });
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatStoreDateTime(value, this.storeSettings.timezone()) : '—';
  }

  amountOf(row: PaymentRequest | null): number {
    return Number(row?.amount) || 0;
  }

  startAction(action: Exclude<PendingAction, null>): void {
    this.rejectReason.set('');
    this.pendingAction.set(action);
  }

  backFromAction(): void {
    this.pendingAction.set(null);
  }

  confirmPayment(): void {
    const row = this.view();
    if (!row || !this.canConfirm()) return;
    this.run(this.api.confirm(row.id), 'Pago confirmado.', 'No fue posible confirmar el pago.');
  }

  rejectReceipt(): void {
    const row = this.view();
    const reason = this.rejectReason().trim();
    if (!row) return;
    if (!reason) {
      this.toast.error('Escribe el motivo del rechazo.');
      return;
    }
    this.run(this.api.reject(row.id, reason), 'Comprobante rechazado: el cliente puede enviarlo de nuevo.', 'No fue posible rechazar el comprobante.');
  }

  cancelRequest(): void {
    const row = this.view();
    if (!row) return;
    this.run(this.api.cancel(row.id), 'Solicitud cancelada.', 'No fue posible cancelar la solicitud.');
  }

  private open(row: PaymentRequest): void {
    this.pendingAction.set(null);
    this.rejectReason.set('');
    this.detail.set(null);
    this.loadError.set(null);
    this.loading.set(true);
    this.loadMethodNames();
    this.api
      .get(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(extractApiErrorMessage(error) || 'No fue posible cargar la solicitud.');
        },
      });
  }

  private run(call: ReturnType<PaymentRequestsService['confirm']>, success: string, failure: string): void {
    this.working.set(true);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.working.set(false);
        this.toast.success(success);
        this.isOpen.set(false);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.working.set(false);
        this.toast.error(extractApiErrorMessage(error) || failure);
      },
    });
  }

  private loadMethodNames(): void {
    if (this.methodsLoaded) return;
    this.methodsLoaded = true;
    this.paymentMethodsApi
      .getStorePaymentMethods({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const names: Record<number, string> = {};
          for (const method of Array.isArray(res?.data) ? res.data : []) {
            names[Number(method.id)] = method.display_name || method.system_payment_method?.display_name || 'Transferencia';
          }
          this.methodNames.set(names);
        },
        error: () => {
          this.methodsLoaded = false;
        },
      });
  }
}

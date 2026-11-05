import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../../../../../../core/utils/api-error-handler';
import { PaymentMethodsService } from '../../../../../../settings/payments/services/payment-methods.service';
import { PaymentMethodState } from '../../../../../../settings/payments/interfaces/payment-methods.interface';
import {
  LeftoverAction,
  ServiceStationsService,
  SessionDeposit,
  SessionSettlementPreview,
  StationDepositExhaustedPolicy,
  StationLeftoverPolicy,
} from '../../../service-stations.service';
import {
  DepositMethodChoice,
  defaultDepositMethod,
  newDepositRequestId,
  toDepositMethodChoices,
  toDepositMethodOptions,
} from '../../../open-session-deposit/deposit-payment-methods.util';

/** Below this share of what was received the panel warns that the deposit is running out. */
const LOW_BALANCE_RATIO = 0.2;

const EXHAUSTED_LABELS: Record<StationDepositExhaustedPolicy, string> = {
  recharge: 'Pedir recarga',
  overflow: 'Cobrar el excedente al final',
};
const LEFTOVER_LABELS: Record<StationLeftoverPolicy, string> = {
  refund_or_credit: 'Devolver o dejar como saldo a favor',
  minimum_spend: 'Consumo mínimo (Gastos de reserva)',
};

/**
 * "Anticipo" panel of the session page (S8, S9, S12): figures, low-balance warning,
 * recharge and settlement. The page reloads the session when `changed` fires.
 */
@Component({
  selector: 'app-deposit-panel',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    SpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './deposit-panel.component.html',
})
export class DepositPanelComponent {
  private readonly api = inject(ServiceStationsService);
  private readonly paymentMethodsApi = inject(PaymentMethodsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly sessionId = input.required<number>();
  /** `deposit` block of the session; the page renders the panel only when it is not null. */
  readonly deposit = input.required<SessionDeposit>();
  /** The session is closed: figures stay visible, actions go away. */
  readonly readOnly = input(false);
  /** Fires after a recharge or a settlement so the page reloads the session and its order. */
  readonly changed = output<void>();

  protected readonly exhaustedLabels = EXHAUSTED_LABELS;
  protected readonly leftoverLabels = LEFTOVER_LABELS;

  // Figures (the API may send Decimal strings).
  readonly required = computed(() => Number(this.deposit().required) || 0);
  readonly received = computed(() => Number(this.deposit().received) || 0);
  readonly applied = computed(() => Number(this.deposit().applied) || 0);
  readonly balance = computed(() => Number(this.deposit().balance) || 0);
  readonly available = computed(() => Number(this.deposit().remaining_for_consumption) || 0);
  readonly isSettled = computed(() => !!this.deposit().settled_at);
  readonly canAct = computed(() => !this.isSettled() && !this.readOnly());

  readonly isExhausted = computed(() => this.available() <= 0);
  readonly isLow = computed(() => {
    if (this.isExhausted()) return false;
    const received = this.received();
    return received > 0 && this.available() <= received * LOW_BALANCE_RATIO;
  });
  readonly warning = computed<string | null>(() => {
    if (this.isSettled() || (!this.isExhausted() && !this.isLow())) return null;
    const recharge = this.deposit().exhausted_policy === 'recharge';
    if (this.isExhausted()) {
      return recharge
        ? 'El anticipo se agotó: para agregar nuevos productos hay que recargarlo.'
        : 'El anticipo se agotó: lo que se consuma de más se cobra al final.';
    }
    return recharge
      ? 'Queda poco anticipo disponible: los nuevos productos pedirán una recarga.'
      : 'Queda poco anticipo disponible: el excedente se cobra al final.';
  });

  // Payment methods (loaded the first time a dialog needs them).
  private readonly choices = signal<DepositMethodChoice[]>([]);
  readonly methodOptions = computed<SelectorOption[]>(() => toDepositMethodOptions(this.choices()));
  readonly loadingMethods = signal(false);

  // Recharge dialog
  readonly showRecharge = signal(false);
  readonly rechargeAmount = signal<number | null>(null);
  readonly rechargeMethodId = signal<number | null>(null);
  readonly recharging = signal(false);
  private rechargeRequestId = newDepositRequestId();

  // Settlement dialog
  readonly showSettle = signal(false);
  readonly loadingPreview = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly preview = signal<SessionSettlementPreview | null>(null);
  readonly leftoverAction = signal<LeftoverAction>('credit');
  readonly refundMethodId = signal<number | null>(null);
  readonly settling = signal(false);
  private settleRequestId = newDepositRequestId();

  readonly leftoverOptions: SelectorOption[] = [
    { value: 'credit', label: 'Dejar como saldo a favor' },
    { value: 'refund', label: 'Devolver' },
  ];

  readonly previewLeftover = computed(() => Number(this.preview()?.leftover) || 0);
  readonly previewDue = computed(() => Number(this.preview()?.amount_due) || 0);
  readonly previewConsumption = computed(() => Number(this.preview()?.consumption) || 0);
  readonly previewApplied = computed(() => Number(this.preview()?.deposit_applied) || 0);
  readonly previewFee = computed(() => Number(this.preview()?.reservation_fee) || 0);
  /** Under "refund or credit" the cashier decides what happens with the leftover. */
  readonly choosesLeftover = computed(
    () => this.deposit().leftover_policy === 'refund_or_credit' && this.previewLeftover() > 0,
  );

  // ---------- Recharge ----------

  openRecharge(): void {
    this.rechargeRequestId = newDepositRequestId();
    this.rechargeAmount.set(null);
    this.loadMethods(() => this.rechargeMethodId.set(defaultDepositMethod(this.choices())?.id ?? null));
    this.showRecharge.set(true);
  }

  submitRecharge(): void {
    const amount = Number(this.rechargeAmount());
    const choice = this.choices().find((c) => c.id === this.rechargeMethodId());
    if (!(amount > 0)) {
      this.toast.error('Indica el monto de la recarga.');
      return;
    }
    if (!choice) {
      this.toast.error('Selecciona el medio de pago.');
      return;
    }
    this.recharging.set(true);
    this.api
      .rechargeDeposit(this.sessionId(), {
        amount,
        method: choice.type,
        store_payment_method_id: choice.id,
        request_id: this.rechargeRequestId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.recharging.set(false);
          this.showRecharge.set(false);
          this.toast.success('Anticipo recargado.');
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.recharging.set(false);
          this.toast.error(extractApiErrorMessage(error) || 'No fue posible recargar el anticipo.');
        },
      });
  }

  // ---------- Settlement ----------

  openSettle(): void {
    this.settleRequestId = newDepositRequestId();
    this.leftoverAction.set('credit');
    this.preview.set(null);
    this.previewError.set(null);
    this.loadingPreview.set(true);
    this.loadMethods(() => this.refundMethodId.set(defaultDepositMethod(this.choices())?.id ?? null));
    this.showSettle.set(true);
    this.api
      .getSettlement(this.sessionId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.loadingPreview.set(false);
        },
        error: (error: unknown) => {
          this.loadingPreview.set(false);
          this.previewError.set(extractApiErrorMessage(error) || 'No fue posible calcular la liquidación.');
        },
      });
  }

  submitSettle(): void {
    if (!this.preview()) return;
    const refund = this.choosesLeftover() && this.leftoverAction() === 'refund';
    const choice = this.choices().find((c) => c.id === this.refundMethodId());
    if (refund && !choice) {
      this.toast.error('Selecciona el medio con el que se devuelve el sobrante.');
      return;
    }
    const due = this.previewDue();
    this.settling.set(true);
    this.api
      .settleDeposit(this.sessionId(), {
        ...(this.choosesLeftover() ? { leftover_action: this.leftoverAction() } : {}),
        ...(refund && choice ? { refund_method: choice.type, store_payment_method_id: choice.id } : {}),
        request_id: this.settleRequestId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.settling.set(false);
          this.showSettle.set(false);
          if (due > 0) {
            this.toast.warning('Anticipo liquidado. Queda saldo por cobrar: usa «Cobrar» en la parte superior de la página.');
          } else {
            this.toast.success('Anticipo liquidado.');
          }
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.settling.set(false);
          this.toast.error(extractApiErrorMessage(error) || 'No fue posible liquidar el anticipo.');
        },
      });
  }

  private loadMethods(done: () => void): void {
    if (this.choices().length) {
      done();
      return;
    }
    this.loadingMethods.set(true);
    this.paymentMethodsApi
      .getStorePaymentMethods({ state: PaymentMethodState.ENABLED, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.choices.set(toDepositMethodChoices(Array.isArray(res?.data) ? res.data : []));
          this.loadingMethods.set(false);
          done();
        },
        error: () => {
          this.choices.set([]);
          this.loadingMethods.set(false);
        },
      });
  }
}

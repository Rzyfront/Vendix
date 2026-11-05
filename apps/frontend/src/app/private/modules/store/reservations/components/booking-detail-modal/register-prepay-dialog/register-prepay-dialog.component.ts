import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../../../../../core/utils/api-error-handler';
import { ReservationsService } from '../../../services/reservations.service';
import { PaymentMethodsService } from '../../../../settings/payments/services/payment-methods.service';
import { PaymentMethodState, StorePaymentMethod } from '../../../../settings/payments/interfaces/payment-methods.interface';
import {
  DepositMethodChoice,
  defaultDepositMethod,
  storePaymentMethodRows,
  toDepositMethodChoices,
} from '../../service-stations/open-session-deposit/deposit-payment-methods.util';
import { BookingPrepay, RegisterPrepayPaymentInput } from '../../../interfaces/reservation.interface';

/** Methods that are not money received at the desk (the backend answers STATION_BOOKING_016 for them). */
const NOT_AT_THE_DESK = ['wompi', 'wallet', 'cash_on_delivery'];

/**
 * "Registrar pago": the prepay ("cobro para reservar") collected in person. The method list is the store's
 * enabled methods (same util as the consumable deposit); a bank transfer also asks for the destination account.
 * The backend decides amounts, the cash-register gate and idempotency; errors go through the catalog.
 */
@Component({
  selector: 'app-register-prepay-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent, InputComponent, SelectorComponent, CurrencyPipe],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="$event ? null : closed.emit()"
      (opened)="onOpen()"
      [dialog]="true"
      title="Registrar pago"
      [subtitle]="'Reserva #' + bookingNumber()"
      size="md"
    >
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <span class="text-sm text-[var(--color-text-secondary)]">Por cobrar</span>
          <strong class="text-base text-[var(--color-text-primary)]">{{ remaining() | currency }}</strong>
        </div>

        <app-selector
          label="Medio de pago"
          [ngModel]="methodId()"
          (ngModelChange)="onMethodChange($event)"
          [options]="methodOptions()"
          [disabled]="loading()"
        ></app-selector>

        @if (accountOptions().length > 0) {
          <app-selector
            label="Cuenta de destino"
            [ngModel]="accountId()"
            (ngModelChange)="accountId.set($event)"
            [options]="accountOptions()"
          ></app-selector>
        }

        <app-input
          label="Valor a registrar"
          type="number"
          [currency]="true"
          [ngModel]="amount()"
          (ngModelChange)="amount.set($event)"
        ></app-input>

        <app-input
          label="Referencia (opcional)"
          [ngModel]="reference()"
          (ngModelChange)="reference.set($event)"
        ></app-input>

        @if (errorMessage(); as message) {
          <div class="flex items-start gap-2 rounded-xl border border-[var(--color-error)]/40 bg-[var(--color-error)]/5 p-3 text-sm text-[var(--color-text-primary)]" role="alert">
            <app-icon name="alert-triangle" [size]="16" class="mt-0.5 text-[var(--color-error)]"></app-icon>
            <span>{{ message }}</span>
          </div>
        }
      </div>

      <div slot="footer" class="flex items-center justify-end gap-2">
        <app-button variant="ghost" size="sm" (clicked)="closed.emit()">Volver</app-button>
        <app-button variant="primary" size="sm" [disabled]="!canSubmit()" [loading]="submitting()" (clicked)="submit()">
          Registrar pago
        </app-button>
      </div>
    </app-modal>
  `,
})
export class RegisterPrepayDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly reservationsService = inject(ReservationsService);
  private readonly paymentMethodsApi = inject(PaymentMethodsService);
  private readonly toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly bookingId = input<number | null>(null);
  readonly bookingNumber = input<string>('');
  readonly prepay = input<BookingPrepay | null>(null);

  readonly closed = output<void>();
  /** The payment was registered: the parent reloads the booking. */
  readonly done = output<void>();

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly choices = signal<DepositMethodChoice[]>([]);
  readonly rows = signal<StorePaymentMethod[]>([]);
  readonly methodId = signal<number | null>(null);
  readonly accountId = signal<number | null>(null);
  readonly amount = signal<number | null>(null);
  readonly reference = signal('');

  readonly remaining = computed(() => this.prepay()?.remaining ?? 0);

  readonly methodOptions = computed<SelectorOption[]>(() =>
    this.choices().map((c) => ({ value: c.id, label: c.label })),
  );

  private readonly selectedChoice = computed(() => this.choices().find((c) => c.id === this.methodId()) ?? null);

  /** Accounts configured on the chosen transfer method; empty for every other method. */
  readonly accountOptions = computed<SelectorOption[]>(() => {
    const choice = this.selectedChoice();
    if (!choice || choice.type !== 'bank_transfer') return [];
    const row = this.rows().find((r) => Number(r.id) === choice.id);
    const accounts = (row?.custom_config?.['accounts'] ?? []) as Array<{ id?: number; bank_name?: string; account_number?: string }>;
    return accounts
      .filter((a) => Number.isInteger(Number(a.id)) && Number(a.id) > 0)
      .map((a) => ({ value: Number(a.id), label: [a.bank_name, a.account_number].filter(Boolean).join(' · ') || `Cuenta ${a.id}` }));
  });

  readonly canSubmit = computed(() => {
    if (this.submitting() || this.bookingId() == null || this.methodId() == null) return false;
    const amount = Number(this.amount());
    if (!(amount > 0) || amount > this.remaining()) return false;
    return this.accountOptions().length === 0 || this.accountId() != null;
  });

  onOpen(): void {
    this.errorMessage.set(null);
    this.submitting.set(false);
    this.reference.set('');
    this.accountId.set(null);
    this.amount.set(this.remaining() > 0 ? this.remaining() : null);
    if (this.choices().length || this.loading()) return;
    this.loading.set(true);
    this.paymentMethodsApi
      .getStorePaymentMethods({ state: PaymentMethodState.ENABLED, limit: 50 })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const rows = storePaymentMethodRows(res);
          const choices = toDepositMethodChoices(rows).filter((c) => !NOT_AT_THE_DESK.includes(c.type));
          this.rows.set(rows);
          this.choices.set(choices);
          if (this.methodId() == null) this.methodId.set(defaultDepositMethod(choices)?.id ?? null);
        },
        error: () => this.errorMessage.set('No fue posible cargar los medios de pago.'),
      });
  }

  onMethodChange(value: unknown): void {
    this.methodId.set(value == null || value === '' ? null : Number(value));
    this.accountId.set(null);
  }

  submit(): void {
    const id = this.bookingId();
    const methodId = this.methodId();
    if (id == null || methodId == null || !this.canSubmit()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    const body: RegisterPrepayPaymentInput = {
      store_payment_method_id: methodId,
      amount: Number(this.amount()),
      ...(this.accountId() != null ? { bank_account_id: this.accountId() as number } : {}),
      ...(this.reference().trim() ? { reference: this.reference().trim() } : {}),
    };
    this.reservationsService
      .registerPrepayPayment(id, body)
      .pipe(finalize(() => this.submitting.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Pago registrado');
          this.done.emit();
        },
        error: (err) => this.errorMessage.set(extractApiErrorMessage(err) || 'No fue posible registrar el pago.'),
      });
  }
}

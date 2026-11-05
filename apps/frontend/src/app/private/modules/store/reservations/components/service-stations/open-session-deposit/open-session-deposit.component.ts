import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, model, signal, untracked, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { InputComponent, SelectorComponent } from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PaymentMethodsService } from '../../../../settings/payments/services/payment-methods.service';
import { PaymentMethodState } from '../../../../settings/payments/interfaces/payment-methods.interface';
import { ServiceStation, SessionDepositInput } from '../service-stations.service';
import {
  DepositMethodChoice,
  defaultDepositMethod,
  newDepositRequestId,
  storePaymentMethodRows,
  toDepositMethodChoices,
  toDepositMethodOptions,
} from './deposit-payment-methods.util';

/** `deposit` of the open payload; null while the cashier is not receiving one. */
export type OpenSessionDepositValue = SessionDepositInput;

/**
 * Returns the reason the session cannot be opened with this deposit, or null.
 * With a required policy the backend validates too; this only avoids the round trip.
 */
export function openDepositError(
  station: ServiceStation | null | undefined,
  customerId: number | null | undefined,
  deposit: OpenSessionDepositValue | null,
): string | null {
  if (!station || !station.deposit_policy || station.deposit_policy === 'none') return null;
  if (station.deposit_policy === 'required') {
    if (!customerId) return 'Esta estación exige anticipo: identifica al cliente antes de abrir la atención.';
    const required = Number(station.deposit_amount ?? 0);
    if (!deposit || deposit.amount < required) return 'Esta estación exige un anticipo mínimo: registra el monto y el medio de pago.';
    return null;
  }
  // Optional deposit: the amount comes prefilled, and the API only takes it from a known customer (SERVICE_DEPOSIT_002).
  if (deposit && deposit.amount > 0 && !customerId) {
    return 'Identifica al cliente para recibir el anticipo, o vacía el monto para abrir sin anticipo.';
  }
  return null;
}

/** Shown when the store sells only to identified customers and the session has none. */
export const OPEN_CUSTOMER_REQUIRED_MESSAGE =
  'Esta tienda no vende sin cliente: busca o crea el cliente antes de abrir la atención.';

/**
 * Same rule as opening a table: with `pos.allow_anonymous_sales` off, the session account
 * could never be paid (ORD_EDIT_PAY_NOT_ALLOWED_001), so the session needs a customer to open.
 */
export function openCustomerError(allowAnonymousSales: boolean, customerId: number | null | undefined): string | null {
  return allowAnonymousSales || customerId ? null : OPEN_CUSTOMER_REQUIRED_MESSAGE;
}

/** Deposit block of the "Nuevo ingreso" dialog (S4). Hidden when the station has no deposit policy. */
@Component({
  selector: 'app-open-session-deposit',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, InputComponent, SelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Block host so the parent's vertical spacing applies; hidden when there is no deposit policy.
  host: { '[class.block]': 'visible()', '[class.hidden]': '!visible()' },
  template: `
    @if (visible()) {
      <section
        class="p-3.5 rounded-xl bg-[var(--color-background)] border border-[var(--color-border)]/80 space-y-3"
        aria-labelledby="open-deposit-title"
      >
        <div>
          <h4 id="open-deposit-title" class="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Anticipo {{ isRequired() ? '(obligatorio)' : '(opcional)' }}
          </h4>
          <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
            @if (isRequired()) {
              Mínimo {{ requiredAmount() | currency }}; se descuenta de los consumos de la atención.
              @if (!customerIdentified()) {
                <span class="text-[var(--color-error)]"> Identifica al cliente para poder abrir.</span>
              }
            } @else {
              Si el cliente deja un anticipo, se descuenta de sus consumos. Vacía el monto para abrir sin anticipo.
            }
          </p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <app-input
            label="Monto del anticipo"
            [currency]="true"
            [ngModel]="amount()"
            (ngModelChange)="onAmount($event)"
          />
          <app-selector
            label="Medio de pago"
            [options]="methodOptions()"
            [ngModel]="methodId()"
            (ngModelChange)="onMethod($event)"
            [helpText]="loading() ? 'Cargando medios de pago…' : ''"
            placeholder="Selecciona el medio"
          />
        </div>
      </section>
    }
  `,
})
export class OpenSessionDepositComponent {
  private readonly paymentMethodsApi = inject(PaymentMethodsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly station = input<ServiceStation | null>(null);
  /** The customer was identified (a stored customer chosen), required by the "required" policy. */
  readonly customerIdentified = input(false);
  /** Two-way bound deposit of the open payload. */
  readonly value = model<OpenSessionDepositValue | null>(null);

  readonly visible = computed(() => (this.station()?.deposit_policy ?? 'none') !== 'none');
  readonly isRequired = computed(() => this.station()?.deposit_policy === 'required');
  readonly requiredAmount = computed(() => Number(this.station()?.deposit_amount ?? 0) || 0);

  readonly amount = signal<number | null>(null);
  readonly methodId = signal<number | null>(null);
  readonly loading = signal(false);
  private readonly choices = signal<DepositMethodChoice[]>([]);
  readonly methodOptions = computed(() => toDepositMethodOptions(this.choices()));
  private requestId = newDepositRequestId();

  constructor() {
    // A different station means a new attempt: prefill its amount and mint a new request id.
    effect(() => {
      const station = this.station();
      untracked(() => this.reset(station));
    });
  }

  onAmount(raw: unknown): void {
    this.amount.set(raw === '' || raw == null ? null : Number(raw));
    this.emit();
  }

  onMethod(raw: unknown): void {
    const id = Number(raw);
    this.methodId.set(Number.isInteger(id) && id > 0 ? id : null);
    this.emit();
  }

  private reset(station: ServiceStation | null): void {
    this.requestId = newDepositRequestId();
    if (!station || station.deposit_policy === 'none' || !station.deposit_policy) {
      this.amount.set(null);
      this.value.set(null);
      return;
    }
    const prefill = Number(station.deposit_amount ?? 0);
    this.amount.set(prefill > 0 ? prefill : null);
    this.loadMethods();
    this.emit();
  }

  private loadMethods(): void {
    if (this.choices().length || this.loading()) return;
    this.loading.set(true);
    this.paymentMethodsApi
      .getStorePaymentMethods({ state: PaymentMethodState.ENABLED, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const choices = toDepositMethodChoices(storePaymentMethodRows(res));
          this.choices.set(choices);
          if (this.methodId() == null) this.methodId.set(defaultDepositMethod(choices)?.id ?? null);
          this.loading.set(false);
          this.emit();
        },
        error: () => {
          this.choices.set([]);
          this.loading.set(false);
        },
      });
  }

  private emit(): void {
    const amount = this.amount();
    const choice = this.choices().find((c) => c.id === this.methodId());
    if (!amount || amount <= 0 || !choice) {
      this.value.set(null);
      return;
    }
    this.value.set({
      amount,
      method: choice.type,
      store_payment_method_id: choice.id,
      request_id: this.requestId,
    });
  }
}

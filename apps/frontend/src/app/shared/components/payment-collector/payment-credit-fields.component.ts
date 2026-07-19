import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons.registry';
import { CurrencyInputDirective } from '../../directives/currency-input.directive';
import { CurrencyPipe } from '../../pipes/currency';
import { toLocalDateString } from '../../utils/date.util';
import {
  resolvePaymentIcon,
  type PaymentMethod,
} from '../../models/payment-method.model';
import type { CreditTerms } from './payment-collector.model';

type Frequency = 'weekly' | 'biweekly' | 'monthly';

interface InstallmentPreview {
  amount: number;
  due_date: string;
}

/**
 * Credit slice of the payment collector — isolates all installment-plan state
 * (count, frequency, first date, interest, initial payment + its method) behind
 * a single `terms` {@link CreditTerms} `model()`. The parent two-way binds
 * `[(terms)]`; `null` means "not a usable plan yet".
 *
 * Pure UI math only — it derives a live installment preview but performs no
 * network calls. The backend computes the authoritative schedule.
 */
@Component({
  selector: 'app-payment-credit-fields',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent, CurrencyInputDirective, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-credit-fields.component.html',
  styleUrl: './payment-credit-fields.component.scss',
})
export class PaymentCreditFieldsComponent {
  /** Two-way terms model; `null` until the plan is usable. */
  readonly terms = model<CreditTerms | null>(null);

  /** Amount that will be financed (base before subtracting the initial payment). */
  readonly financeBase = input<number>(0);
  /** Methods offered for the optional initial (down) payment. */
  readonly paymentMethods = input<PaymentMethod[]>([]);
  readonly currencyDecimals = input<number>();

  // Independent slices — one signal per concern.
  readonly numInstallments = signal<number>(3);
  readonly frequency = signal<Frequency>('monthly');
  readonly firstDate = signal<string>(this.defaultFirstDate());
  readonly interestRate = signal<number>(0);
  readonly interestType = signal<'simple' | 'compound'>('simple');
  readonly initialPaymentMethodId = signal<number | null>(null);

  /** Currency-formatted initial payment via the shared directive (CVA). */
  readonly initialPaymentControl = new FormControl<number>(0, { nonNullable: true });
  protected readonly initialPayment = toSignal(
    this.initialPaymentControl.valueChanges,
    { initialValue: 0 },
  );

  readonly frequencyOptions: { value: Frequency; label: string }[] = [
    { value: 'weekly', label: 'Semanal' },
    { value: 'biweekly', label: 'Quincenal' },
    { value: 'monthly', label: 'Mensual' },
  ];

  /** Base actually financed after the down payment. */
  readonly remainingToFinance = computed(() =>
    Math.max(0, (this.financeBase() || 0) - (this.initialPayment() || 0)),
  );

  /** Live, display-only installment schedule. */
  readonly installmentsPreview = computed<InstallmentPreview[]>(() => {
    const total = this.remainingToFinance();
    const n = this.numInstallments();
    if (n <= 0 || total <= 0) return [];

    const freqDays: Record<Frequency, number> = { weekly: 7, biweekly: 14, monthly: 30 };
    const periodsPerYear: Record<Frequency, number> = { weekly: 52, biweekly: 26, monthly: 12 };
    const freq = this.frequency();
    const startDate = this.firstDate()
      ? new Date(this.firstDate() + 'T12:00:00')
      : new Date();

    const rawRate = this.interestRate() || 0;
    const annualRate = rawRate > 1 ? rawRate / 100 : rawRate;

    let scheduleTotal = total;
    if (annualRate > 0) {
      const r = annualRate / periodsPerYear[freq];
      scheduleTotal =
        this.interestType() === 'compound'
          ? Math.round(total * Math.pow(1 + r, n) * 100) / 100
          : Math.round((total + total * r * n) * 100) / 100;
    }

    const base = Math.round((scheduleTotal / n) * 100) / 100;
    return Array.from({ length: n }, (_, i) => {
      const due = new Date(startDate);
      due.setDate(due.getDate() + freqDays[freq] * i);
      return {
        amount:
          i === n - 1
            ? Math.round((scheduleTotal - base * (n - 1)) * 100) / 100
            : base,
        due_date: toLocalDateString(due),
      };
    });
  });

  /** Pure derivation of the emitted terms. */
  private readonly computedTerms = computed<CreditTerms | null>(() => {
    const n = this.numInstallments();
    if (!n || n <= 0) return null;
    return {
      numInstallments: n,
      frequency: this.frequency(),
      firstInstallmentDate: this.firstDate(),
      interestRate: this.interestRate(),
      interestType: this.interestType(),
      initialPayment: this.initialPayment() || 0,
      initialPaymentMethodId: this.initialPaymentMethodId() ?? undefined,
    };
  });

  constructor() {
    // Push the derived terms into the two-way model. Reads `computedTerms`
    // only; never reads `terms`, so there is no feedback loop.
    effect(() => this.terms.set(this.computedTerms()));
  }

  setFrequency(freq: Frequency): void {
    this.frequency.set(freq);
  }

  setInterestType(value: string): void {
    this.interestType.set(value === 'compound' ? 'compound' : 'simple');
  }

  onNumInstallments(value: string): void {
    const n = Math.max(1, Math.floor(Number(value) || 0));
    this.numInstallments.set(n);
  }

  onInterestRate(value: string): void {
    this.interestRate.set(Math.max(0, Number(value) || 0));
  }

  onFirstDate(value: string): void {
    this.firstDate.set(value);
  }

  selectInitialMethod(method: PaymentMethod): void {
    const id = Number(method.id);
    this.initialPaymentMethodId.set(
      this.initialPaymentMethodId() === id ? null : id,
    );
  }

  isInitialMethod(method: PaymentMethod): boolean {
    return this.initialPaymentMethodId() === Number(method.id);
  }

  iconFor(method: PaymentMethod): IconName {
    return (method.icon as IconName) || (resolvePaymentIcon(method.type) as IconName);
  }

  private defaultFirstDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return toLocalDateString(date);
  }
}

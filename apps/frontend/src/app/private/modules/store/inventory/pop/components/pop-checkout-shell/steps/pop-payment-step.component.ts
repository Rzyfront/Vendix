import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { scan } from 'rxjs/operators';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { CurrencyFormatService } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { CurrencyPipe } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../../../core/store/store-settings/store-settings.facade';
import { InputComponent } from '../../../../../../../../shared/components/input/input.component';
import { InputButtonsComponent } from '../../../../../../../../shared/components/input-buttons/input-buttons.component';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { PopCartState } from '../../../interfaces/pop-cart.interface';

export type PopPaymentMode = 'immediate' | 'partial' | 'deferred' | 'installments';

/**
 * Plan de pago emitido al padre (misma forma que el `paymentPlan` signal del
 * pop.component.ts). Viaja en el payload de creación; el backend valida que las
 * cuotas cierren el saldo y la matriz anti-doble-registro vive en
 * `attachPaymentPlan` del padre.
 */
export interface PopPaymentPlan {
  payment_plan: PopPaymentMode;
  down_payment_amount: number;
  payment_due_date?: string;
  payment_installments: Array<{ scheduled_date: string; amount: number }>;
}

/** Fecha mínima viva (getter): se re-validó en cada cambio, no al crear el formulario. */
function minDateValidator(getMin: () => string) {
  return (control: AbstractControl) => {
    const value: string = control.value;
    if (!value) return null;
    const min = getMin();
    return value < min ? { minDate: { min } } : null;
  };
}

/** Tope superior vivo (getter): el máximo se lee en cada validación (tope en vivo). */
function maxValueValidator(getMax: () => number) {
  return (control: AbstractControl) => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return { max: { max: getMax() } };
    return n > getMax() ? { max: { max: getMax() } } : null;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const POP_PAYMENT_MODES: Array<{
  value: PopPaymentMode;
  label: string;
  hint: string;
}> = [
  { value: 'immediate', label: 'Pago inmediato', hint: 'Se paga completa ahora' },
  { value: 'partial', label: 'Abono parcial', hint: 'Se paga una parte, el resto queda debiendo' },
  { value: 'deferred', label: 'Pago diferido', hint: 'No se paga ahora; una sola fecha' },
  { value: 'installments', label: 'Crédito con cuotas', hint: 'No se paga ahora; calendario' },
];

/** Opciones para app-input-buttons (misma lista, sin hint que el modal viejo). */
export const POP_PAYMENT_MODE_OPTIONS = POP_PAYMENT_MODES.map((m) => ({
  value: m.value,
  label: m.label,
}));

/**
 * Paso Pago del wizard POP (QUI-647).
 *
 * Reactive forms OBLIGATORIO (no ngModel): `focusFirstInvalid` del shell
 * depende de `.ng-invalid` que el formulario reactivo aplica a los controles.
 * Reglas por modo:
 *  - immediate: sin montos.
 *  - partial: `down_payment_amount` > 0 y ≤ total (tope en vivo); opcional
 *    `payment_due_date` del saldo ≥ hoy (date-only, timezone tienda).
 *  - deferred: `payment_due_date` requerida y ≥ hoy (date-only, timezone tienda).
 *  - installments: ≥ 1 cuota, fecha ≥ hoy, monto ≥ 0.01 y SUMA == (total − abono)
 *    con indicador de cuadre en vivo.
 *
 * Zoneless: el puente `statusChanges → toSignal` (patrón address-form-fields)
 * hace que las computeds que leen el formulario se re-evalúen sin NgZone.
 */
@Component({
  selector: 'app-pop-payment-step',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    InputButtonsComponent,
    IconComponent,
    CurrencyPipe,
  ],
  templateUrl: './pop-payment-step.component.html',
  styleUrl: './pop-payment-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopPaymentStepComponent {
  readonly cartState = input<PopCartState | null>(null);

  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly currencyService = inject(CurrencyFormatService);

  // ── Total de la orden (fuente de los topes y del cuadre) ────────────────
  readonly orderTotal = computed<number>(() =>
    round2(Number(this.cartState()?.summary?.total ?? 0)),
  );

  // ── Formulario reactivo ─────────────────────────────────────────────────
  readonly form = new FormGroup({
    mode: new FormControl<PopPaymentMode>('immediate', { nonNullable: true }),
    downPayment: new FormControl<number | null>(null),
    dueDate: new FormControl<string>(''),
    installments: new FormArray<FormGroup>([]),
  });

  /**
   * Tick monotónico alimentado por `form.valueChanges` y por el FormArray de
   * cuotas (vive dentro del FormGroup pero su `valueChanges` también lo cubre
   * el merge). `scan` garantiza un valor distinto por emisión, así que
   * `Object.is` no anula la invalidación en zoneless — el `mode` no tiene
   * validadores, por lo que `statusChanges` deduplica `'VALID' → 'VALID'` y
   * deja congeladas las computeds que aquí declaran su dependencia (ver
   * `vendix-zoneless-signals`: puentea `valueChanges`, nunca `statusChanges`).
   */
  private readonly formTick = toSignal(
    merge(this.form.valueChanges, this.form.controls.installments.valueChanges).pipe(
      scan((n) => n + 1, 0),
    ),
    { initialValue: 0 },
  );

  // ── Fecha mínima (date-only, timezone de la tienda) ──────────────────────
  readonly todayISO = computed<string>(() => this.dateISOFromInstant(new Date()));

  private dateISOFromInstant(instant: Date): string {
    const tz = this.storeSettings.settings()?.general?.timezone || 'America/Bogota';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }

  // ── Estado derivado (reactive vía formTick) ──────────────────────────────
  readonly installmentGroups = computed<FormGroup[]>(() => {
    this.formTick();
    return this.form.controls.installments.controls as FormGroup[];
  });

  readonly downPaymentAmount = computed<number>(() => {
    this.formTick();
    return Number(this.form.controls.downPayment.value ?? 0);
  });

  /**
   * Lo que queda debiendo tras el abono: lo que las cuotas deben cubrir.
   * El abono solo aplica en modo `partial`; en los demás modos lo que se debe
   * es el total (0 abonado hoy). Evita que un abono residual de un cambio de
   * modo previo contamine el cuadre de cuotas o el plan.
   */
  readonly pendingBalance = computed<number>(() => {
    this.formTick();
    const mode = this.form.controls.mode.value;
    const down = mode === 'partial' ? Number(this.form.controls.downPayment.value ?? 0) : 0;
    return round2(this.orderTotal() - down);
  });

  readonly installmentsTotal = computed<number>(() => {
    this.formTick();
    return round2(
      this.installmentGroups().reduce(
        (sum, g) => sum + Number(g.controls['amount'].value ?? 0),
        0,
      ),
    );
  });

  readonly installmentsBalanced = computed<boolean>(
    () => Math.abs(this.installmentsTotal() - this.pendingBalance()) <= 0.01,
  );

  /** Plan emitido al shell/padre, vigente en cada cambio del formulario. */
  readonly plan = computed<PopPaymentPlan>(() => {
    this.formTick();
    const paymentMode = this.form.controls.mode.value;
    return {
      payment_plan: paymentMode,
      // El abono SOLO aplica en `partial`; en immediate/diferido/cuotas el plan
      // no lleva pago de hoy (un abono residual de otro modo duplicaría el pago).
      down_payment_amount:
        paymentMode === 'partial' ? this.downPaymentAmount() : 0,
      payment_due_date: this.form.controls.dueDate.value || undefined,
      payment_installments:
        paymentMode === 'installments'
          ? this.installmentGroups().map((g) => ({
              scheduled_date: g.controls['scheduled_date'].value as string,
              amount: Number(g.controls['amount'].value ?? 0),
            }))
          : [],
    };
  });

  /** Validez del paso: bloquea "Siguiente" cuando el modo elegido no cierra. */
  readonly isValid = computed<boolean>(() => {
    this.formTick();
    const paymentMode = this.form.controls.mode.value;
    if (paymentMode === 'partial') {
      const value = this.downPaymentAmount();
      return this.form.controls.downPayment.valid && value > 0 && value <= this.orderTotal();
    }
    if (paymentMode === 'deferred') {
      return this.form.controls.dueDate.valid && !!this.form.controls.dueDate.value;
    }
    if (paymentMode === 'installments') {
      const arr = this.form.controls.installments;
      return arr.length >= 1 && arr.valid && this.installmentsBalanced();
    }
    return true; // immediate
  });

  // ── Controles del generador de cuotas ────────────────────────────────────
  readonly installmentCount = signal(2);
  readonly installmentEveryDays = signal(30);

  readonly modeOptions = POP_PAYMENT_MODE_OPTIONS;

  constructor() {
    // La moneda debe estar cargada para el | currency del template.
    this.currencyService.loadCurrency();
  }

  /** Cambio de modo desde app-input-buttons (CVA ya escribió el control). */
  onModeChange(value: string): void {
    const mode = value as PopPaymentMode;
    this.form.controls.mode.setValue(mode);
    this.applyModeValidators(mode);
    if (mode === 'installments' && this.form.controls.installments.length === 0) {
      this.generateInstallments();
    }
  }

  private applyModeValidators(mode: PopPaymentMode): void {
    const down = this.form.controls.downPayment;
    const due = this.form.controls.dueDate;
    down.clearValidators();
    due.clearValidators();
    if (mode === 'partial') {
      down.setValidators([
        Validators.required,
        Validators.min(0.01),
        maxValueValidator(() => this.orderTotal()),
      ]);
      // QUI-647 — fecha del saldo OPCIONAL: sin `Validators.required`, pero si
      // el operador la elige debe ser hoy o futura (date-only, timezone tienda).
      due.setValidators([minDateValidator(() => this.todayISO())]);
    } else if (mode === 'deferred') {
      due.setValidators([Validators.required, minDateValidator(() => this.todayISO())]);
    }
    // Recompute el estado completo con evento: el puente formTick debe ver el
    // nuevo set de validadores, no el previo al cambio de modo.
    this.form.updateValueAndValidity();
  }

  /**
   * Genera N cuotas cada X días repartiendo el saldo (residuo en la última para
   * que la suma cuadre exacto). Fechas en la timezone de la tienda (no UTC).
   */
  generateInstallments(): void {
    const count = Math.max(1, this.installmentCount());
    const everyDays = Math.max(1, this.installmentEveryDays());
    const balance = this.pendingBalance();
    const base = round2(balance / count);
    const arr = this.form.controls.installments;
    arr.clear();
    let assigned = 0;
    const start = Date.now();
    for (let i = 0; i < count; i++) {
      const amount = i === count - 1 ? round2(balance - assigned) : base;
      assigned += base;
      arr.push(
        this.createInstallmentGroup(
          this.dateISOFromInstant(new Date(start + everyDays * (i + 1) * 86_400_000)),
          amount,
        ),
      );
    }
    this.form.updateValueAndValidity();
  }

  addInstallmentRow(): void {
    this.form.controls.installments.push(this.createInstallmentGroup());
    this.form.updateValueAndValidity();
  }

  removeInstallment(index: number): void {
    this.form.controls.installments.removeAt(index);
    this.form.updateValueAndValidity();
  }

  private createInstallmentGroup(
    date = '',
    amount: number | null = null,
  ): FormGroup {
    return new FormGroup({
      scheduled_date: new FormControl<string>(date, [
        Validators.required,
        minDateValidator(() => this.todayISO()),
      ]),
      amount: new FormControl<number | null>(amount, [
        Validators.required,
        Validators.min(0.01),
      ]),
    });
  }

  onCountInput(event: Event): void {
    this.installmentCount.set(
      Math.max(1, Number((event.target as HTMLInputElement).value) || 1),
    );
  }

  onEveryDaysInput(event: Event): void {
    this.installmentEveryDays.set(
      Math.max(1, Number((event.target as HTMLInputElement).value) || 30),
    );
  }

  /** Accesores tipados para el template (strictTemplates: `controls[...]` es AbstractControl). */
  installmentDateControl(group: FormGroup): FormControl<string> {
    return group.controls['scheduled_date'] as FormControl<string>;
  }

  installmentAmountControl(group: FormGroup): FormControl<number | null> {
    return group.controls['amount'] as FormControl<number | null>;
  }

  /** Marca todo como tocado y devuelve si el paso es válido (gate del shell). */
  validate(): boolean {
    this.form.markAllAsTouched();
    return this.isValid();
  }
}
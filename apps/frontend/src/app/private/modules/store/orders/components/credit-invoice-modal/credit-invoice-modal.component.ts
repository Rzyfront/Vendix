import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs';

import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  SelectorComponent,
  type SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { CurrencyPipe } from '../../../../../../shared/pipes';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

/** Payload que el modal entrega al confirmar (cuerpo de `credit` del emit). */
export interface CreditInvoiceSubmit {
  due_date: string;
  payment_means_code?: string;
}

/** Atajos de plazo, en días corridos desde hoy. */
export const CREDIT_TERM_DAYS: readonly number[] = [15, 30, 60, 90];

/**
 * Plazo recomendado al abrir el modal. No hay plazos configurados por cliente
 * ni por tienda: se sugiere 30 días y el cajero lo cambia si quiere.
 */
export const DEFAULT_CREDIT_TERM_DAYS = 30;

/** Medios de pago esperados (códigos DIAN MediosPago). '' = sin definir. */
export const CREDIT_PAYMENT_MEANS_OPTIONS: SelectorOption[] = [
  { value: '', label: 'Sin definir' },
  { value: '42', label: 'Consignación' },
  { value: '47', label: 'Transferencia' },
  { value: '10', label: 'Efectivo' },
  { value: '20', label: 'Cheque' },
];

/** Suma `days` a una fecha local y la devuelve como YYYY-MM-DD local. */
export function localDatePlusDays(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

/** La fecha de vencimiento no puede ser anterior a hoy (fecha local). */
export function notBeforeToday(control: AbstractControl): ValidationErrors | null {
  const value = control.value as string | null;
  if (!value) return null;
  // Comparación lexicográfica de YYYY-MM-DD: sin parseo, sin desfase UTC.
  return value < toLocalDateString() ? { pastDate: true } : null;
}

/**
 * «Facturar a crédito»: pide el vencimiento (y opcionalmente el medio de pago
 * esperado) para emitir la factura de una orden sin pagos como venta a crédito.
 * Abre con todo precargado (emisión hoy, vencimiento a 30 días, medio sin
 * definir); el cajero sólo edita lo que quiera. Si no quiere crédito, «Emitir
 * como Consumidor final (contado)» sale de contado con «Acuerdo mutuo».
 *
 * Zoneless: `isOpen` es un `model()`; el estado del formulario llega a la
 * plantilla por `toSignal(statusChanges)`, nunca leyendo `form.invalid` dentro
 * de un `computed()`.
 */
@Component({
  selector: 'app-credit-invoice-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ModalComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ButtonComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onCancel()"
      title="Facturar a crédito"
      subtitle="La factura saldrá con forma de pago Crédito y su fecha de vencimiento"
      size="md"
    >
      <div
        slot="header"
        class="flex items-center justify-center w-10 h-10 rounded-full bg-primary-100"
      >
        <app-icon name="file-text" [size]="20" class="text-primary-600"></app-icon>
      </div>

      <form [formGroup]="form" (ngSubmit)="onConfirm()" class="space-y-4">
        <app-alert-banner
          variant="warning"
          tone="token"
          icon="alert-triangle"
          heading="Esta orden no tiene pagos registrados"
        >
          Al facturarla a crédito, el saldo quedará en Cartera como cuenta por
          cobrar y la orden ya no se podrá modificar. Si no es una venta a
          crédito, emítela como Consumidor final de contado (medio de pago
          «Acuerdo mutuo»).
        </app-alert-banner>

        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="rounded-lg border border-border bg-surface p-3">
            <dt class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Cliente
            </dt>
            <dd class="mt-1 text-sm font-medium text-text-primary break-words">
              {{ customerName() || 'Sin cliente' }}
            </dd>
          </div>
          <div class="rounded-lg border border-border bg-surface p-3">
            <dt class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Saldo a crédito
            </dt>
            <dd class="mt-1 text-sm font-bold text-text-primary">
              {{ balance() | currency }}
            </dd>
          </div>
          <div class="rounded-lg border border-border bg-surface p-3">
            <dt class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Fecha de emisión
            </dt>
            <dd class="mt-1 text-sm font-medium text-text-primary">
              Hoy, {{ todayLabel }}
            </dd>
          </div>
        </dl>

        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Plazo
          </p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Plazo en días">
            @for (days of termDays; track days) {
              <button
                type="button"
                class="min-h-[40px] px-3 rounded-full border text-sm font-medium transition-colors"
                [class.border-primary-600]="selectedDays() === days"
                [class.bg-primary-50]="selectedDays() === days"
                [class.text-primary-700]="selectedDays() === days"
                [class.border-border]="selectedDays() !== days"
                [attr.aria-pressed]="selectedDays() === days"
                [disabled]="busy()"
                (click)="applyTerm(days)"
              >
                {{ days }} días
              </button>
            }
          </div>
        </div>

        <app-input
          label="Fecha de vencimiento"
          type="date"
          formControlName="due_date"
          [control]="form.controls.due_date"
          [min]="today"
          [required]="true"
          [error]="dueDateError()"
        ></app-input>

        <app-selector
          label="Medio de pago esperado (opcional)"
          formControlName="payment_means_code"
          [options]="paymentMeansOptions"
        ></app-selector>
      </form>

      <div slot="footer">
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-end gap-2">
            <app-button variant="ghost" [disabled]="busy()" (clicked)="onCancel()">
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              [disabled]="!canConfirm()"
              [loading]="busy()"
              (clicked)="onConfirm()"
            >
              Facturar a crédito
            </app-button>
          </div>
          @if (allowFinalConsumer()) {
            <div class="flex justify-end border-t border-border pt-2">
              <app-button
                variant="outline"
                [disabled]="busy()"
                (clicked)="onUseFinalConsumer()"
              >
                Emitir como Consumidor final (contado)
              </app-button>
            </div>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class CreditInvoiceModalComponent {
  private readonly fb = inject(FormBuilder);

  readonly isOpen = model<boolean>(false);
  /** Cliente de la orden (solo lectura). */
  readonly customerName = input<string>('');
  /** Saldo que pasa a crédito (solo lectura). */
  readonly balance = input<number>(0);
  /** El padre está emitiendo: bloquea los botones. */
  readonly busy = input<boolean>(false);
  /** Ofrece salir de contado a Consumidor final en vez de crédito. */
  readonly allowFinalConsumer = input<boolean>(true);

  readonly confirmed = output<CreditInvoiceSubmit>();
  readonly cancelled = output<void>();
  /** El cajero no quiere crédito: emitir a Consumidor final de contado («Acuerdo mutuo»). */
  readonly finalConsumer = output<void>();

  protected readonly termDays = CREDIT_TERM_DAYS;
  protected readonly paymentMeansOptions = CREDIT_PAYMENT_MEANS_OPTIONS;
  /** Hoy en fecha local (YYYY-MM-DD), mínimo del selector de fecha. */
  protected readonly today = toLocalDateString();
  protected readonly todayLabel = new Date().toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  readonly form = this.fb.nonNullable.group({
    due_date: ['', [Validators.required, notBeforeToday]],
    payment_means_code: [''],
  });

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  private readonly dueDateValue = toSignal(
    this.form.controls.due_date.valueChanges.pipe(
      startWith(this.form.controls.due_date.value),
    ),
    { initialValue: this.form.controls.due_date.value },
  );

  /** Atajo activo: el que coincide con la fecha elegida, si alguno. */
  protected readonly selectedDays = computed<number | null>(() => {
    const value = this.dueDateValue();
    return this.termDays.find((d) => localDatePlusDays(d) === value) ?? null;
  });

  protected readonly canConfirm = computed(
    () => this.formStatus() === 'VALID' && !this.busy(),
  );

  protected readonly dueDateError = computed<string>(() => {
    this.formStatus();
    const control = this.form.controls.due_date;
    if (!control.touched && !control.dirty) return '';
    if (control.hasError('required')) return 'Indica la fecha de vencimiento.';
    if (control.hasError('pastDate'))
      return 'La fecha de vencimiento no puede ser anterior a hoy.';
    return '';
  });

  constructor() {
    // Cada apertura parte del formulario precargado con lo recomendado.
    effect(() => {
      if (this.isOpen()) {
        untracked(() =>
          this.form.reset({
            due_date: localDatePlusDays(DEFAULT_CREDIT_TERM_DAYS),
            payment_means_code: '',
          }),
        );
      }
    });
  }

  protected applyTerm(days: number): void {
    this.form.controls.due_date.setValue(localDatePlusDays(days));
    this.form.controls.due_date.markAsDirty();
  }

  protected onConfirm(): void {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const { due_date, payment_means_code } = this.form.getRawValue();
    this.confirmed.emit({
      due_date,
      ...(payment_means_code ? { payment_means_code } : {}),
    });
  }

  protected onUseFinalConsumer(): void {
    if (this.busy()) return;
    this.finalConsumer.emit();
  }

  protected onCancel(): void {
    if (this.busy()) return;
    this.isOpen.set(false);
    this.cancelled.emit();
  }
}

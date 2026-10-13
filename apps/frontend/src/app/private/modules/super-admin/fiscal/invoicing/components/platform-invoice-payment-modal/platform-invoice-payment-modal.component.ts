import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
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
import { firstValueFrom } from 'rxjs';

import {
  AlertBannerComponent,
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { storeToday } from '../../../../../../../shared/utils/date.util';
import { describeApiFailure } from '../../../../../store/invoicing/utils/invoicing-errors.util';
import {
  FiscalBillingAdminService,
  type PlatformInvoicePaymentMethod,
} from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { PAYMENT_METHOD_OPTIONS } from '../../platform-invoicing.constants';

/** Zona de negocio de la plataforma: define «hoy» para la fecha del pago. */
const PLATFORM_TIMEZONE = 'America/Bogota';

/**
 * Registro de un pago contra una factura de plataforma a crédito
 * (`POST platform-invoices/:id/payments`). El monto llega precargado con el
 * saldo y no puede exceder ese saldo (el backend lo vuelve a validar en
 * centavos y responde 409, que se muestra dentro del modal).
 *
 * Emite `saved` con el detalle actualizado que devuelve el POST.
 */
@Component({
  selector: 'app-platform-invoice-payment-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="isOpen.set(false)"
      title="Registrar pago"
      [subtitle]="documentNumber() ? 'Factura ' + documentNumber() : ''"
      size="md"
    >
      <form [formGroup]="form" class="space-y-4">
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Saldo pendiente</span>
          <span class="font-semibold">{{ balanceText() }}</span>
        </div>

        @if (errorMessage(); as msg) {
          <app-alert-banner variant="danger">{{ msg }}</app-alert-banner>
        }

        <app-input
          label="Monto"
          formControlName="amount"
          [control]="form.controls.amount"
          [required]="true"
          [currency]="true"
          placeholder="0"
          [error]="amountError()"
        ></app-input>

        <app-input
          label="Fecha del pago"
          type="date"
          formControlName="paid_at"
          [control]="form.controls.paid_at"
          [required]="true"
        ></app-input>

        <app-selector
          label="Medio de pago"
          [options]="methodOptions"
          [value]="form.controls.payment_method.value"
          (valueChange)="onMethodChange($event)"
        ></app-selector>

        <app-input
          label="Referencia"
          formControlName="reference"
          [control]="form.controls.reference"
          [maxlength]="120"
          placeholder="Número de transacción, recibo, etc."
        ></app-input>

        <app-textarea
          label="Notas"
          formControlName="notes"
          [control]="form.controls.notes"
          [rows]="2"
        ></app-textarea>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button
          type="button"
          variant="outline"
          [disabled]="saving()"
          (clicked)="isOpen.set(false)"
        >
          Cancelar
        </app-button>
        <app-button
          type="button"
          variant="primary"
          [loading]="saving()"
          [disabled]="saving() || formInvalid()"
          (clicked)="submit()"
        >
          Registrar pago
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PlatformInvoicePaymentModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly isOpen = model<boolean>(false);
  /** `fiscal_transmissions.id` de la factura. */
  readonly invoiceId = input<number | null>(null);
  readonly documentNumber = input<string>('');
  /** Saldo pendiente: precarga y tope del monto. */
  readonly balance = input<number>(0);

  /** Detalle actualizado de la factura (respuesta del POST). */
  readonly saved = output<unknown>();

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  readonly balanceText = computed(() => this.currencyFormat.format(this.balance()));

  readonly form = this.fb.group({
    amount: this.fb.control<number | null>(null, [
      Validators.required,
      Validators.min(0.01),
      (control: AbstractControl): ValidationErrors | null => {
        const value = Number(control.value);
        // Se compara en centavos: 0.1 + 0.2 no debe rechazar un saldo de 0.30.
        return Number.isFinite(value) &&
          Math.round(value * 100) > Math.round(this.balance() * 100)
          ? { exceedsBalance: true }
          : null;
      },
    ]),
    paid_at: this.fb.nonNullable.control(storeToday(PLATFORM_TIMEZONE), [
      Validators.required,
    ]),
    payment_method: this.fb.nonNullable.control<PlatformInvoicePaymentMethod>(
      'bank_transfer',
    ),
    reference: this.fb.nonNullable.control('', [Validators.maxLength(120)]),
    notes: this.fb.nonNullable.control('', [Validators.maxLength(500)]),
  });

  private readonly formStatus = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });
  readonly formInvalid = computed(() => this.formStatus() !== 'VALID');

  readonly amountError = computed(() => {
    this.formStatus();
    const control = this.form.controls.amount;
    if (control.touched && control.hasError('exceedsBalance')) {
      return 'El monto no puede exceder el saldo pendiente.';
    }
    return undefined;
  });

  constructor() {
    // Al abrir: monto = saldo, fecha = hoy en Bogotá, sin error previo.
    effect(() => {
      if (!this.isOpen()) return;
      const balance = this.balance();
      untracked(() => {
        this.errorMessage.set(null);
        this.form.reset({
          amount: balance > 0 ? balance : null,
          paid_at: storeToday(PLATFORM_TIMEZONE),
          payment_method: 'bank_transfer',
          reference: '',
          notes: '',
        });
      });
    });
  }

  onMethodChange(value: string | number | null): void {
    this.form.controls.payment_method.setValue(
      (value ?? 'other') as PlatformInvoicePaymentMethod,
    );
  }

  async submit(): Promise<void> {
    const id = this.invoiceId();
    if (id === null || this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      const detail = await firstValueFrom(
        this.fiscal.registerPlatformInvoicePayment(id, {
          amount: Math.round(Number(v.amount) * 100) / 100,
          paid_at: v.paid_at,
          payment_method: v.payment_method,
          ...(v.reference.trim() ? { reference: v.reference.trim() } : {}),
          ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
        }),
      );
      this.isOpen.set(false);
      this.saved.emit(detail);
    } catch (error) {
      this.errorMessage.set(describeApiFailure(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}

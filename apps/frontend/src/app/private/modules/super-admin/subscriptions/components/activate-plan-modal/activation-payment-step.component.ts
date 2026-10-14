import { Component, computed, inject, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  ActivatePlanPaymentMethod,
  ActivatePlanPreview,
} from '../../interfaces/subscription-admin.interface';

/** Controles tipados del formulario de activacion (lo crea el shell). */
export interface ActivationFormControls {
  starts_at: FormControl<string>;
  amount: FormControl<string | number | null>;
  payment_method: FormControl<ActivatePlanPaymentMethod>;
  paid_at: FormControl<string>;
  reference: FormControl<string | null>;
  notes: FormControl<string | null>;
  accept_partial_payment: FormControl<boolean>;
  confirm_received: FormControl<boolean>;
}

export type ActivationFormValues = ReturnType<
  FormGroup<ActivationFormControls>['getRawValue']
>;

/** Mensajes de error ya resueltos por el shell (null = sin error). */
export interface ActivationFieldErrors {
  startsAt?: string | null;
  amount?: string | null;
  paidAt?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export const ACTIVATION_PAYMENT_METHOD_OPTIONS: SelectorOption[] = [
  { value: 'consignacion', label: 'Consignación' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'otro', label: 'Otro' },
];

/** Convierte un monto decimal (string o numero) a centavos enteros. */
export function toCents(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

@Component({
  selector: 'app-activation-payment-step',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  template: `
    <div class="space-y-4">
      @if (previewError()) {
        <div
          class="flex items-start gap-3 rounded-lg border border-[var(--color-error)] p-3 text-sm"
          role="alert"
        >
          <app-icon
            name="alert-triangle"
            [size]="18"
            class="text-[var(--color-error)] mt-0.5"
          ></app-icon>
          <div class="flex-1 min-w-0">
            <p class="text-text-primary">{{ previewError() }}</p>
          </div>
          <app-button variant="outline" size="sm" (clicked)="retryPreview.emit()">
            Reintentar
          </app-button>
        </div>
      }

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <app-input
          label="Fecha de inicio"
          type="date"
          [required]="true"
          [min]="minStartDate()"
          [max]="maxDate()"
          [error]="fieldErrors().startsAt ?? undefined"
          [formControl]="form().controls.starts_at"
        ></app-input>
        <div class="text-sm md:pt-7">
          <span class="text-text-secondary">Fin del período:</span>
          @if (preview(); as p) {
            <span class="text-text-primary font-medium">
              {{ formatDate(p.period_end) }}
            </span>
          } @else if (previewLoading()) {
            <span class="text-text-secondary">Calculando…</span>
          } @else {
            <span class="text-text-secondary">—</span>
          }
        </div>
      </div>

      @if (preview(); as p) {
        @if (p.is_free) {
          <div
            class="flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-sm"
          >
            <app-icon
              name="info"
              [size]="18"
              class="text-primary mt-0.5"
            ></app-icon>
            <p class="text-text-primary">Se activa sin factura ni pago.</p>
          </div>
        } @else {
          <div class="rounded-lg border border-border bg-background p-3 space-y-1">
            <p class="text-xs text-text-secondary">Total a cobrar</p>
            <p class="text-lg font-semibold text-text-primary">
              {{ money(p.invoice_total) }}
            </p>
            @if (creditApplied() > 0) {
              <p class="text-xs text-text-secondary">
                Crédito aplicado {{ money(p.pending_credit_applied) }}
              </p>
            }
          </div>

          <app-input
            label="Monto recibido"
            [currency]="true"
            [required]="true"
            [error]="fieldErrors().amount ?? undefined"
            [formControl]="form().controls.amount"
          ></app-input>

          @if (excessCents() > 0) {
            <div
              class="flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-sm"
            >
              <app-icon
                name="info"
                [size]="16"
                class="text-primary mt-0.5"
              ></app-icon>
              <p class="text-text-primary">
                El excedente de {{ money(p.excess_to_credit) }} queda como
                crédito para la próxima factura.
              </p>
            </div>
          }

          @if (hasShortfall()) {
            <div class="flex items-center gap-3">
              <app-toggle
                label="Aceptar pago parcial"
                [formControl]="form().controls.accept_partial_payment"
              ></app-toggle>
            </div>
          }

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <app-selector
              label="Medio de pago"
              [options]="methodOptions"
              [formControl]="form().controls.payment_method"
            ></app-selector>
            <app-input
              label="Fecha de pago"
              type="date"
              [max]="maxDate()"
              [error]="fieldErrors().paidAt ?? undefined"
              [formControl]="form().controls.paid_at"
            ></app-input>
          </div>

          <app-input
            label="Referencia / N° de consignación"
            placeholder="Si la dejas vacía se genera SA-…"
            [maxlength]="128"
            [error]="fieldErrors().reference ?? undefined"
            [formControl]="form().controls.reference"
          ></app-input>
        }
      }

      <app-textarea
        label="Notas"
        placeholder="Opcional"
        [rows]="3"
        [error]="fieldErrors().notes ?? undefined"
        [formControl]="form().controls.notes"
      ></app-textarea>

      @if (visibleWarnings().length > 0) {
        <section
          class="rounded-lg border border-border bg-surface p-3 space-y-2"
          aria-label="Qué va a pasar"
        >
          <h4 class="text-sm font-semibold text-text-primary">
            Qué va a pasar
          </h4>
          <ul class="space-y-2">
            @for (w of visibleWarnings(); track w.code) {
              <li class="flex items-start gap-2 text-sm text-text-primary">
                <app-icon
                  name="info"
                  [size]="16"
                  class="text-text-secondary mt-0.5 shrink-0"
                ></app-icon>
                <span>{{ w.message }}</span>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class ActivationPaymentStepComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly form = input.required<FormGroup<ActivationFormControls>>();
  readonly preview = input<ActivatePlanPreview | null>(null);
  readonly previewLoading = input<boolean>(false);
  readonly previewError = input<string | null>(null);
  readonly minStartDate = input<string>('');
  readonly maxDate = input<string>('');
  readonly fieldErrors = input<ActivationFieldErrors>({});
  readonly retryPreview = output<void>();

  readonly methodOptions = ACTIVATION_PAYMENT_METHOD_OPTIONS;

  readonly creditApplied = computed(() =>
    toCents(this.preview()?.pending_credit_applied),
  );
  readonly excessCents = computed(() =>
    toCents(this.preview()?.excess_to_credit),
  );
  readonly hasShortfall = computed(
    () => toCents(this.preview()?.shortfall) > 0,
  );

  /** UNDERPAYMENT se omite si el error del monto ya se muestra. */
  readonly visibleWarnings = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const hideUnderpayment = !!this.fieldErrors().amount;
    return (p.warnings ?? []).filter(
      (w) => !(hideUnderpayment && w.code === 'UNDERPAYMENT'),
    );
  });

  money(value: string | number | null | undefined): string {
    return this.currencyFormat.format(value);
  }

  formatDate(value: string): string {
    return formatDateOnlyUTC(value);
  }
}

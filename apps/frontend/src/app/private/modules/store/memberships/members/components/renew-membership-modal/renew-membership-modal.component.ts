import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { IconName } from '../../../../../../../shared/components/icon/icons.registry';
import { CurrencyInputDirective } from '../../../../../../../shared/directives/currency-input.directive';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { PaymentMethodsService } from '../../../../settings/payments/services/payment-methods.service';
import { StorePaymentMethod } from '../../../../settings/payments/interfaces/payment-methods.interface';

import { GymMembership, RenewMembershipDto } from '../../interfaces';
import { MembershipsService } from '../../services';

interface RenewFormShape {
  store_payment_method_id: FormControl<string | null>;
  amount: FormControl<number | null>;
}

/** Lightweight payment-method option rendered as a POS-style card in the grid. */
interface RenewPaymentMethodOption {
  id: string;
  label: string;
  type: string;
}

/**
 * Generic membership renew/charge modal (Membership Suite).
 *
 * Loads the store's enabled payment methods, lets the operator pick one and
 * (optionally) override the amount, then calls the backend renew endpoint via
 * `MembershipsService`. It shows a live "total a cobrar" using the shared
 * `CurrencyPipe` and surfaces the real outcome as a faithful toast: success,
 * pending payment, or error (the backend now throws on real failures).
 *
 * Inspired by the POS and table payment interfaces, kept intentionally simple
 * and dynamic. Zoneless + signals only (input/model/output/signal/computed).
 * Emits `renewed` with the refreshed membership so the parent updates its view.
 */
@Component({
  selector: 'app-membership-renew-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    CurrencyInputDirective,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [(isOpen)]="open"
      title="Renovar membresía"
      subtitle="Cobra el plan y extiende un período de vigencia."
      size="md"
      (closed)="onClose()"
    >
      <div class="space-y-4">
        <!-- Resumen + total prominente (estilo POS) -->
        <section class="ms-card">
          <div class="section-header">
            <div class="section-indicator"></div>
            <h3 class="section-title">Resumen</h3>
          </div>

          <div class="summary-details">
            <div class="summary-row">
              <span>Plan</span>
              <span class="summary-value">{{ membership()?.plan?.name ?? '—' }}</span>
            </div>
            <div class="summary-row">
              <span>Precio del plan</span>
              <span class="summary-value">{{ planPrice() | currency }}</span>
            </div>
          </div>

          <div class="total-section">
            <p class="total-label">Total a cobrar</p>
            <p class="total-amount">{{ totalToCharge() | currency }}</p>
          </div>
        </section>

        <!-- Grid de métodos de pago (estilo POS) -->
        <section class="ms-card">
          <div class="section-header">
            <div class="section-indicator"></div>
            <h3 class="section-title">Método de pago</h3>
          </div>

          @if (isLoadingMethods()) {
            <div class="ms-methods-loading">Cargando métodos de pago…</div>
          } @else if (paymentMethods().length > 0) {
            <div class="payment-methods-grid">
              @for (m of paymentMethods(); track m.id) {
                <button
                  type="button"
                  class="payment-method-btn"
                  [class.selected]="isSelected(m.id)"
                  (click)="selectMethod(m)"
                >
                  <app-icon [name]="getPaymentIcon(m.type)" [size]="24" />
                  <span class="method-name">{{ m.label }}</span>
                </button>
              }
            </div>
          } @else {
            <div class="no-methods">
              <app-icon name="credit-card" [size]="24" />
              <p>No hay métodos de pago habilitados en la tienda</p>
            </div>
          }
        </section>

        <!-- Monto personalizado (opcional) -->
        <section class="ms-card">
          <div class="section-header">
            <div class="section-indicator"></div>
            <h3 class="section-title">Monto personalizado</h3>
          </div>

          <form [formGroup]="form">
            <input
              appCurrencyInput
              formControlName="amount"
              placeholder="Usar precio del plan"
              class="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-text-primary outline-none focus:border-primary"
            />
            <span class="ms-amount-hint"
              >Si lo dejas vacío se cobra el precio del plan.</span
            >
          </form>
        </section>
      </div>

      <div slot="footer" class="ms-footer">
        <app-button
          variant="primary"
          [fullWidth]="true"
          [loading]="isSubmitting()"
          [disabled]="isSubmitting() || !selectedMethodId() || !membership()"
          (clicked)="submit()"
        >
          <app-icon slot="icon" name="check-circle" [size]="18" />
          Cobrar y renovar
        </app-button>
        <app-button
          variant="ghost"
          [fullWidth]="true"
          [disabled]="isSubmitting()"
          (clicked)="onClose()"
          >Cancelar</app-button
        >
      </div>
    </app-modal>
  `,
  styles: [
    `
      .ms-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 16px;
        padding: 16px;
      }

      /* Section header with primary indicator bar */
      .section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
      }

      .section-indicator {
        width: 4px;
        height: 20px;
        background: var(--color-primary);
        border-radius: 2px;
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      /* Summary rows */
      .summary-details {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: var(--color-text-muted);
      }

      .summary-value {
        font-weight: 600;
        color: var(--color-text-primary);
      }

      /* Prominent total */
      .total-section {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--color-border);
      }

      .total-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-text-muted);
        font-weight: 600;
        margin: 0;
      }

      .total-amount {
        font-size: 24px;
        font-weight: 700;
        color: var(--color-primary);
        margin: 4px 0 0 0;
      }

      /* Payment methods grid */
      .payment-methods-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }

      .payment-method-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 16px 12px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
        cursor: pointer;
        /* Sin transición: esta página corre change-detection continuo (stream
           SSE de acceso ambiental W4). Una transition:all reinicia la animación
           cada ciclo y el estado seleccionado nunca asienta; el highlight se
           aplica al instante. */
        color: var(--color-text-muted);
      }

      .payment-method-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .payment-method-btn.selected {
        border: 2px solid var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
        color: var(--color-primary);
      }

      .method-name {
        font-size: 12px;
        font-weight: 600;
        margin-top: 8px;
        color: var(--color-text-primary);
        text-align: center;
        line-height: 1.2;
      }

      .ms-methods-loading {
        text-align: center;
        padding: 16px 0;
        font-size: 13px;
        color: var(--color-text-muted);
      }

      .no-methods {
        text-align: center;
        padding: 24px;
        color: var(--color-text-muted);
      }

      .no-methods p {
        font-size: 13px;
        margin: 8px 0 0 0;
      }

      /* Amount input hint */
      .ms-amount-hint {
        display: block;
        font-size: 12px;
        color: var(--color-text-muted);
        margin-top: 6px;
      }

      /* Footer: prominent full-width charge CTA + subtle cancel */
      .ms-footer {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
    `,
  ],
})
export class RenewMembershipModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly membershipsService = inject(MembershipsService);
  private readonly paymentMethodsService = inject(PaymentMethodsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model<boolean>(false);
  readonly membership = input<GymMembership | null>(null);
  readonly renewed = output<GymMembership>();

  /** POS-style payment-method cards rendered in the grid. */
  readonly paymentMethods = signal<RenewPaymentMethodOption[]>([]);
  /** Currently selected method id (numeric), mirrored into the form control. */
  readonly selectedMethodId = signal<number | null>(null);
  readonly isLoadingMethods = signal(false);
  readonly isSubmitting = signal(false);
  private methodsLoaded = false;

  readonly form: FormGroup<RenewFormShape> =
    this.fb.nonNullable.group<RenewFormShape>({
      store_payment_method_id: this.fb.nonNullable.control<string | null>(null, {
        validators: [Validators.required],
      }),
      amount: this.fb.nonNullable.control<number | null>(null),
    });

  /** Plan base price coerced to a number for the currency pipe (Decimal → string). */
  readonly planPrice = computed(
    () => Number(this.membership()?.plan?.price ?? 0) || 0,
  );

  /**
   * Reactive bridge: a FormControl.value read inside a computed is NOT reactive
   * in zoneless, so we mirror the amount control through toSignal(valueChanges).
   */
  private readonly amountValue = toSignal(
    this.form.controls.amount.valueChanges,
    { initialValue: this.form.controls.amount.value },
  );

  /** Live total: custom amount when provided (> 0), otherwise the plan price. */
  readonly totalToCharge = computed(() => {
    const custom = this.amountValue();
    const n = custom == null ? NaN : Number(custom);
    return Number.isFinite(n) && n > 0 ? n : this.planPrice();
  });

  constructor() {
    // Lazy-load payment methods the first time the modal opens.
    effect(() => {
      if (this.open() && !this.methodsLoaded) {
        this.methodsLoaded = true;
        this.loadPaymentMethods();
      }
    });
  }

  private loadPaymentMethods(): void {
    this.isLoadingMethods.set(true);
    this.paymentMethodsService
      .getStorePaymentMethods({ state: 'enabled' as never, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          // getStorePaymentMethods already unwraps the ResponseService envelope
          // and returns the array; guard against both shapes to avoid the empty
          // grid caused by an extra `.data` unwrap.
          const raw = result as unknown as
            | StorePaymentMethod[]
            | { data?: StorePaymentMethod[] };
          const methods = Array.isArray(raw) ? raw : (raw?.data ?? []);
          this.paymentMethods.set(
            methods.map((m) => ({
              id: m.id,
              label:
                m.display_name ||
                m.system_payment_method?.display_name ||
                m.system_payment_method?.name ||
                `Método ${m.id}`,
              type: m.system_payment_method?.type ?? '',
            })),
          );
          this.isLoadingMethods.set(false);
        },
        error: () => {
          this.toastService.error(
            'No se pudieron cargar los métodos de pago de la tienda',
          );
          this.isLoadingMethods.set(false);
        },
      });
  }

  /** Select a payment method: drive the UI signal and mirror it into the
   *  form control so submit() and validation keep working unchanged. */
  selectMethod(method: RenewPaymentMethodOption): void {
    this.selectedMethodId.set(Number(method.id));
    this.form.controls.store_payment_method_id.setValue(method.id);
  }

  /** Signal-driven selected state for the grid card. */
  isSelected(id: string): boolean {
    return this.selectedMethodId() === Number(id);
  }

  /** Map a payment-method type to a registered Lucide icon key. */
  getPaymentIcon(type: string | null | undefined): IconName {
    switch ((type ?? '').toLowerCase()) {
      case 'cash':
        return 'cash';
      case 'card':
        return 'credit-card';
      case 'bank_transfer':
        return 'bank';
      case 'digital_wallet':
      case 'wompi':
        return 'smartphone';
      case 'wallet':
      case 'voucher':
        return 'wallet';
      default:
        return 'credit-card';
    }
  }

  onClose(): void {
    this.open.set(false);
    this.selectedMethodId.set(null);
    this.form.reset();
  }

  submit(): void {
    const membership = this.membership();
    if (!membership) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toastService.warning('Selecciona un método de pago');
      return;
    }

    const raw = this.form.getRawValue();
    const dto: RenewMembershipDto = {
      store_payment_method_id: Number(raw.store_payment_method_id),
      amount: raw.amount == null ? undefined : Number(raw.amount),
    };

    this.isSubmitting.set(true);
    this.membershipsService
      .renew(membership.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isSubmitting.set(false);
          if (result.renewed) {
            this.toastService.success(
              'Membresía renovada y cobrada correctamente',
            );
          } else {
            this.toastService.info(
              'Cobro iniciado; la membresía se activará al confirmarse el pago',
            );
          }
          this.form.reset();
          this.open.set(false);
          if (result.membership) this.renewed.emit(result.membership);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al renovar la membresía',
          );
        },
      });
  }
}

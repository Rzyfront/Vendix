import {
  Component,
  DestroyRef,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyInputDirective } from '../../../../../../../shared/directives/currency-input.directive';
import { PaymentMethodsService } from '../../../../settings/payments/services/payment-methods.service';

import { GymMembership, RenewMembershipDto } from '../../interfaces';
import { GymMembershipsService } from '../../services';

interface RenewFormShape {
  store_payment_method_id: FormControl<string | null>;
  amount: FormControl<number | null>;
}

/**
 * Renew (and charge) a membership from reception. Loads the store's enabled
 * payment methods and calls `POST /store/gym/memberships/:id/renew`. Emits
 * `renewed` with the refreshed membership so the parent can update its view.
 */
@Component({
  selector: 'app-gym-renew-membership-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    SelectorComponent,
    ButtonComponent,
    CurrencyInputDirective,
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
        <div
          class="rounded-lg border border-border bg-background p-3 text-sm text-text-secondary"
        >
          <div class="flex justify-between">
            <span>Plan</span>
            <span class="font-semibold text-text-primary">{{
              membership()?.plan?.name ?? '—'
            }}</span>
          </div>
          <div class="flex justify-between mt-1">
            <span>Precio del plan</span>
            <span class="font-semibold text-text-primary">{{
              membership()?.plan?.price ?? 0
            }}</span>
          </div>
        </div>

        <form [formGroup]="form" class="space-y-4">
          <app-selector
            formControlName="store_payment_method_id"
            label="Método de pago"
            placeholder="Selecciona un método de pago"
            [options]="paymentMethodOptions()"
            [required]="true"
            [disabled]="isLoadingMethods()"
          />

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-text-primary"
              >Monto (opcional)</label
            >
            <input
              appCurrencyInput
              formControlName="amount"
              placeholder="Usar precio del plan"
              class="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-text-primary outline-none focus:border-primary"
            />
            <span class="text-xs text-text-muted"
              >Si lo dejas vacío se cobra el precio del plan.</span
            >
          </div>
        </form>
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="isSubmitting()"
          [disabled]="isSubmitting() || form.invalid"
          (clicked)="submit()"
          >Cobrar y renovar</app-button
        >
      </div>
    </app-modal>
  `,
})
export class GymRenewMembershipModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly membershipsService = inject(GymMembershipsService);
  private readonly paymentMethodsService = inject(PaymentMethodsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model<boolean>(false);
  readonly membership = input<GymMembership | null>(null);
  readonly renewed = output<GymMembership>();

  readonly paymentMethodOptions = signal<SelectorOption[]>([]);
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
          const methods = result?.data ?? [];
          this.paymentMethodOptions.set(
            methods.map((m) => ({
              value: m.id,
              label:
                m.display_name ||
                m.system_payment_method?.display_name ||
                m.system_payment_method?.name ||
                `Método ${m.id}`,
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

  onClose(): void {
    this.open.set(false);
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
          this.toastService.success(
            result.renewed
              ? 'Membresía renovada y cobrada correctamente'
              : 'Cobro iniciado; la membresía se activará al confirmarse el pago',
          );
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

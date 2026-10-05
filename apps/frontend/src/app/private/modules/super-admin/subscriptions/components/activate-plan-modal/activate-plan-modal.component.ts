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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import {
  ActivatePlanPaymentMethod,
  ActivateStorePlanDto,
  ActivateStorePlanResult,
  SubscriptionPlan,
} from '../../interfaces/subscription-admin.interface';

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'mensual',
  quarterly: 'trimestral',
  semiannual: 'semestral',
  biannual: 'bianual',
  annual: 'anual',
  lifetime: 'vitalicio',
};

@Component({
  selector: 'app-activate-plan-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      size="md"
      title="Activar plan"
      [subtitle]="storeName() ? 'Tienda: ' + storeName() : ''"
    >
      <form [formGroup]="form" class="space-y-4">
        <app-selector
          label="Plan"
          placeholder="Selecciona un plan"
          [required]="true"
          [options]="planOptions()"
          [formControl]="form.controls.plan_id"
        ></app-selector>

        <app-input
          label="Monto recibido"
          placeholder="Si lo dejas vacío se registra el precio del plan"
          [currency]="true"
          [formControl]="form.controls.amount"
        ></app-input>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-selector
            label="Medio de pago"
            [options]="methodOptions"
            [formControl]="form.controls.payment_method"
          ></app-selector>
          <app-input
            label="Fecha de pago"
            type="date"
            [formControl]="form.controls.paid_at"
          ></app-input>
        </div>

        <app-input
          label="Referencia / N° de consignación"
          placeholder="Opcional"
          [formControl]="form.controls.reference"
        ></app-input>

        <app-textarea
          label="Notas"
          placeholder="Opcional"
          [rows]="3"
          [formControl]="form.controls.notes"
        ></app-textarea>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="isOpen.set(false)">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="submit()"
          [disabled]="!hasPlan() || submitting()"
          [loading]="submitting()"
        >
          Activar plan
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ActivatePlanModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly subscriptionAdmin = inject(SubscriptionAdminService);
  private readonly toast = inject(ToastService);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly isOpen = model<boolean>(false);
  readonly storeId = input.required<number>();
  readonly storeName = input<string>('');
  readonly activated = output<ActivateStorePlanResult>();

  readonly submitting = signal(false);
  private readonly plans = signal<SubscriptionPlan[]>([]);
  private plansLoaded = false;

  readonly methodOptions: SelectorOption[] = [
    { value: 'consignacion', label: 'Consignación' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'otro', label: 'Otro' },
  ];

  readonly form = new FormGroup({
    plan_id: new FormControl<string | number | null>(null),
    amount: new FormControl<string | number | null>(null),
    payment_method: new FormControl<string | number | null>('consignacion'),
    reference: new FormControl<string | null>(null),
    paid_at: new FormControl<string | null>(toLocalDateString()),
    notes: new FormControl<string | null>(null),
  });

  // Los FormControl no son señales: se puentea el valor del plan.
  private readonly planIdValue = signal<string | number | null>(null);
  readonly hasPlan = computed(() => {
    const v = this.planIdValue();
    return v !== null && v !== undefined && v !== '';
  });

  readonly planOptions = computed<SelectorOption[]>(() =>
    this.plans().map((p) => ({
      value: p.id,
      label: `${p.name} · ${this.formatPrice(p.base_price)} · ${
        CYCLE_LABELS[p.billing_cycle] ?? p.billing_cycle
      }`,
    })),
  );

  constructor() {
    this.form.controls.plan_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.planIdValue.set(v));

    effect(() => {
      if (this.isOpen()) {
        this.resetForm();
        this.loadPlans();
      }
    });
  }

  private formatPrice(value: number): string {
    return this.currencyFormat.format(Number(value) || 0);
  }

  private resetForm(): void {
    this.form.reset({
      plan_id: null,
      amount: null,
      payment_method: 'consignacion',
      reference: null,
      paid_at: toLocalDateString(),
      notes: null,
    });
    this.planIdValue.set(null);
  }

  private loadPlans(): void {
    if (this.plansLoaded) return;
    this.subscriptionAdmin
      .getPlans({ is_active: true, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.plans.set(res.data ?? []);
          this.plansLoaded = true;
        },
        error: (err) => this.toast.error(extractApiErrorMessage(err)),
      });
  }

  submit(): void {
    const v = this.form.getRawValue();
    if (!this.hasPlan() || this.submitting()) return;

    const body: ActivateStorePlanDto = { plan_id: Number(v.plan_id) };
    if (v.amount !== null && v.amount !== '' && v.amount !== undefined) {
      body.amount = String(v.amount);
    }
    if (v.payment_method) {
      body.payment_method = v.payment_method as ActivatePlanPaymentMethod;
    }
    if (v.reference?.trim()) body.reference = v.reference.trim();
    if (v.paid_at) body.paid_at = v.paid_at;
    if (v.notes?.trim()) body.notes = v.notes.trim();

    this.submitting.set(true);
    this.subscriptionAdmin
      .activateStorePlan(this.storeId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          const data = res.data;
          const invoice = data.invoice_number
            ? ` · Factura ${data.invoice_number}`
            : '';
          this.toast.success(`Plan ${data.plan_name} activado${invoice}`);
          this.activated.emit(data);
          this.isOpen.set(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }
}

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
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Subscription, catchError, map, of } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
} from 'rxjs/operators';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  StepsLineComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  formatDateOnlyUTC,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import {
  ActivatePlanOptions,
  ActivatePlanPreview,
  ActivatePlanPreviewRequest,
  ActivateStorePlanDto,
  ActivateStorePlanResult,
} from '../../interfaces/subscription-admin.interface';
import { PlanCatalogStepComponent } from './plan-catalog-step.component';
import {
  ActivationFieldErrors,
  ActivationFormControls,
  ActivationPaymentStepComponent,
  toCents,
} from './activation-payment-step.component';
import { ActivationSummaryComponent } from './activation-summary.component';

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'mensual',
  quarterly: 'trimestral',
  semiannual: 'semestral',
  biannual: 'bianual',
  annual: 'anual',
  lifetime: 'vitalicio',
};

const STATE_LABELS: Record<string, string> = {
  trial: 'Prueba',
  active: 'Activa',
  grace_soft: 'En gracia',
  grace_hard: 'En gracia',
  past_due: 'Vencida',
  suspended: 'Suspendida',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  pending_payment: 'Pendiente de pago',
  draft: 'Borrador',
};

const START_WINDOW_DAYS = 31;
const PREVIEW_DEBOUNCE_MS = 300;

function todayString(): string {
  return toLocalDateString();
}

function minStartString(): string {
  const d = new Date();
  d.setDate(d.getDate() - START_WINDOW_DAYS);
  return toLocalDateString(d);
}

/** Fechas YYYY-MM-DD: comparacion lexicografica segura. */
function startsAtRangeValidator(c: AbstractControl): ValidationErrors | null {
  const v = c.value as string | null;
  if (!v) return null;
  if (v < minStartString()) return { minDate: true };
  if (v > todayString()) return { maxDate: true };
  return null;
}

function notFutureValidator(c: AbstractControl): ValidationErrors | null {
  const v = c.value as string | null;
  if (!v) return null;
  return v > todayString() ? { maxDate: true } : null;
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

interface PreviewParams extends ActivatePlanPreviewRequest {
  nonce: number;
}

@Component({
  selector: 'app-activate-plan-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    ToggleComponent,
    PlanCatalogStepComponent,
    ActivationPaymentStepComponent,
    ActivationSummaryComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      size="xl-mid"
      title="Asignar plan"
      [subtitle]="storeName() ? 'Tienda: ' + storeName() : ''"
    >
      <div class="space-y-4">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-text-secondary">Estado actual:</span>
          <span
            class="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-text-primary"
          >
            {{ currentChip() }}
          </span>
        </div>

        @if (!result()) {
          <app-steps-line
            [steps]="steps"
            [currentStep]="step()"
          ></app-steps-line>
        }

        @if (result(); as r) {
          <app-activation-summary
            [storeName]="storeName()"
            [result]="r"
          ></app-activation-summary>
        } @else {
          @switch (step()) {
            @case (0) {
              <app-plan-catalog-step
                [groups]="options()?.groups ?? []"
                [current]="options()?.current ?? null"
                [loading]="optionsLoading()"
                [error]="optionsError()"
                [(selectedPlanId)]="selectedPlanId"
                (retry)="loadOptions()"
              ></app-plan-catalog-step>
            }
            @case (1) {
              <app-activation-payment-step
                [form]="form"
                [preview]="preview()"
                [previewLoading]="previewLoading()"
                [previewError]="previewError()"
                [minStartDate]="minStartDate()"
                [maxDate]="maxDate()"
                [fieldErrors]="fieldErrors()"
                (retryPreview)="retryPreview()"
              ></app-activation-payment-step>
            }
            @case (2) {
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
                    <p class="flex-1 text-text-primary">{{ previewError() }}</p>
                    <app-button
                      variant="outline"
                      size="sm"
                      (clicked)="retryPreview()"
                    >
                      Reintentar
                    </app-button>
                  </div>
                }

                <app-activation-summary
                  [storeName]="storeName()"
                  [planName]="selectedGroup()?.name ?? ''"
                  [cycleLabel]="cycleLabel()"
                  [preview]="preview()"
                  [values]="formValue()"
                ></app-activation-summary>

                @if (preview() && !preview()!.is_free) {
                  <div
                    class="rounded-lg border border-border bg-surface p-3"
                  >
                    <app-toggle
                      label="Confirmo que el pago fue recibido"
                      [formControl]="form.controls.confirm_received"
                    ></app-toggle>
                  </div>
                }

                @if (submitError(); as msg) {
                  <div
                    class="flex items-start gap-3 rounded-lg border border-[var(--color-error)] p-3 text-sm"
                    role="alert"
                  >
                    <app-icon
                      name="alert-triangle"
                      [size]="18"
                      class="text-[var(--color-error)] mt-0.5"
                    ></app-icon>
                    <p class="flex-1 text-text-primary">{{ msg }}</p>
                  </div>
                }
              </div>
            }
          }
        }
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (result()) {
          <app-button variant="primary" (clicked)="isOpen.set(false)">
            Cerrar
          </app-button>
        } @else {
          <app-button
            variant="outline"
            [disabled]="submitting()"
            (clicked)="isOpen.set(false)"
          >
            Cancelar
          </app-button>
          @if (step() > 0) {
            <app-button
              variant="outline"
              [disabled]="submitting()"
              (clicked)="back()"
            >
              Atrás
            </app-button>
          }
          @if (step() < 2) {
            <app-button
              variant="primary"
              [disabled]="!canContinue()"
              (clicked)="next()"
            >
              Continuar
            </app-button>
          } @else {
            <app-button
              variant="primary"
              [disabled]="!canSubmit()"
              [loading]="submitting()"
              (clicked)="submit()"
            >
              {{
                preview()?.is_free
                  ? 'Asignar plan gratis'
                  : 'Asignar plan y registrar pago'
              }}
            </app-button>
          }
        }
      </div>
    </app-modal>
  `,
})
export class ActivatePlanModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly subscriptionAdmin = inject(SubscriptionAdminService);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly isOpen = model<boolean>(false);
  readonly storeId = input.required<number>();
  readonly storeName = input<string>('');
  readonly activated = output<ActivateStorePlanResult>();

  readonly steps = [{ label: 'Plan' }, { label: 'Pago' }, { label: 'Confirmar' }];

  // Navegacion / envio
  readonly step = signal(0);
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly result = signal<ActivateStorePlanResult | null>(null);

  // Opciones
  readonly options = signal<ActivatePlanOptions | null>(null);
  readonly optionsLoading = signal(false);
  readonly optionsError = signal<string | null>(null);
  private optionsSub: Subscription | null = null;

  // Seleccion
  readonly selectedPlanId = signal<number | null>(null);

  readonly selectedGroup = computed(() => {
    const id = this.selectedPlanId();
    if (id === null || id === undefined) return null;
    return (
      this.options()?.groups.find((g) =>
        g.cycles.some((c) => c.plan_id === id),
      ) ?? null
    );
  });
  readonly selectedCycle = computed(() => {
    const id = this.selectedPlanId();
    return this.selectedGroup()?.cycles.find((c) => c.plan_id === id) ?? null;
  });
  readonly cycleLabel = computed(() => {
    const cycle = this.selectedCycle()?.billing_cycle;
    return cycle ? (CYCLE_LABELS[cycle] ?? cycle) : '';
  });

  // Formulario
  readonly form = new FormGroup<ActivationFormControls>({
    starts_at: new FormControl(todayString(), {
      nonNullable: true,
      validators: [Validators.required, startsAtRangeValidator],
    }),
    amount: new FormControl<string | number | null>(null),
    payment_method: new FormControl('consignacion', { nonNullable: true }),
    paid_at: new FormControl(todayString(), {
      nonNullable: true,
      validators: [notFutureValidator],
    }),
    reference: new FormControl<string | null>(null, [
      Validators.maxLength(128),
    ]),
    notes: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    accept_partial_payment: new FormControl(false, { nonNullable: true }),
    confirm_received: new FormControl(false, { nonNullable: true }),
  });

  readonly minStartDate = signal(minStartString());
  readonly maxDate = signal(todayString());

  // Los FormControl no son senales: se puentea con un contador.
  private readonly formTick = signal(0);
  readonly formValue = computed(() => {
    this.formTick();
    return this.form.getRawValue();
  });

  // Preview
  readonly preview = signal<ActivatePlanPreview | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  private readonly previewNonce = signal(0);

  private readonly previewParams = computed<PreviewParams | null>(() => {
    const planId = this.selectedPlanId();
    const v = this.formValue();
    if (planId === null || planId === undefined) return null;
    if (!this.form.controls.starts_at.valid || !v.starts_at) return null;
    const params: PreviewParams = {
      plan_id: planId,
      starts_at: v.starts_at,
      nonce: this.previewNonce(),
    };
    // El monto solo viaja si el usuario lo toco: si no, el backend propone el total.
    if (this.form.controls.amount.dirty && hasValue(v.amount)) {
      params.amount = String(v.amount);
    }
    return params;
  });

  // Estado actual (chip)
  readonly currentChip = computed(() => {
    if (this.optionsLoading() && !this.options()) return 'Cargando…';
    const cur = this.options()?.current;
    if (!cur) return 'Sin plan';
    if (cur.state === 'trial') return 'Prueba';
    const label = STATE_LABELS[cur.state] ?? cur.state;
    const parts = [label];
    if (cur.plan_name) parts.push(cur.plan_name);
    if (cur.current_period_end) {
      parts.push(`vence ${formatDateOnlyUTC(cur.current_period_end)}`);
    }
    return parts.join(' · ');
  });

  // Reglas de monto (D2)
  private readonly shortfallCents = computed(() =>
    toCents(this.preview()?.shortfall),
  );

  readonly amountError = computed<string | null>(() => {
    const p = this.preview();
    if (!p || p.is_free) return null;
    const v = this.formValue();
    if (!hasValue(v.amount)) return 'Ingresa el monto recibido.';
    if (this.shortfallCents() > 0 && !v.accept_partial_payment) {
      return `El monto es menor que el total a cobrar (${this.money(
        p.invoice_total,
      )}). Falta ${this.money(p.shortfall)}.`;
    }
    return null;
  });

  readonly noteError = computed<string | null>(() => {
    const p = this.preview();
    if (!p || p.is_free) return null;
    const v = this.formValue();
    if (
      this.shortfallCents() > 0 &&
      v.accept_partial_payment &&
      !v.notes?.trim()
    ) {
      return 'Con pago parcial, las notas son obligatorias.';
    }
    return null;
  });

  readonly fieldErrors = computed<ActivationFieldErrors>(() => {
    this.formTick();
    const c = this.form.controls;
    const isFree = this.preview()?.is_free === true;
    let startsAt: string | null = null;
    if (c.starts_at.hasError('required')) startsAt = 'Requerido.';
    else if (c.starts_at.hasError('minDate')) {
      startsAt = `La fecha no puede ser anterior a ${START_WINDOW_DAYS} días.`;
    } else if (c.starts_at.hasError('maxDate')) {
      startsAt = 'La fecha no puede ser futura.';
    }
    let notes: string | null = null;
    if (c.notes.hasError('maxlength')) notes = 'Máximo 500 caracteres.';
    else notes = this.noteError();
    return {
      startsAt,
      amount: this.amountError(),
      paidAt:
        !isFree && c.paid_at.hasError('maxDate')
          ? 'La fecha de pago no puede ser futura.'
          : null,
      reference: c.reference.hasError('maxlength')
        ? 'Máximo 128 caracteres.'
        : null,
      notes,
    };
  });

  // Validez por paso
  readonly canContinue = computed(() => {
    if (this.step() === 0) {
      return (
        !this.optionsLoading() &&
        !this.optionsError() &&
        this.selectedCycle()?.state === 'active'
      );
    }
    return this.step1Valid();
  });

  private readonly step1Valid = computed(() => {
    this.formTick();
    const p = this.preview();
    if (!p || this.previewLoading() || this.previewError()) return false;
    const c = this.form.controls;
    if (!c.starts_at.valid || !c.notes.valid) return false;
    if (p.is_free) return true;
    const v = this.formValue();
    return (
      c.paid_at.valid &&
      hasValue(v.paid_at) &&
      !!v.payment_method &&
      c.reference.valid &&
      hasValue(v.amount) &&
      !this.amountError() &&
      !this.noteError()
    );
  });

  readonly canSubmit = computed(() => {
    const p = this.preview();
    if (this.submitting() || !p || this.previewLoading()) return false;
    if (this.previewError() || !this.step1Valid()) return false;
    if (!p.is_free && !this.formValue().confirm_received) return false;
    return true;
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.bumpForm());

    // Preview con debounce y cancelacion de la consulta previa.
    toObservable(this.previewParams)
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((params) => {
          this.previewError.set(null);
          this.previewLoading.set(params !== null);
          if (params === null) this.preview.set(null);
        }),
        debounceTime(PREVIEW_DEBOUNCE_MS),
        switchMap((params) => {
          if (params === null) return of(null);
          const { nonce: _nonce, ...req } = params;
          return this.subscriptionAdmin
            .previewActivatePlan(this.storeId(), req)
            .pipe(
              map((data) => ({ data, error: null as string | null })),
              catchError((err) =>
                of({
                  data: null as ActivatePlanPreview | null,
                  error: extractApiErrorMessage(err),
                }),
              ),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome) => {
        if (!outcome) {
          this.previewLoading.set(false);
          return;
        }
        this.previewLoading.set(false);
        if (outcome.error !== null || !outcome.data) {
          this.preview.set(null);
          this.previewError.set(
            outcome.error ?? 'No se pudo calcular la previsualización.',
          );
          return;
        }
        this.preview.set(outcome.data);
        this.applyDefaultAmount(outcome.data);
      });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.resetAll();
          this.loadOptions();
        });
      } else {
        untracked(() => this.optionsSub?.unsubscribe());
      }
    });
  }

  loadOptions(): void {
    this.optionsSub?.unsubscribe();
    this.optionsLoading.set(true);
    this.optionsError.set(null);
    this.optionsSub = this.subscriptionAdmin
      .getActivatePlanOptions(this.storeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.options.set(data);
          this.optionsLoading.set(false);
        },
        error: (err) => {
          this.optionsError.set(extractApiErrorMessage(err));
          this.optionsLoading.set(false);
        },
      });
  }

  retryPreview(): void {
    this.previewNonce.update((n) => n + 1);
  }

  next(): void {
    if (!this.canContinue()) return;
    this.step.update((s) => Math.min(2, s + 1));
  }

  back(): void {
    if (this.submitting()) return;
    this.submitError.set(null);
    this.step.update((s) => Math.max(0, s - 1));
  }

  submit(): void {
    if (this.submitting()) return;
    const p = this.preview();
    const planId = this.selectedPlanId();
    if (!p || planId === null || !this.canSubmit()) return;

    const v = this.form.getRawValue();
    const body: ActivateStorePlanDto = {
      plan_id: planId,
      starts_at: v.starts_at,
    };
    if (!p.is_free) {
      body.amount = String(v.amount);
      body.payment_method = v.payment_method;
      body.paid_at = v.paid_at;
      const ref = v.reference?.trim();
      if (ref) body.reference = ref;
      if (v.accept_partial_payment && this.shortfallCents() > 0) {
        body.accept_partial_payment = true;
      }
    }
    const notes = v.notes?.trim();
    if (notes) body.notes = notes;

    this.submitting.set(true);
    this.submitError.set(null);
    this.subscriptionAdmin
      .activateStorePlan(this.storeId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res.data;
          this.submitting.set(false);
          this.result.set(data);
          this.activated.emit(data);
        },
        error: (err) => {
          this.submitting.set(false);
          this.submitError.set(extractApiErrorMessage(err));
        },
      });
  }

  money(value: string | number | null | undefined): string {
    return this.currencyFormat.format(value);
  }

  private bumpForm(): void {
    this.formTick.update((n) => n + 1);
  }

  /** Con el monto sin tocar, se propone el total de la factura. */
  private applyDefaultAmount(p: ActivatePlanPreview): void {
    const amount = this.form.controls.amount;
    if (p.is_free || !amount.pristine) return;
    amount.setValue(p.invoice_total, { emitEvent: false });
    this.bumpForm();
  }

  private resetAll(): void {
    this.step.set(0);
    this.submitting.set(false);
    this.submitError.set(null);
    this.result.set(null);
    this.options.set(null);
    this.optionsError.set(null);
    this.selectedPlanId.set(null);
    this.preview.set(null);
    this.previewError.set(null);
    this.previewLoading.set(false);
    this.minStartDate.set(minStartString());
    this.maxDate.set(todayString());
    this.form.reset({
      starts_at: todayString(),
      amount: null,
      payment_method: 'consignacion',
      paid_at: todayString(),
      reference: null,
      notes: null,
      accept_partial_payment: false,
      confirm_received: false,
    });
    this.bumpForm();
  }
}

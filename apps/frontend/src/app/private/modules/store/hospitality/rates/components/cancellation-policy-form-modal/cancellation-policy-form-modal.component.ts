import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  CancellationPolicy,
  CancellationPolicyPayload,
  describePolicy,
  PenaltyType,
} from '../../interfaces/rate-plan.interface';
import { CancellationPoliciesService } from '../../services/cancellation-policies.service';

interface RuleForm {
  hours_before: FormControl<number>;
  penalty_type: FormControl<PenaltyType>;
  penalty_value: FormControl<number>;
}

/** `none` = a no-show is not charged. */
type NoShowType = PenaltyType | 'none';

interface PolicyForm {
  name: FormControl<string>;
  rules: FormArray<FormGroup<RuleForm>>;
  no_show_type: FormControl<NoShowType>;
  no_show_value: FormControl<number>;
  is_active: FormControl<boolean>;
}

const PENALTY_OPTIONS: SelectorOption[] = [
  { value: 'nights', label: 'Noches' },
  { value: 'percent', label: '% de la estadía' },
];

/**
 * Hospitality Suite (H2.4) — create or edit a cancellation policy ("Flexible:
 * gratis hasta 48 h, luego 1 noche"). Each window charges when the guest
 * cancels less than N hours before check-in; the narrowest window wins. Sold
 * reservations keep the policy they were booked with.
 */
@Component({
  selector: 'app-cancellation-policy-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="reset()"
      [size]="'md'"
      [dialog]="true"
      [title]="policy() ? 'Editar política' : 'Nueva política de cancelación'"
      subtitle="Lo que pierde el huésped si cancela o no llega"
    >
      <form [formGroup]="form" class="space-y-4">
        <app-input
          formControlName="name"
          label="Nombre"
          type="text"
          placeholder="Ej. Flexible"
          [required]="true"
          customWrapperClass="mt-0"
        />

        <div class="space-y-2" formArrayName="rules">
          <p class="text-sm font-medium text-text-primary">Penalidad por cancelar</p>
          @for (rule of form.controls.rules.controls; track rule; let i = $index) {
            <div
              [formGroupName]="i"
              class="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"
              data-testid="policy-rule-row"
            >
              <app-input
                formControlName="hours_before"
                label="Menos de (h antes)"
                type="number"
                [min]="0"
                customWrapperClass="mt-0"
              />
              <app-selector formControlName="penalty_type" label="Cobra" [options]="penaltyOptions" />
              <app-input
                formControlName="penalty_value"
                label="Cantidad"
                type="number"
                [min]="0"
                customWrapperClass="mt-0"
              />
              <app-button
                variant="ghost"
                size="sm"
                [attr.aria-label]="'Quitar penalidad ' + (i + 1)"
                (clicked)="removeRule(i)"
              >
                <app-icon slot="icon" name="trash-2" [size]="16" />
              </app-button>
            </div>
          } @empty {
            <p class="text-sm text-text-secondary">Sin penalidades: se cancela gratis.</p>
          }
          <app-button variant="outline" size="sm" (clicked)="addRule()">
            <app-icon slot="icon" name="plus" [size]="14" />
            Agregar penalidad
          </app-button>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <app-selector
            formControlName="no_show_type"
            label="Si no llega (no-show)"
            [options]="noShowOptions"
          />
          @if (noShowType() !== 'none') {
            <app-input
              formControlName="no_show_value"
              label="Cantidad"
              type="number"
              [min]="0"
              customWrapperClass="mt-0"
            />
          }
        </div>

        <app-toggle formControlName="is_active" label="Activa" />
        <p class="text-sm text-text-secondary" data-testid="policy-summary">{{ summary() }}</p>
        @if (error()) {
          <p class="text-sm text-error">{{ error() }}</p>
        }
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" (clicked)="onSubmit()">
          <app-icon slot="icon" name="save" [size]="16" />
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CancellationPolicyFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly policiesService = inject(CancellationPoliciesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  /** Policy to edit; null creates a new one. */
  readonly policy = input<CancellationPolicy | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<CancellationPolicy>();

  readonly saving = signal(false);
  readonly error = signal('');
  readonly summary = signal('');
  readonly noShowType = signal<NoShowType>('none');
  readonly penaltyOptions = PENALTY_OPTIONS;
  readonly noShowOptions: SelectorOption[] = [
    { value: 'none', label: 'Sin penalidad' },
    ...PENALTY_OPTIONS,
  ];

  readonly form: FormGroup<PolicyForm> = this.fb.group<PolicyForm>({
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    rules: this.fb.array<FormGroup<RuleForm>>([]),
    no_show_type: this.fb.nonNullable.control<NoShowType>('none'),
    no_show_value: this.fb.nonNullable.control(100, { validators: [Validators.min(0)] }),
    is_active: this.fb.nonNullable.control(true),
  });

  constructor() {
    // Keep the readable summary and the no-show field in sync with the form.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.noShowType.set(this.form.controls.no_show_type.value);
      this.summary.set(describePolicy(this.toPayload()));
    });
  }

  reset(): void {
    const policy = this.policy();
    this.form.controls.rules.clear({ emitEvent: false });
    // A new policy starts as "gratis hasta 48 h, luego 1 noche".
    const rules = policy?.rules ?? [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }];
    for (const rule of rules) this.form.controls.rules.push(this.ruleGroup(rule), { emitEvent: false });
    this.form.patchValue({
      name: policy?.name ?? '',
      no_show_type: policy ? (policy.no_show_penalty?.penalty_type ?? 'none') : 'percent',
      no_show_value: policy?.no_show_penalty?.penalty_value ?? 100,
      is_active: policy?.is_active ?? true,
    });
    this.error.set('');
  }

  addRule(): void {
    this.form.controls.rules.push(
      this.ruleGroup({ hours_before: 24, penalty_type: 'percent', penalty_value: 100 }),
    );
  }

  removeRule(index: number): void {
    this.form.controls.rules.removeAt(index);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const payload = this.toPayload();
    const problem = validationError(payload);
    this.error.set(problem);
    if (this.form.invalid || problem) return;

    const policy = this.policy();
    const request = policy
      ? this.policiesService.update(policy.id, payload)
      : this.policiesService.create(payload);
    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toastService.success(policy ? 'Política actualizada' : 'Política creada');
        this.saved.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar la política',
        );
      },
    });
  }

  private ruleGroup(rule: { hours_before: number; penalty_type: PenaltyType; penalty_value: number }) {
    return this.fb.group<RuleForm>({
      hours_before: this.fb.nonNullable.control(rule.hours_before, {
        validators: [Validators.required, Validators.min(0), Validators.max(8760)],
      }),
      penalty_type: this.fb.nonNullable.control<PenaltyType>(rule.penalty_type),
      penalty_value: this.fb.nonNullable.control(rule.penalty_value, {
        validators: [Validators.required, Validators.min(0)],
      }),
    });
  }

  private toPayload(): CancellationPolicyPayload {
    const raw = this.form.getRawValue();
    return {
      name: raw.name.trim(),
      rules: raw.rules.map((rule) => ({
        hours_before: Number(rule.hours_before),
        penalty_type: rule.penalty_type,
        penalty_value: Number(rule.penalty_value),
      })),
      no_show_penalty:
        raw.no_show_type === 'none'
          ? null
          : { penalty_type: raw.no_show_type, penalty_value: Number(raw.no_show_value) },
      is_active: raw.is_active,
    };
  }
}

/** Same limits as the API: one rule per window, 1-30 whole nights or up to 100 %. */
function validationError(payload: CancellationPolicyPayload): string {
  const terms = [...payload.rules, ...(payload.no_show_penalty ? [payload.no_show_penalty] : [])];
  const badTerm = terms.some((term) =>
    term.penalty_type === 'nights'
      ? !Number.isInteger(term.penalty_value) || term.penalty_value < 1 || term.penalty_value > 30
      : term.penalty_value < 0 || term.penalty_value > 100,
  );
  if (badTerm) return 'Usa de 1 a 30 noches enteras o un porcentaje de 0 a 100.';
  const windows = payload.rules.map((rule) => rule.hours_before);
  if (new Set(windows).size !== windows.length) return 'Hay dos penalidades con las mismas horas.';
  return '';
}

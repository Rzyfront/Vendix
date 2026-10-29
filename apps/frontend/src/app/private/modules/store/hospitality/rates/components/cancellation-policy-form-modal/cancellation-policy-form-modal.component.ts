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
  PenaltyTerm,
  PenaltyType,
} from '../../interfaces/rate-plan.interface';
import { CancellationPoliciesService } from '../../services/cancellation-policies.service';

interface RuleForm {
  hours_before: FormControl<number>;
  penalty_type: FormControl<PenaltyType>;
  penalty_value: FormControl<number>;
}

/** `none` = a guest who does not show up (no-show) is not charged. */
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
      <form
        [formGroup]="form"
        id="policy-form"
        class="space-y-4"
        novalidate
        (ngSubmit)="onSubmit()"
      >
        <app-input
          formControlName="name"
          label="Nombre"
          type="text"
          placeholder="Ej. Flexible"
          [required]="true"
          [control]="form.controls.name"
          customWrapperClass="mt-0"
        />

        <div class="space-y-2" formArrayName="rules">
          <p class="text-sm font-medium text-text-primary">Penalidad por cancelar</p>
          @for (rule of form.controls.rules.controls; track rule; let i = $index) {
            <div
              [formGroupName]="i"
              class="grid grid-cols-[1fr_1fr_auto] items-start gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              data-testid="policy-rule-row"
            >
              <app-input
                class="col-span-3 sm:col-span-1"
                formControlName="hours_before"
                label="Horas antes de la llegada"
                type="number"
                [min]="0"
                helperText="Si cancela con menos horas"
                [control]="rule.controls.hours_before"
                [error]="ruleErrors()[i]?.hours ?? ''"
                customWrapperClass="mt-0"
              />
              <app-selector formControlName="penalty_type" label="Cobra" [options]="penaltyOptions" />
              <app-input
                formControlName="penalty_value"
                label="Cantidad"
                type="number"
                [min]="0"
                [control]="rule.controls.penalty_value"
                [error]="ruleErrors()[i]?.value ?? ''"
                customWrapperClass="mt-0"
              />
              <app-button
                variant="ghost"
                size="sm"
                customClasses="!h-11 !w-11 !px-0 mt-6"
                [ariaLabel]="'Quitar penalidad ' + (i + 1)"
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

        <div class="grid grid-cols-2 items-start gap-2">
          <app-selector
            formControlName="no_show_type"
            label="Si no se presenta"
            [options]="noShowOptions"
          />
          @if (noShowType() !== 'none') {
            <app-input
              formControlName="no_show_value"
              label="Cantidad"
              type="number"
              [min]="0"
              [control]="form.controls.no_show_value"
              [error]="noShowError()"
              customWrapperClass="mt-0"
            />
          }
        </div>

        <app-toggle formControlName="is_active" label="Activa" />
        <p class="text-sm text-text-secondary" data-testid="policy-summary">{{ summary() }}</p>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button type="submit" form="policy-form" variant="primary" [loading]="saving()">
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
  /** Per-row errors ("Hay otra penalidad con las mismas horas"), shown after a submit attempt. */
  readonly ruleErrors = signal<RuleErrors[]>([]);
  readonly noShowError = signal('');
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
    this.ruleErrors.set([]);
    this.noShowError.set('');
  }

  addRule(): void {
    this.form.controls.rules.push(
      this.ruleGroup({ hours_before: 24, penalty_type: 'percent', penalty_value: 100 }),
    );
  }

  removeRule(index: number): void {
    this.form.controls.rules.removeAt(index);
    this.ruleErrors.update((errors) => errors.filter((_, i) => i !== index));
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const payload = this.toPayload();
    const problems = policyErrors(payload);
    this.ruleErrors.set(problems.rules);
    this.noShowError.set(problems.noShow);
    const hasProblem = !!problems.noShow || problems.rules.some((r) => r.hours || r.value);
    if (this.form.invalid || hasProblem) return;

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

/** Error under each field of a penalty row; empty when it is fine. */
interface RuleErrors {
  hours: string;
  value: string;
}

/** Same limits as the API: 1-30 whole nights or up to 100 %. */
function termError(term: PenaltyTerm): string {
  if (term.penalty_type === 'nights') {
    const value = term.penalty_value;
    return Number.isInteger(value) && value >= 1 && value <= 30
      ? ''
      : 'Usa de 1 a 30 noches enteras';
  }
  return term.penalty_value >= 0 && term.penalty_value <= 100 ? '' : 'Usa de 0 a 100 %';
}

/** Same limits as the API, placed under the field they belong to; one rule per window. */
function policyErrors(payload: CancellationPolicyPayload): { rules: RuleErrors[]; noShow: string } {
  const windows = payload.rules.map((rule) => rule.hours_before);
  return {
    rules: payload.rules.map((rule, index) => ({
      hours:
        windows.indexOf(rule.hours_before) !== index
          ? 'Hay otra penalidad con las mismas horas'
          : '',
      value: termError(rule),
    })),
    noShow: payload.no_show_penalty ? termError(payload.no_show_penalty) : '',
  };
}

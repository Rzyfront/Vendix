import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyInputDirective } from '../../../../../../../shared/directives/currency-input.directive';

import { CreateGymPlanDto, GymPlan, UpdateGymPlanDto } from '../../interfaces';
import { GymPlansService } from '../../services';

interface PlanFormShape {
  code: FormControl<string>;
  name: FormControl<string>;
  description: FormControl<string>;
  price: FormControl<number | null>;
  currency: FormControl<string>;
  duration_days: FormControl<number | null>;
  access_limit_per_period: FormControl<number | null>;
  class_limit_per_period: FormControl<number | null>;
  sort_order: FormControl<number | null>;
  is_active: FormControl<boolean>;
  benefits: FormControl<string>;
}

@Component({
  selector: 'app-gym-plan-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
    TextareaComponent,
    IconComponent,
    CurrencyInputDirective,
  ],
  templateUrl: './plan-form-page.component.html',
})
export class GymPlanFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly plansService = inject(GymPlansService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isEditMode = signal(false);
  readonly planId = signal<number | null>(null);
  readonly isLoadingPlan = signal(false);
  readonly isSubmitting = signal(false);

  readonly currencyOptions: SelectorOption[] = [
    { value: 'COP', label: 'COP — Peso colombiano' },
    { value: 'USD', label: 'USD — Dólar' },
    { value: 'EUR', label: 'EUR — Euro' },
    { value: 'MXN', label: 'MXN — Peso mexicano' },
  ];

  readonly form: FormGroup<PlanFormShape> = this.fb.nonNullable.group<PlanFormShape>({
    code: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(160)],
    }),
    description: this.fb.nonNullable.control(''),
    price: this.fb.nonNullable.control<number | null>(0, {
      validators: [Validators.min(0)],
    }),
    currency: this.fb.nonNullable.control('COP', {
      validators: [Validators.required],
    }),
    duration_days: this.fb.nonNullable.control<number | null>(30, {
      validators: [Validators.required, Validators.min(1)],
    }),
    access_limit_per_period: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.min(0)],
    }),
    class_limit_per_period: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.min(0)],
    }),
    sort_order: this.fb.nonNullable.control<number | null>(0, {
      validators: [Validators.min(0)],
    }),
    is_active: this.fb.nonNullable.control(true),
    benefits: this.fb.nonNullable.control(''),
  });

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const invalid = this.formStatus() !== 'VALID' || this.isLoadingPlan();
    return [
      {
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline',
        disabled: this.isSubmitting(),
      },
      {
        id: 'save',
        label: this.isEditMode() ? 'Guardar cambios' : 'Crear plan',
        icon: this.isEditMode() ? 'save' : 'plus',
        variant: 'primary',
        loading: this.isSubmitting(),
        disabled: invalid || this.isSubmitting(),
      },
    ];
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.planId.set(Number(id));
      this.loadPlan(Number(id));
    }
  }

  private loadPlan(id: number): void {
    this.isLoadingPlan.set(true);
    this.plansService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plan: GymPlan) => {
          this.form.patchValue({
            code: plan.code ?? '',
            name: plan.name ?? '',
            description: plan.description ?? '',
            price: Number(plan.price ?? 0),
            currency: plan.currency ?? 'COP',
            duration_days: plan.duration_days ?? 30,
            access_limit_per_period: plan.access_limit_per_period ?? null,
            class_limit_per_period: plan.class_limit_per_period ?? null,
            sort_order: plan.sort_order ?? 0,
            is_active: plan.is_active ?? true,
            benefits: this.benefitsToText(plan.features),
          });
          this.isLoadingPlan.set(false);
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo cargar el plan',
          );
          this.isLoadingPlan.set(false);
          this.router.navigate(['/admin/gym-ops/plans']);
        },
      });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') this.router.navigate(['/admin/gym-ops/plans']);
    else if (actionId === 'save') this.submit();
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toastService.warning('Revisa los campos marcados antes de guardar');
      return;
    }

    const raw = this.form.getRawValue();
    const base: CreateGymPlanDto = {
      code: raw.code.trim(),
      name: raw.name.trim(),
      description: raw.description?.trim() || undefined,
      price: Number(raw.price ?? 0),
      currency: raw.currency,
      duration_days: Number(raw.duration_days ?? 30),
      access_limit_per_period:
        raw.access_limit_per_period == null
          ? undefined
          : Number(raw.access_limit_per_period),
      class_limit_per_period:
        raw.class_limit_per_period == null
          ? undefined
          : Number(raw.class_limit_per_period),
      sort_order: Number(raw.sort_order ?? 0),
      is_active: raw.is_active,
      features: this.textToBenefits(raw.benefits),
    };

    this.isSubmitting.set(true);
    const request$ = this.isEditMode()
      ? this.plansService.update(this.planId() as number, base as UpdateGymPlanDto)
      : this.plansService.create(base);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.toastService.success(
          this.isEditMode()
            ? 'Plan actualizado correctamente'
            : 'Plan creado correctamente',
        );
        this.router.navigate(['/admin/gym-ops/plans']);
      },
      error: (err: unknown) => {
        this.isSubmitting.set(false);
        this.toastService.error(
          typeof err === 'string'
            ? err
            : this.isEditMode()
              ? 'Error al actualizar el plan'
              : 'Error al crear el plan',
        );
      },
    });
  }

  /** Convert stored `features.benefits` (string[]) into a newline textarea value. */
  private benefitsToText(features: GymPlan['features']): string {
    const benefits = (features as { benefits?: unknown } | null)?.benefits;
    if (Array.isArray(benefits)) {
      return benefits.map((b) => String(b)).join('\n');
    }
    return '';
  }

  /** Convert the newline textarea into `{ benefits: string[] }` or undefined. */
  private textToBenefits(text: string): Record<string, unknown> | undefined {
    const lines = (text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return lines.length > 0 ? { benefits: lines } : undefined;
  }
}

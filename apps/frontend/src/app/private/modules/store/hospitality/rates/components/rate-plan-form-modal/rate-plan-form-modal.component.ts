import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
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
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import {
  CancellationPolicy,
  describePolicy,
  MEAL_PLAN_LABELS,
  MealPlan,
  RatePlan,
  RatePlanPayload,
  Season,
  seasonRange,
  WEEKDAYS,
} from '../../interfaces/rate-plan.interface';
import { RatePlansService } from '../../services/rate-plans.service';

interface PriceRowForm {
  unit_type_id: FormControl<number>;
  /** Nightly price of every night; empty = the plan does not sell the type. */
  base: FormControl<number | null>;
  /** Weekday overrides in `WEEKDAYS` order; empty = base price. */
  days: FormArray<FormControl<number | null>>;
  /** H2.2: nightly price in each season of `seasonColumns`; empty = regular price. */
  seasons: FormArray<FormControl<number | null>>;
}

interface RatePlanForm {
  name: FormControl<string>;
  code: FormControl<string>;
  meal_plan: FormControl<MealPlan>;
  is_default: FormControl<boolean>;
  is_active: FormControl<boolean>;
  /** H2.4 — 0 = no policy (free cancellation). */
  cancellation_policy_id: FormControl<number>;
  deposit_percent: FormControl<number>;
  prices: FormArray<FormGroup<PriceRowForm>>;
}

const hasValue = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && `${value}` !== '';

/**
 * Hospitality Suite (H2.1, H2.2) — create or edit a rate plan ("Con desayuno")
 * with a nightly base price per room type, optional weekday prices (e.g.
 * Friday and Saturday higher) and a price per season (e.g. "Alta" $400.000).
 * A type without base price is not offered with the plan when booking.
 */
@Component({
  selector: 'app-rate-plan-form-modal',
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
      [size]="'lg'"
      [dialog]="true"
      [title]="plan() ? 'Editar plan tarifario' : 'Nuevo plan tarifario'"
      subtitle="Precio por noche de cada tipo de habitación y por día de la semana"
    >
      <form [formGroup]="form" class="space-y-4">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <app-input
            formControlName="name"
            label="Nombre"
            type="text"
            placeholder="Ej. Con desayuno"
            [required]="true"
            customWrapperClass="mt-0"
          />
          <app-selector
            formControlName="meal_plan"
            label="Régimen"
            [options]="mealPlanOptions"
          />
          <app-input
            formControlName="code"
            label="Código"
            type="text"
            placeholder="Opcional, ej. BB"
            customWrapperClass="mt-0"
          />
          <div class="flex flex-col justify-center gap-2">
            <app-toggle formControlName="is_default" label="Preseleccionar al reservar" />
            <app-toggle formControlName="is_active" label="Activo" />
          </div>
          <app-selector
            formControlName="cancellation_policy_id"
            label="Política de cancelación"
            [options]="policyOptions()"
            [helpText]="policyHelp()"
          />
          <app-input
            formControlName="deposit_percent"
            label="Depósito exigido (% de la estadía)"
            type="number"
            [min]="0"
            [max]="100"
            helperText="0 = sin depósito. Se muestra como “Depósito pendiente” en la reserva."
            customWrapperClass="mt-0"
          />
        </div>

        <div class="space-y-3" formArrayName="prices">
          <p class="text-sm text-text-secondary">
            Precios antes de impuestos. Deja vacío el precio base de un tipo para no ofrecer el
            plan con ese tipo; un día vacío usa el precio base. En una temporada, las noches
            toman su precio de temporada; vacío = precio normal.
          </p>
          @for (row of form.controls.prices.controls; track row; let i = $index) {
            <div
              [formGroupName]="i"
              class="space-y-2 rounded-lg border border-border p-3"
              data-testid="rate-plan-type-row"
            >
              <app-input
                formControlName="base"
                [label]="typeName(row.controls.unit_type_id.value) + ' — precio base por noche'"
                [currency]="true"
                [control]="row.controls.base"
                [error]="missingBase(i) ? 'Falta el precio base' : ''"
                placeholder="Sin precio"
                customWrapperClass="mt-0"
              />
              <div class="grid grid-cols-4 gap-2 md:grid-cols-7" formArrayName="days">
                @for (day of weekdays; track day.value; let d = $index) {
                  <app-input
                    [formControlName]="d"
                    [label]="day.short"
                    [currency]="true"
                    [control]="row.controls.days.at(d)"
                    placeholder="Base"
                    customWrapperClass="mt-0"
                  />
                }
              </div>
              @if (seasonColumns().length) {
                <div class="grid grid-cols-2 gap-2 md:grid-cols-3" formArrayName="seasons">
                  @for (season of seasonColumns(); track season.id; let s = $index) {
                    <app-input
                      [formControlName]="s"
                      [label]="'Temporada ' + season.name + ' (' + season.range + ')'"
                      [currency]="true"
                      [control]="row.controls.seasons.at(s)"
                      [error]="seasonWithoutBase(i, s) ? 'Falta el precio base' : ''"
                      placeholder="Precio normal"
                      customWrapperClass="mt-0"
                      data-testid="rate-plan-season-price"
                    />
                  }
                </div>
              }
            </div>
          } @empty {
            <p class="text-sm text-text-secondary">
              Crea primero los tipos de habitación en Hotelería → Habitaciones.
            </p>
          }
        </div>
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
export class RatePlanFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly ratePlansService = inject(RatePlansService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  /** Plan to edit; null creates a new one. */
  readonly plan = input<RatePlan | null>(null);
  readonly unitTypes = input<UnitType[]>([]);
  /** Whether the store already has a default plan (a new one starts as default otherwise). */
  readonly hasDefault = input(false);
  /** H2.2: store seasons; active ones (and those the plan prices) get a price column. */
  readonly seasons = input<Season[]>([]);
  /** H2.4: store cancellation policies; active ones (and the plan's) can be picked. */
  readonly policies = input<CancellationPolicy[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<RatePlan>();

  readonly saving = signal(false);
  /** Set after a submit attempt, so row errors show only then. */
  readonly submitted = signal(false);
  readonly weekdays = WEEKDAYS;
  readonly mealPlanOptions: SelectorOption[] = Object.entries(MEAL_PLAN_LABELS).map(
    ([value, label]) => ({ value, label }),
  );
  readonly policyOptions = computed<SelectorOption[]>(() => [
    { value: 0, label: 'Sin política (cancelación gratis)' },
    ...this.policies()
      .filter((p) => p.is_active || p.id === this.plan()?.cancellation_policy_id)
      .map((p) => ({ value: p.id, label: p.is_active ? p.name : `${p.name} (inactiva)` })),
  ]);
  /** Selected policy id, mirrored as a signal for the help text. */
  readonly selectedPolicyId = signal(0);
  readonly policyHelp = computed(() => {
    const policy = this.policies().find((p) => p.id === this.selectedPolicyId());
    return policy ? describePolicy(policy) : 'Las reservas con este plan se cancelan sin penalidad.';
  });
  /** Seasons shown as columns, fixed when the modal opens (`reset`). */
  readonly seasonColumns = signal<{ id: number; name: string; range: string }[]>([]);
  private readonly typeNames = computed(
    () => new Map(this.unitTypes().map((t) => [t.id, t.name] as const)),
  );

  readonly form: FormGroup<RatePlanForm> = this.fb.group<RatePlanForm>({
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    code: this.fb.nonNullable.control('', { validators: [Validators.maxLength(30)] }),
    meal_plan: this.fb.nonNullable.control<MealPlan>('room_only'),
    is_default: this.fb.nonNullable.control(false),
    is_active: this.fb.nonNullable.control(true),
    cancellation_policy_id: this.fb.nonNullable.control(0),
    deposit_percent: this.fb.nonNullable.control(0, {
      validators: [Validators.required, Validators.min(0), Validators.max(100)],
    }),
    prices: this.fb.array<FormGroup<PriceRowForm>>([]),
  });

  constructor() {
    this.form.controls.cancellation_policy_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => this.selectedPolicyId.set(Number(id) || 0));
  }

  /** One price row per active type, plus inactive types the plan prices. */
  reset(): void {
    const plan = this.plan();
    const priced = new Set(plan?.prices.map((p) => p.unit_type_id) ?? []);
    const pricedSeasons = new Set(plan?.prices.map((p) => p.season_id) ?? []);
    const columns = this.seasons()
      .filter((season) => season.is_active || pricedSeasons.has(season.id))
      .map((season) => ({
        id: season.id,
        name: season.name,
        range: seasonRange(season),
      }));
    this.seasonColumns.set(columns);
    const rows = this.form.controls.prices;
    rows.clear();
    for (const type of this.unitTypes()) {
      if (!type.is_active && !priced.has(type.id)) continue;
      const prices = plan?.prices.filter((p) => p.unit_type_id === type.id) ?? [];
      const priceOf = (day: number | null, season: number | null = null) => {
        const row = prices.find((p) => p.day_of_week === day && (p.season_id ?? null) === season);
        return row ? Number(row.price) : null;
      };
      rows.push(
        this.fb.group<PriceRowForm>({
          unit_type_id: this.fb.nonNullable.control(type.id),
          base: this.fb.control<number | null>(priceOf(null), {
            validators: [Validators.min(0)],
          }),
          days: this.fb.array(
            WEEKDAYS.map((day) =>
              this.fb.control<number | null>(priceOf(day.value), {
                validators: [Validators.min(0)],
              }),
            ),
          ),
          seasons: this.fb.array(
            columns.map((season) =>
              this.fb.control<number | null>(priceOf(null, season.id), {
                validators: [Validators.min(0)],
              }),
            ),
          ),
        }),
      );
    }
    this.form.patchValue({
      name: plan?.name ?? '',
      code: plan?.code ?? '',
      meal_plan: plan?.meal_plan ?? 'room_only',
      is_default: plan?.is_default ?? !this.hasDefault(),
      is_active: plan?.is_active ?? true,
      cancellation_policy_id: plan?.cancellation_policy_id ?? 0,
      deposit_percent: Number(plan?.deposit_percent ?? 0),
    });
    this.submitted.set(false);
  }

  typeName(id: number): string {
    return this.typeNames().get(id) ?? `Tipo ${id}`;
  }

  /** A weekday price without base price cannot be saved. */
  missingBase(index: number): boolean {
    if (!this.submitted()) return false;
    const row = this.form.controls.prices.at(index).getRawValue();
    return !hasValue(row.base) && row.days.some(hasValue);
  }

  /** A season price needs the regular base price of the type. */
  seasonWithoutBase(index: number, season: number): boolean {
    if (!this.submitted()) return false;
    const row = this.form.controls.prices.at(index).getRawValue();
    return !hasValue(row.base) && hasValue(row.seasons[season]);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const rows = this.form.controls.prices.controls;
    const seasonGaps = rows.some((row, i) =>
      row.controls.seasons.controls.some((_, s) => this.seasonWithoutBase(i, s)),
    );
    if (this.form.invalid || seasonGaps || rows.some((_, i) => this.missingBase(i))) return;
    const columns = this.seasonColumns();
    // Season weekday prices are API-only; keep them while their season keeps a price.
    const seasonDays = (this.plan()?.prices ?? []).filter(
      (p) => p.season_id !== null && p.day_of_week !== null,
    );

    const raw = this.form.getRawValue();
    const payload: RatePlanPayload = {
      name: raw.name.trim(),
      code: raw.code.trim() || undefined,
      meal_plan: raw.meal_plan,
      cancellation_policy_id: Number(raw.cancellation_policy_id) || null,
      deposit_percent: Number(raw.deposit_percent),
      is_default: raw.is_default,
      is_active: raw.is_active,
      prices: raw.prices.flatMap((row) => {
        if (!hasValue(row.base)) return [];
        return [
          { unit_type_id: row.unit_type_id, price: Number(row.base) },
          ...WEEKDAYS.flatMap((day, d) => {
            const price = row.days[d];
            return hasValue(price)
              ? [{ unit_type_id: row.unit_type_id, day_of_week: day.value, price: Number(price) }]
              : [];
          }),
          ...columns.flatMap((season, s) => {
            const price = row.seasons[s];
            if (!hasValue(price)) return [];
            return [
              { unit_type_id: row.unit_type_id, season_id: season.id, price: Number(price) },
              ...seasonDays
                .filter((p) => p.unit_type_id === row.unit_type_id && p.season_id === season.id)
                .map((p) => ({
                  unit_type_id: p.unit_type_id,
                  season_id: season.id,
                  day_of_week: p.day_of_week as number,
                  price: Number(p.price),
                })),
            ];
          }),
        ];
      }),
    };
    const plan = this.plan();
    const request = plan
      ? this.ratePlansService.update(plan.id, payload)
      : this.ratePlansService.create(payload);

    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toastService.success(plan ? 'Plan tarifario actualizado' : 'Plan tarifario creado');
        this.saved.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar el plan tarifario',
        );
      },
    });
  }
}

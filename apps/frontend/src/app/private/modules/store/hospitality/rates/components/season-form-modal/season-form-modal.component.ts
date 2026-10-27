import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
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
  IconComponent,
  InputComponent,
  ModalComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { Season, SeasonPayload, seasonDate } from '../../interfaces/rate-plan.interface';
import { SeasonsService } from '../../services/seasons.service';

interface SeasonForm {
  name: FormControl<string>;
  from_date: FormControl<string>;
  to_date: FormControl<string>;
  priority: FormControl<number>;
  color: FormControl<string>;
  is_active: FormControl<boolean>;
}

/** Calendar colors offered for a season (any #RRGGBB is valid in the API). */
export const SEASON_COLORS = [
  '#DC2626',
  '#F59E0B',
  '#16A34A',
  '#0EA5E9',
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#64748B',
] as const;

/**
 * Hospitality Suite (H2.2) — create or edit a demand season ("Alta: 15-dic al
 * 15-ene"). Its prices are set per room type in each rate plan; the priority
 * decides which season wins when two overlap.
 */
@Component({
  selector: 'app-season-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
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
      [title]="season() ? 'Editar temporada' : 'Nueva temporada'"
      subtitle="Fechas con precio propio en cada plan tarifario"
    >
      <form [formGroup]="form" class="space-y-4">
        <app-input
          formControlName="name"
          label="Nombre"
          type="text"
          placeholder="Ej. Alta"
          [required]="true"
          customWrapperClass="mt-0"
        />
        <div class="grid grid-cols-2 gap-3">
          <app-input
            formControlName="from_date"
            label="Primera noche"
            type="date"
            [required]="true"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="to_date"
            label="Última noche"
            type="date"
            [required]="true"
            [error]="datesError() ? 'Debe ser igual o posterior a la primera noche' : ''"
            customWrapperClass="mt-0"
          />
        </div>
        <app-input
          formControlName="priority"
          label="Prioridad"
          type="number"
          [min]="0"
          [max]="1000"
          helperText="Si dos temporadas se solapan, cada noche toma el precio de la de mayor prioridad. Dos temporadas activas con la misma prioridad no pueden solaparse."
          customWrapperClass="mt-0"
        />
        <div>
          <p class="mb-2 text-sm font-medium text-text-primary">Color en el calendario</p>
          <div class="flex flex-wrap gap-2">
            @for (color of colors; track color) {
              <button
                type="button"
                class="h-8 w-8 rounded-full border-2 transition"
                [style.background-color]="color"
                [class.border-text-primary]="selectedColor() === color"
                [class.border-transparent]="selectedColor() !== color"
                [attr.aria-label]="'Color ' + color"
                [attr.aria-pressed]="selectedColor() === color"
                (click)="pickColor(color)"
              ></button>
            }
          </div>
        </div>
        <app-toggle formControlName="is_active" label="Activa" />
        <p class="text-sm text-text-secondary">
          Después, en cada plan tarifario, pon el precio por noche de cada tipo en esta temporada.
          Los tipos sin precio de temporada mantienen su precio normal.
        </p>
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
export class SeasonFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly seasonsService = inject(SeasonsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  /** Season to edit; null creates a new one. */
  readonly season = input<Season | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<Season>();

  readonly saving = signal(false);
  readonly datesError = signal(false);
  readonly selectedColor = signal<string>(SEASON_COLORS[0]);
  readonly colors = SEASON_COLORS;

  readonly form: FormGroup<SeasonForm> = this.fb.group<SeasonForm>({
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(80)],
    }),
    from_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    to_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    priority: this.fb.nonNullable.control(0, {
      validators: [Validators.required, Validators.min(0), Validators.max(1000)],
    }),
    color: this.fb.nonNullable.control<string>(SEASON_COLORS[0]),
    is_active: this.fb.nonNullable.control(true),
  });

  reset(): void {
    const season = this.season();
    const color = season?.color ?? SEASON_COLORS[0];
    this.form.reset({
      name: season?.name ?? '',
      from_date: season ? seasonDate(season.from_date) : '',
      to_date: season ? seasonDate(season.to_date) : '',
      priority: season?.priority ?? 0,
      color,
      is_active: season?.is_active ?? true,
    });
    this.selectedColor.set(color);
    this.datesError.set(false);
  }

  pickColor(color: string): void {
    this.form.controls.color.setValue(color);
    this.selectedColor.set(color);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    this.datesError.set(!!raw.from_date && !!raw.to_date && raw.to_date < raw.from_date);
    if (this.form.invalid || this.datesError()) return;

    const payload: SeasonPayload = {
      name: raw.name.trim(),
      from_date: raw.from_date,
      to_date: raw.to_date,
      priority: Number(raw.priority),
      color: raw.color,
      is_active: raw.is_active,
    };
    const season = this.season();
    const request = season
      ? this.seasonsService.update(season.id, payload)
      : this.seasonsService.create(payload);

    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toastService.success(season ? 'Temporada actualizada' : 'Temporada creada');
        this.saved.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar la temporada',
        );
      },
    });
  }
}

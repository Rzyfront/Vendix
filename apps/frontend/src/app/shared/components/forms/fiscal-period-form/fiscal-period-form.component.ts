import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';

export interface FiscalPeriodValue {
  name: string;
  start_date: string;
  end_date: string;
}

interface FiscalPeriodControls {
  name: FormControl<string>;
  start_date: FormControl<string>;
  end_date: FormControl<string>;
}

/**
 * Validates `end_date > start_date` at the group level.
 */
function endAfterStartValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const start = control.get('start_date')?.value;
  const end = control.get('end_date')?.value;
  if (!start || !end) return null;
  return new Date(end) > new Date(start) ? null : { endBeforeStart: true };
}

@Component({
  selector: 'app-fiscal-period-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <app-input
        label="Nombre del periodo"
        formControlName="name"
        [required]="true"
        placeholder="Ej: Año fiscal 2026"
      ></app-input>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <app-input
          label="Fecha de inicio"
          type="date"
          formControlName="start_date"
          [required]="true"
        ></app-input>
        <app-input
          label="Fecha de fin"
          type="date"
          formControlName="end_date"
          [required]="true"
        ></app-input>
      </div>

      @if (form.errors?.['endBeforeStart']) {
        <p class="text-xs text-[var(--color-destructive)]">
          La fecha de fin debe ser posterior a la fecha de inicio.
        </p>
      }
    </form>
  `,
})
export class FiscalPeriodFormComponent {
  readonly initialValue = input<Partial<FiscalPeriodValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<FiscalPeriodValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(false);

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<FiscalPeriodControls> = new FormGroup<FiscalPeriodControls>(
    {
      name: new FormControl(this.defaultName(), {
        nonNullable: true,
        validators: [Validators.required],
      }),
      start_date: new FormControl(this.defaultStart(), {
        nonNullable: true,
        validators: [Validators.required],
      }),
      end_date: new FormControl(this.defaultEnd(), {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    { validators: endAfterStartValidator },
  );

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) this.form.patchValue(v, { emitEvent: false });
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const isValid = this.form.valid;
        this.valid.set(isValid);
        this.validityChange.emit(isValid);
        this.valueChange.emit(this.form.getRawValue());
      });
  }

  getValue(): FiscalPeriodValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  private defaultName(): string {
    return `Año fiscal ${new Date().getFullYear()}`;
  }

  private defaultStart(): string {
    return `${new Date().getFullYear()}-01-01`;
  }

  private defaultEnd(): string {
    return `${new Date().getFullYear()}-12-31`;
  }
}

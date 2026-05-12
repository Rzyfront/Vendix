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
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';

import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';

export type CostingMethod = 'FIFO' | 'WEIGHTED_AVERAGE' | 'STANDARD';

export interface InitialInventoryValue {
  costing_method: CostingMethod;
  capture_initial_balance_later: boolean;
}

interface InitialInventoryControls {
  costing_method: FormControl<CostingMethod>;
  capture_initial_balance_later: FormControl<boolean>;
}

@Component({
  selector: 'app-initial-inventory-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SelectorComponent],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <app-selector
        label="Método de valoración de inventario"
        formControlName="costing_method"
        [options]="costingMethodOptions"
        [required]="true"
        tooltipText="Define cómo se calcula el costo de la mercancía vendida. FIFO: primero en entrar, primero en salir. Promedio ponderado: costo promedio. Estándar: costo fijo predefinido."
      ></app-selector>

      <div class="p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700 space-y-1">
        <div><strong>FIFO:</strong> Las unidades más antiguas se venden primero. Recomendado para productos perecederos.</div>
        <div><strong>Promedio ponderado:</strong> Calcula el costo promedio de cada producto. Más simple y estable.</div>
        <div><strong>Estándar:</strong> Costo fijo predefinido. Requiere ajustes periódicos.</div>
      </div>

      <label class="flex items-start gap-2 text-sm cursor-pointer p-2 rounded border border-border">
        <input
          type="checkbox"
          class="mt-0.5"
          [checked]="form.controls.capture_initial_balance_later.value"
          [disabled]="disabled()"
          (change)="onCaptureLaterToggle($event)"
        />
        <span class="text-text-secondary">
          Capturar saldo inicial de inventario más tarde
          <span class="block text-xs text-text-muted mt-0.5">
            Esta opción es informativa. Podrá registrar el saldo inicial desde el módulo de ajustes de inventario.
          </span>
        </span>
      </label>
    </form>
  `,
})
export class InitialInventoryFormComponent {
  readonly initialValue = input<Partial<InitialInventoryValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<InitialInventoryValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(true);

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<InitialInventoryControls> = new FormGroup<InitialInventoryControls>(
    {
      costing_method: new FormControl<CostingMethod>('WEIGHTED_AVERAGE', {
        nonNullable: true,
      }),
      capture_initial_balance_later: new FormControl(true, { nonNullable: true }),
    },
  );

  readonly costingMethodOptions: SelectorOption[] = [
    { value: 'FIFO', label: 'FIFO (Primero en entrar, primero en salir)' },
    { value: 'WEIGHTED_AVERAGE', label: 'Promedio ponderado' },
    { value: 'STANDARD', label: 'Costo estándar' },
  ];

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.emitCurrent();
      }
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emitCurrent());
  }

  getValue(): InitialInventoryValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  onCaptureLaterToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.controls.capture_initial_balance_later.setValue(checked);
  }

  private emitCurrent(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.form.getRawValue());
  }
}

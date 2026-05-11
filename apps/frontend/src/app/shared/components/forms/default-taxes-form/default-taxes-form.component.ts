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
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { IconComponent } from '../../icon/icon.component';
import { ButtonComponent } from '../../button/button.component';

export type TaxMode = 'defaults' | 'custom';
export type TaxType = 'VAT' | 'ICA' | 'WITHHOLDING';

export interface TaxRow {
  name: string;
  percentage: number;
  type: TaxType;
}

export interface DefaultTaxesValue {
  mode: TaxMode;
  taxes: TaxRow[];
}

interface TaxRowControls {
  name: FormControl<string>;
  percentage: FormControl<number>;
  type: FormControl<TaxType>;
}

interface DefaultTaxesControls {
  mode: FormControl<TaxMode>;
  taxes: FormArray<FormGroup<TaxRowControls>>;
}

const DEFAULT_TAXES: TaxRow[] = [
  { name: 'IVA 19%', percentage: 19, type: 'VAT' },
  { name: 'IVA 5%', percentage: 5, type: 'VAT' },
  { name: 'IVA Exento', percentage: 0, type: 'VAT' },
  { name: 'ICA Bogotá', percentage: 0.966, type: 'ICA' },
  { name: 'Retención en la Fuente 2.5%', percentage: 2.5, type: 'WITHHOLDING' },
];

@Component({
  selector: 'app-default-taxes-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-text-primary mb-2">
          Configuración de impuestos
        </legend>

        <label
          class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
          [class.border-primary]="form.controls.mode.value === 'defaults'"
          [class.bg-primary]="form.controls.mode.value === 'defaults'"
          [class.bg-opacity-5]="form.controls.mode.value === 'defaults'"
          [class.border-border]="form.controls.mode.value !== 'defaults'"
        >
          <input type="radio" value="defaults" formControlName="mode" class="mt-1" />
          <div>
            <div class="text-sm font-medium text-text-primary">
              Defaults colombianos
            </div>
            <div class="text-xs text-text-secondary mt-0.5">
              IVA 19%, IVA 5%, IVA Exento, ICA Bogotá, Retención en la Fuente.
            </div>
          </div>
        </label>

        <label
          class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
          [class.border-primary]="form.controls.mode.value === 'custom'"
          [class.bg-primary]="form.controls.mode.value === 'custom'"
          [class.bg-opacity-5]="form.controls.mode.value === 'custom'"
          [class.border-border]="form.controls.mode.value !== 'custom'"
        >
          <input type="radio" value="custom" formControlName="mode" class="mt-1" />
          <div>
            <div class="text-sm font-medium text-text-primary">
              Personalizar
            </div>
            <div class="text-xs text-text-secondary mt-0.5">
              Defina manualmente sus impuestos, retenciones e ICA.
            </div>
          </div>
        </label>
      </fieldset>

      @if (form.controls.mode.value === 'custom') {
        <div class="space-y-3" formArrayName="taxes">
          @for (taxGroup of taxesArray.controls; track $index; let i = $index) {
            <div
              class="grid grid-cols-1 md:grid-cols-[1fr_120px_180px_auto] gap-2 items-end p-3 border border-border rounded-lg"
              [formGroupName]="i"
            >
              <app-input
                label="Nombre"
                formControlName="name"
                placeholder="Ej: IVA 19%"
              ></app-input>
              <app-input
                label="Porcentaje"
                type="number"
                formControlName="percentage"
                placeholder="19"
              ></app-input>
              <app-selector
                label="Tipo"
                formControlName="type"
                [options]="typeOptions"
              ></app-selector>
              <app-button
                variant="ghost"
                size="sm"
                (clicked)="removeTax(i)"
              >
                <app-icon name="trash-2" [size]="14"></app-icon>
              </app-button>
            </div>
          }

          <app-button variant="outline" size="sm" (clicked)="addTax()">
            <app-icon name="plus" [size]="14"></app-icon>
            Agregar impuesto
          </app-button>
        </div>
      }
    </form>
  `,
})
export class DefaultTaxesFormComponent {
  readonly initialValue = input<Partial<DefaultTaxesValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<DefaultTaxesValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(true);

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<DefaultTaxesControls> = new FormGroup<DefaultTaxesControls>(
    {
      mode: new FormControl<TaxMode>('defaults', { nonNullable: true }),
      taxes: new FormArray<FormGroup<TaxRowControls>>([]),
    },
  );

  readonly typeOptions: SelectorOption[] = [
    { value: 'VAT', label: 'IVA' },
    { value: 'ICA', label: 'ICA' },
    { value: 'WITHHOLDING', label: 'Retención' },
  ];

  get taxesArray(): FormArray<FormGroup<TaxRowControls>> {
    return this.form.controls.taxes;
  }

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) {
        if (v.mode) this.form.controls.mode.setValue(v.mode, { emitEvent: false });
        if (v.taxes && v.taxes.length) {
          this.setTaxes(v.taxes);
        }
      }
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emit());
  }

  getValue(): DefaultTaxesValue {
    const mode = this.form.controls.mode.value;
    return {
      mode,
      taxes: mode === 'defaults' ? DEFAULT_TAXES : this.taxesArray.getRawValue(),
    };
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  addTax(): void {
    this.taxesArray.push(this.buildTaxGroup({ name: '', percentage: 0, type: 'VAT' }));
  }

  removeTax(index: number): void {
    this.taxesArray.removeAt(index);
  }

  private buildTaxGroup(row: TaxRow): FormGroup<TaxRowControls> {
    return new FormGroup<TaxRowControls>({
      name: new FormControl(row.name, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      percentage: new FormControl(row.percentage, {
        nonNullable: true,
        validators: [Validators.min(0), Validators.max(100)],
      }),
      type: new FormControl<TaxType>(row.type, { nonNullable: true }),
    });
  }

  private setTaxes(rows: TaxRow[]): void {
    this.taxesArray.clear({ emitEvent: false });
    rows.forEach((r) => this.taxesArray.push(this.buildTaxGroup(r)));
  }

  private emit(): void {
    const mode = this.form.controls.mode.value;
    const isValid =
      mode === 'defaults' ||
      (this.taxesArray.length > 0 && this.taxesArray.valid);
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.getValue());
  }
}

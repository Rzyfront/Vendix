import {
  Component,
  input,
  output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { CreateCurrencyDto, CurrencyState } from '../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-currency-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Crear Nueva Moneda"
      subtitle="Completa los detalles para crear una nueva moneda (formato ISO 4217)"
    >
      <form [formGroup]="currencyForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <app-input
            formControlName="code"
            label="Código de Moneda"
            placeholder="ej. USD"
            [required]="true"
            [control]="currencyForm.get('code')"
            [disabled]="isSubmitting()"
            style="text-transform: uppercase"
            helpText="Código ISO 4217 (3 letras mayúsculas, ej. USD, EUR)"
          ></app-input>

          <app-input
            formControlName="name"
            label="Nombre de Moneda"
            placeholder="ej. Dólar Americano"
            [required]="true"
            [control]="currencyForm.get('name')"
            [disabled]="isSubmitting()"
          ></app-input>

          <app-input
            formControlName="symbol"
            label="Símbolo"
            placeholder="ej. $"
            [required]="true"
            [control]="currencyForm.get('symbol')"
            [disabled]="isSubmitting()"
            helpText="Símbolo de moneda (ej. $, €, £, ¥)"
          ></app-input>

          <app-input
            formControlName="decimal_places"
            label="Decimales"
            type="number"
            [required]="true"
            [control]="currencyForm.get('decimal_places')"
            [disabled]="isSubmitting()"
            helpText="Número de decimales (0-4, típicamente 2)"
          ></app-input>

          <div class="space-y-2">
            <app-selector
              formControlName="state"
              label="Estado Inicial"
              [options]="stateOptions"
              [disabled]="isSubmitting()"
              helpText="Las monedas activas pueden usarse en todo el sistema"
            ></app-selector>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isSubmitting()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="currencyForm.invalid || isSubmitting()"
          [loading]="isSubmitting()"
        >
          Crear Moneda
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CurrencyCreateModalComponent {
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  isOpenChange = output<boolean>();
  submit = output<CreateCurrencyDto>();
  cancel = output<void>();

  stateOptions: SelectorOption[] = [
    { value: 'active', label: 'Activa' },
    { value: 'inactive', label: 'Inactiva' },
    { value: 'deprecated', label: 'Obsoleta' },
  ];

  private fb = inject(FormBuilder);

  currencyForm: FormGroup = this.fb.group({
    code: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(3),
        Validators.pattern(/^[A-Z]{3}$/),
      ],
    ],
    name: ['', [Validators.required, Validators.maxLength(255)]],
    symbol: ['', [Validators.required, Validators.maxLength(10)]],
    decimal_places: [
      2,
      [Validators.required, Validators.min(0), Validators.max(4)],
    ],
    state: [CurrencyState.ACTIVE],
  });

  onSubmit(): void {
    if (this.currencyForm.valid) {
      const currencyData: CreateCurrencyDto = {
        code: this.currencyForm.value.code.toUpperCase(),
        name: this.currencyForm.value.name,
        symbol: this.currencyForm.value.symbol,
        decimal_places: this.currencyForm.value.decimal_places,
        state: this.currencyForm.value.state || CurrencyState.ACTIVE,
      };
      this.submit.emit(currencyData);
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
    this.cancel.emit();
  }

  resetForm(): void {
    this.currencyForm.reset({
      code: '',
      name: '',
      symbol: '',
      decimal_places: 2,
      state: CurrencyState.ACTIVE,
    });
  }
}

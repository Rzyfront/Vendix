import {
  Component,
  input,
  output,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Currency, UpdateCurrencyDto } from '../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-currency-edit-modal',
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
      title="Editar Moneda"
      [subtitle]="currency() ? 'Editando: ' + currency()!.code : ''"
    >
      <form [formGroup]="currencyForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Currency Code (Read-only) -->
          <app-input
            label="Código de Moneda"
            [value]="currency()?.code || ''"
            [disabled]="true"
            helpText="El código de moneda no puede modificarse (identificador ISO 4217)"
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
              label="Estado"
              [options]="stateOptions"
              [disabled]="isSubmitting()"
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
          Actualizar Moneda
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
export class CurrencyEditModalComponent implements OnChanges {
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  currency = input<Currency | null>(null);
  isOpenChange = output<boolean>();
  submit = output<UpdateCurrencyDto>();
  cancel = output<void>();

  stateOptions: SelectorOption[] = [
    { value: 'active', label: 'Activa' },
    { value: 'inactive', label: 'Inactiva' },
    { value: 'deprecated', label: 'Obsoleta' },
  ];

  private fb = inject(FormBuilder);

  currencyForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    symbol: ['', [Validators.required, Validators.maxLength(10)]],
    decimal_places: [
      2,
      [Validators.required, Validators.min(0), Validators.max(4)],
    ],
    state: ['active'],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (this.isOpen() && this.currency()) {
      const currentCurrency = this.currency()!;
      this.currencyForm.patchValue({
        name: currentCurrency.name,
        symbol: currentCurrency.symbol,
        decimal_places: currentCurrency.decimal_places,
        state: currentCurrency.state,
      });
    }
  }

  onSubmit(): void {
    if (this.currencyForm.valid && this.currency()) {
      const currencyData: UpdateCurrencyDto = {
        name: this.currencyForm.get('name')?.value,
        symbol: this.currencyForm.get('symbol')?.value,
        decimal_places: this.currencyForm.get('decimal_places')?.value,
        state: this.currencyForm.get('state')?.value,
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
      name: '',
      symbol: '',
      decimal_places: 2,
      state: 'active',
    });
  }
}

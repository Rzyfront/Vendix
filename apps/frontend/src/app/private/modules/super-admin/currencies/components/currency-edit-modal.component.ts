import {
  Component,
  input,
  output,
  OnChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Currency, UpdateCurrencyDto, CurrencyPosition } from '../interfaces';
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
          <!-- Campos readonly desde la API -->
          <app-input
            label="Código de Moneda"
            [value]="currency()?.code || ''"
            [disabled]="true"
            helpText="Código ISO 4217 (no editable)"
          ></app-input>

          <app-input
            label="Nombre de Moneda"
            [value]="currency()?.name || ''"
            [disabled]="true"
            helpText="Nombre completo (no editable)"
          ></app-input>

          <app-input
            label="Símbolo"
            [value]="currency()?.symbol || ''"
            [disabled]="true"
            helpText="Símbolo de moneda (no editable)"
          ></app-input>

          <!-- Posición del símbolo (editable) -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-700">
              Posición del Símbolo
            </label>
            <select
              formControlName="position"
              [disabled]="isSubmitting()"
              class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option [value]="CurrencyPosition.BEFORE">Antes ($100)</option>
              <option [value]="CurrencyPosition.AFTER">Después (100$)</option>
            </select>
            <p class="text-xs text-gray-500">
              Ubicación del símbolo respecto al monto
            </p>
          </div>

          <!-- Campo configurable: decimales -->
          <app-input
            formControlName="decimal_places"
            label="Decimales"
            type="number"
            [required]="true"
            [control]="currencyForm.get('decimal_places')"
            [disabled]="isSubmitting()"
            helpText="Número de decimales (0-4, típicamente 2)"
          ></app-input>

          <!-- Estado -->
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

      <ng-container slot="footer">
        <div class="flex justify-end gap-3">
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
      </ng-container>
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

  // Exponer el enum para usar en el template
  readonly CurrencyPosition = CurrencyPosition;

  private fb = inject(FormBuilder);

  currencyForm: FormGroup = this.fb.group({
    position: [CurrencyPosition.BEFORE, [Validators.required]],
    decimal_places: [
      2,
      [Validators.required, Validators.min(0), Validators.max(4)],
    ],
    state: ['active'],
  });

  ngOnChanges(): void {
    if (this.isOpen() && this.currency()) {
      const currentCurrency = this.currency()!;
      this.currencyForm.patchValue({
        position: currentCurrency.position,
        decimal_places: currentCurrency.decimal_places,
        state: currentCurrency.state,
      });
    }
  }

  onSubmit(): void {
    if (this.currencyForm.valid && this.currency()) {
      const currencyData: UpdateCurrencyDto = {
        position: this.currencyForm.get('position')?.value,
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
      position: CurrencyPosition.BEFORE,
      decimal_places: 2,
      state: 'active',
    });
  }
}

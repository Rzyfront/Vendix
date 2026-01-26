import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Currency, UpdateCurrencyDto } from '../interfaces';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-currency-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Editar Moneda"
      [subtitle]="currency ? 'Editando: ' + currency.code : ''"
    >
      <form [formGroup]="currencyForm" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- Currency Code (Read-only) -->
          <div class="form-group">
            <label for="code" class="form-label"> Código de Moneda </label>
            <input
              id="code"
              type="text"
              [value]="currency?.code"
              class="form-input form-input-disabled"
              readonly
            />
            <div class="form-help">
              El código de moneda no puede modificarse (identificador ISO 4217)
            </div>
          </div>

          <!-- Currency Name -->
          <div class="form-group">
            <label for="name" class="form-label"> Nombre de Moneda * </label>
            <input
              id="name"
              type="text"
              formControlName="name"
              class="form-input"
              placeholder="ej. Dólar Americano"
              [class.form-input-error]="
                currencyForm.get('name')?.invalid && currencyForm.get('name')?.touched
              "
            />
            <div
              *ngIf="
                currencyForm.get('name')?.invalid && currencyForm.get('name')?.touched
              "
              class="form-error"
            >
              <span *ngIf="currencyForm.get('name')?.errors?.['required']">
                El nombre es requerido
              </span>
            </div>
          </div>

          <!-- Symbol -->
          <div class="form-group">
            <label for="symbol" class="form-label"> Símbolo * </label>
            <input
              id="symbol"
              type="text"
              formControlName="symbol"
              class="form-input"
              placeholder="ej. $"
              maxlength="10"
              [class.form-input-error]="
                currencyForm.get('symbol')?.invalid && currencyForm.get('symbol')?.touched
              "
            />
            <div class="form-help">
              Símbolo de moneda (ej. $, €, £, ¥)
            </div>
            <div
              *ngIf="
                currencyForm.get('symbol')?.invalid && currencyForm.get('symbol')?.touched
              "
              class="form-error"
            >
              <span *ngIf="currencyForm.get('symbol')?.errors?.['required']">
                El símbolo es requerido
              </span>
            </div>
          </div>

          <!-- Decimal Places -->
          <div class="form-group">
            <label for="decimal_places" class="form-label"> Decimales * </label>
            <input
              id="decimal_places"
              type="number"
              formControlName="decimal_places"
              class="form-input"
              min="0"
              max="4"
              [class.form-input-error]="
                currencyForm.get('decimal_places')?.invalid && currencyForm.get('decimal_places')?.touched
              "
            />
            <div class="form-help">
              Número de decimales (0-4, típicamente 2)
            </div>
            <div
              *ngIf="
                currencyForm.get('decimal_places')?.invalid && currencyForm.get('decimal_places')?.touched
              "
              class="form-error"
            >
              <span *ngIf="currencyForm.get('decimal_places')?.errors?.['required']">
                Los decimales son requeridos
              </span>
              <span *ngIf="currencyForm.get('decimal_places')?.errors?.['min']">
                Mínimo 0 decimales
              </span>
              <span *ngIf="currencyForm.get('decimal_places')?.errors?.['max']">
                Máximo 4 decimales
              </span>
            </div>
          </div>

          <!-- State -->
          <div class="form-group">
            <label for="state" class="form-label"> Estado * </label>
            <select
              id="state"
              formControlName="state"
              class="form-input"
              [class.form-input-error]="
                currencyForm.get('state')?.invalid && currencyForm.get('state')?.touched
              "
            >
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
              <option value="deprecated">Obsoleta</option>
            </select>
            <div class="form-help">
              <span *ngIf="currencyForm.get('state')?.value === 'active'">
                Las monedas activas pueden usarse en todo el sistema
              </span>
              <span *ngIf="currencyForm.get('state')?.value === 'inactive'">
                Las monedas inactivas no pueden usarse en nuevas transacciones
              </span>
              <span *ngIf="currencyForm.get('state')?.value === 'deprecated'">
                Las monedas obsoletas son solo para referencia histórica
              </span>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          (click)="onCancel()"
          [disabled]="isSubmitting"
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="isSubmitting || currencyForm.invalid"
          (click)="onSubmit()"
        >
          <app-icon
            *ngIf="isSubmitting"
            name="refresh"
            class="animate-spin"
            size="16"
          ></app-icon>
          <span *ngIf="!isSubmitting">Actualizar Moneda</span>
          <span *ngIf="isSubmitting">Actualizando...</span>
        </button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .form-group {
        @apply mb-6;
      }

      .form-label {
        @apply block text-sm font-medium text-text-primary mb-2;
      }

      .form-input {
        @apply w-full px-3 py-2 border border-border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:border-primary transition-colors;
        background-color: var(--color-surface);
        color: var(--color-text-primary);
      }

      .form-input:focus {
        background-color: var(--color-surface);
      }

      .form-input-error {
        border-color: var(--color-destructive);
        box-shadow: 0 0 0 1px var(--color-destructive);
      }

      .form-input-disabled {
        background-color: var(--color-background);
        color: var(--color-text-muted);
        cursor: not-allowed;
      }

      .form-help {
        @apply mt-1 text-sm text-text-secondary;
      }

      .form-error {
        @apply mt-1 text-sm text-destructive;
      }

      .modal-footer {
        @apply flex justify-end gap-3;
      }

      .btn {
        @apply inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
      }

      .btn-primary {
        background-color: var(--color-primary);
        color: var(--color-text-on-primary);
        border: 1px solid var(--color-primary);

        &:hover:not(:disabled) {
          background-color: var(--color-secondary);
          border-color: var(--color-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        &:disabled {
          @apply opacity-50 cursor-not-allowed;
          transform: none;
        }
      }

      .btn-secondary {
        background-color: var(--color-surface);
        color: var(--color-text-primary);
        border: var(--border-width) solid var(--color-border);

        &:hover:not(:disabled) {
          background-color: var(--color-background);
          border-color: var(--color-text-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        &:disabled {
          @apply opacity-50 cursor-not-allowed;
          transform: none;
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .animate-spin {
        animation: spin 1s linear infinite;
      }
    `,
  ],
})
export class CurrencyEditModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() currency: Currency | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<UpdateCurrencyDto>();
  @Output() cancel = new EventEmitter<void>();

  currencyForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.currencyForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(255)]],
      symbol: ['', [Validators.required, Validators.maxLength(10)]],
      decimal_places: [2, [Validators.required, Validators.min(0), Validators.max(4)]],
      state: ['active'],
    });
  }

  onOpenChange(isOpen: any): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  ngOnChanges(): void {
    if (this.isOpen && this.currency) {
      this.currencyForm.patchValue({
        name: this.currency.name,
        symbol: this.currency.symbol,
        decimal_places: this.currency.decimal_places,
        state: this.currency.state,
      });
    }
  }

  onSubmit(): void {
    if (this.currencyForm.valid && this.currency) {
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

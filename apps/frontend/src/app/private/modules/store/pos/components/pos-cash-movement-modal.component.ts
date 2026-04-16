import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
} from '@angular/core';

import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components';
import { PosCashRegisterService } from '../services/pos-cash-register.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-pos-cash-movement-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'sm'"
      [showCloseButton]="true"
    >
      <!-- Header -->
      <div slot="header" class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"
        >
          <app-icon
            name="cash"
            [size]="20"
            class="text-primary"
          ></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-text-primary">
            Movimiento de Efectivo
          </h2>
          <p class="text-sm text-text-secondary">
            Registrar entrada o salida de efectivo
          </p>
        </div>
      </div>

      <!-- Body -->
      <form [formGroup]="form" class="space-y-5">
        <!-- Type Selection -->
        <div class="grid grid-cols-2 gap-3">
          <button
            type="button"
            (click)="form.patchValue({ type: 'cash_in' })"
            class="p-4 rounded-xl border-2 text-center transition-all"
            [class]="
              form.value.type === 'cash_in'
                ? 'border-green-500 bg-green-50 text-green-700 shadow-sm'
                : 'border-border text-text-secondary hover:border-green-300 hover:bg-green-50/50'
            "
          >
            <app-icon
              name="trending-up"
              [size]="24"
              class="mx-auto mb-1.5"
            ></app-icon>
            <p class="text-sm font-semibold">Entrada</p>
            <p class="text-[10px] opacity-60">Agregar efectivo</p>
          </button>
          <button
            type="button"
            (click)="form.patchValue({ type: 'cash_out' })"
            class="p-4 rounded-xl border-2 text-center transition-all"
            [class]="
              form.value.type === 'cash_out'
                ? 'border-red-500 bg-red-50 text-red-700 shadow-sm'
                : 'border-border text-text-secondary hover:border-red-300 hover:bg-red-50/50'
            "
          >
            <app-icon
              name="trending-down"
              [size]="24"
              class="mx-auto mb-1.5"
            ></app-icon>
            <p class="text-sm font-semibold">Salida</p>
            <p class="text-[10px] opacity-60">Retirar efectivo</p>
          </button>
        </div>

        <app-input
          formControlName="amount"
          label="Monto"
          placeholder="0.00"
          [currency]="true"
          [size]="'md'"
          [required]="true"
          [prefixIcon]="true"
          [error]="getFieldError('amount')"
          (inputBlur)="onFieldBlur('amount')"
        ></app-input>

        <app-input
          formControlName="reference"
          label="Referencia"
          placeholder="Ej: Cambio de monedas, pago proveedor..."
          type="text"
          [size]="'md'"
          helperText="Describe brevemente la razón del movimiento"
        ></app-input>

        <app-input
          formControlName="notes"
          label="Notas"
          placeholder="Notas adicionales..."
          type="text"
          [size]="'md'"
        ></app-input>
      </form>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onSubmit()"
          [disabled]="!form.valid || submitting"
        >
          <app-icon
            [name]="form.value.type === 'cash_in' ? 'trending-up' : 'trending-down'"
            [size]="16"
            slot="icon"
          ></app-icon>
          @if (submitting) {
            Registrando...
          } @else {
            Registrar {{ form.value.type === 'cash_in' ? 'Entrada' : 'Salida' }}
          }
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosCashMovementModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() sessionId: number | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() movementCreated = new EventEmitter<any>();

  submitting = false;
  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private cashRegisterService: PosCashRegisterService,
    private toastService: ToastService,
  ) {
    this.form = this.fb.group({
      type: ['cash_in', Validators.required],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      reference: [''],
      notes: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isOpen'] && this.isOpen) {
      this.form.reset({ type: 'cash_in' });
    }
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.form.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) return 'Este campo es requerido';
      if (field.errors['min']) return 'El monto debe ser mayor a 0';
    }
    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    this.form.get(fieldName)?.markAsTouched();
  }

  onSubmit() {
    if (!this.form.valid || !this.sessionId) return;
    this.submitting = true;

    this.cashRegisterService
      .addMovement(this.sessionId, this.form.value)
      .subscribe({
        next: (movement) => {
          this.submitting = false;
          this.toastService.success(
            this.form.value.type === 'cash_in'
              ? 'Entrada registrada'
              : 'Salida registrada',
          );
          this.movementCreated.emit(movement);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting = false;
          this.toastService.error(
            err.error?.message || 'Error al registrar movimiento',
          );
        },
      });
  }

  onCancel() {
    this.isOpenChange.emit(false);
  }
}

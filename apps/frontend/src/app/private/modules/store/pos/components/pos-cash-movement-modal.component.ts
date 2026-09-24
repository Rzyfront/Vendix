import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';

import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components';
import { PosCashRegisterService } from '../services/pos-cash-register.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-pos-cash-movement-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'sm'"
      [showCloseButton]="true"
      [dialog]="true"
    >
      <!-- Header -->
      <div slot="header" class="cm-header">
        <div class="cm-header-icon">
          <app-icon name="cash" [size]="20"></app-icon>
        </div>
        <div>
          <h2 class="cm-title">Movimiento de Efectivo</h2>
          <p class="cm-subtitle">Registrar entrada o salida de efectivo</p>
        </div>
      </div>

      <!-- Body -->
      <form [formGroup]="form" class="cm-form">
        <!-- Type Selection -->
        <div class="cm-types" role="radiogroup" aria-label="Tipo de movimiento">
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="form.value.type === 'cash_in'"
            (click)="form.patchValue({ type: 'cash_in' })"
            class="cm-type cm-type-in"
            [class.cm-type-selected]="form.value.type === 'cash_in'"
          >
            <app-icon
              name="trending-up"
              [size]="24"
              class="cm-type-icon"
            ></app-icon>
            <p class="cm-type-name">Entrada</p>
            <p class="cm-type-hint">Agregar efectivo</p>
          </button>
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="form.value.type === 'cash_out'"
            (click)="form.patchValue({ type: 'cash_out' })"
            class="cm-type cm-type-out"
            [class.cm-type-selected]="form.value.type === 'cash_out'"
          >
            <app-icon
              name="trending-down"
              [size]="24"
              class="cm-type-icon"
            ></app-icon>
            <p class="cm-type-name">Salida</p>
            <p class="cm-type-hint">Retirar efectivo</p>
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
      <div slot="footer" class="cm-footer">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onSubmit()"
          [disabled]="!form.valid || submitting()"
        >
          <app-icon
            [name]="
              form.value.type === 'cash_in' ? 'trending-up' : 'trending-down'
            "
            [size]="16"
            slot="icon"
          ></app-icon>
          @if (submitting()) {
            Registrando...
          } @else {
            Registrar {{ form.value.type === 'cash_in' ? 'Entrada' : 'Salida' }}
          }
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    /* Stitch paso 7 — movimiento de caja: selector entrada/salida como
       radiogroup con estados seleccionado/no-seleccionado distinguibles sin
       solo color (borde 2px + fondo + icono), hints en neutral-600 sólido
       (opacity-60 falla AA) y foco 3px primary. */
    .cm-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .cm-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      background: var(--color-info-50);
      color: var(--color-info-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .cm-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0;
    }

    .cm-subtitle {
      font-size: 14px;
      color: var(--color-neutral-600);
      margin: 0;
    }

    .cm-form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .cm-types {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .cm-type {
      min-height: 44px;
      padding: 16px;
      border-radius: 12px;
      border: 2px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-neutral-600);
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s ease, background-color 0.2s ease;
    }

    .cm-type:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }

    .cm-type-in:hover {
      border-color: var(--color-success-500);
      background: var(--color-success-50);
    }

    .cm-type-out:hover {
      border-color: var(--color-error-500);
      background: var(--color-error-50);
    }

    .cm-type-in.cm-type-selected {
      border-color: var(--color-success-600);
      background: var(--color-success-50);
      color: var(--color-success-800);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .cm-type-out.cm-type-selected {
      border-color: var(--color-error-600);
      background: var(--color-error-50);
      color: var(--color-error-800);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .cm-type-icon {
      display: block;
      margin: 0 auto 6px;
    }

    .cm-type-name {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }

    .cm-type-hint {
      font-size: 11px;
      font-weight: 500;
      margin: 2px 0 0;
      color: var(--color-neutral-600);
    }

    .cm-type-selected .cm-type-hint {
      color: inherit;
    }

    .cm-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `],
})
export class PosCashMovementModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly sessionId = input<number | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly movementCreated = output<any>();

  readonly submitting = signal(false);
  form: FormGroup;

  private fb = inject(FormBuilder);
  private cashRegisterService = inject(PosCashRegisterService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.form = this.fb.group({
      type: ['cash_in', Validators.required],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      reference: [''],
      notes: [''],
    });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => this.form.reset({ type: 'cash_in' }));
      }
    });
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
    if (!this.form.valid || !this.sessionId()) return;
    this.submitting.set(true);

    this.cashRegisterService
      .addMovement(this.sessionId()!, this.form.value)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (movement) => {
          this.toastService.success(
            this.form.value.type === 'cash_in'
              ? 'Entrada registrada'
              : 'Salida registrada',
          );
          this.movementCreated.emit(movement);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  onCancel() {
    this.isOpenChange.emit(false);
  }
}

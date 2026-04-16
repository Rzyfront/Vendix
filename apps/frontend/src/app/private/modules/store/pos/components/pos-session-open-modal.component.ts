import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
  signal,
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
import {
  PosCashRegisterService,
  CashRegister,
} from '../services/pos-cash-register.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-pos-session-open-modal',
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
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [showCloseButton]="true"
      title="Abrir Caja"
      subtitle="Selecciona una caja e ingresa el monto de apertura"
    >
      <!-- Header icon -->
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-green-100 flex items-center justify-center flex-shrink-0"
      >
        <app-icon
          name="unlock"
          [size]="20"
          class="text-green-600"
        ></app-icon>
      </div>

      <!-- Body -->
      @if (loading()) {
        <div class="flex justify-center py-12">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
        </div>
      } @else {
        <div class="space-y-5">
          <form [formGroup]="form" class="space-y-4">
            <!-- Cash Register Selection -->
            <div>
              <label
                class="block text-sm font-medium text-text-primary mb-1.5"
              >
                Caja Registradora
                <span class="text-destructive">*</span>
              </label>
              <select
                formControlName="cash_register_id"
                class="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                (change)="onRegisterSelected()"
              >
                <option [ngValue]="null" disabled>Seleccionar caja...</option>
                @for (register of registers(); track register.id) {
                  <option [ngValue]="register.id">
                    {{ register.name }} ({{ register.code }})
                    @if (register.sessions?.length) {
                      — En uso
                    }
                  </option>
                }
              </select>
              @if (registers().length === 0) {
                <p class="text-xs text-destructive mt-1">
                  No hay cajas registradoras disponibles. Crea una desde
                  Configuración.
                </p>
              }
            </div>

            <!-- Opening Amount -->
            <app-input
              formControlName="opening_amount"
              label="Monto de Apertura"
              placeholder="0.00"
              [currency]="true"
              [size]="'md'"
              [required]="true"
              [prefixIcon]="true"
              [error]="getFieldError('opening_amount')"
              (inputBlur)="onFieldBlur('opening_amount')"
              helperText="Efectivo en la caja al iniciar el turno"
            ></app-input>
          </form>

          <!-- Info tip -->
          <div
            class="bg-primary/5 border border-primary/20 p-4 rounded-xl flex gap-3 text-sm text-text-secondary"
          >
            <app-icon
              name="info"
              [size]="18"
              class="text-primary mt-0.5 flex-shrink-0"
            ></app-icon>
            <p>
              El monto de apertura se usará para calcular la diferencia
              (sobrante/faltante) al cerrar la caja.
            </p>
          </div>
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onOpen()"
          [disabled]="!form.valid || submitting() || loading()"
        >
          <app-icon name="unlock" [size]="16" slot="icon"></app-icon>
          @if (submitting()) {
            Abriendo...
          } @else {
            Abrir Caja
          }
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosSessionOpenModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly sessionOpened = output<any>();

  readonly registers = signal<CashRegister[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);

  form: FormGroup;

  private fb = inject(FormBuilder);
  private cashRegisterService = inject(PosCashRegisterService);
  private toastService = inject(ToastService);

  constructor() {
    this.form = this.fb.group({
      cash_register_id: [null, [Validators.required]],
      opening_amount: [0, [Validators.required, Validators.min(0)]],
    });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => this.loadRegisters());
      }
    });
  }

  loadRegisters() {
    this.loading.set(true);
    this.cashRegisterService.getCashRegisters().subscribe({
      next: (registers) => {
        const active = registers.filter((r) => r.is_active);
        this.registers.set(active);
        this.loading.set(false);
        if (active.length === 1) {
          this.form.patchValue({ cash_register_id: active[0].id });
          this.onRegisterSelected();
        }
      },
      error: () => {
        this.loading.set(false);
        this.toastService.error('Error al cargar las cajas registradoras');
      },
    });
  }

  onRegisterSelected() {
    const registerId = this.form.value.cash_register_id;
    const register = this.registers().find((r) => r.id === +registerId);
    if (register?.default_opening_amount) {
      this.form.patchValue({
        opening_amount: Number(register.default_opening_amount),
      });
    }
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.form.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) return 'Este campo es requerido';
      if (field.errors['min']) return 'El monto no puede ser negativo';
    }
    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    this.form.get(fieldName)?.markAsTouched();
  }

  onOpen() {
    if (!this.form.valid) return;
    this.submitting.set(true);

    const { cash_register_id, opening_amount } = this.form.value;

    this.cashRegisterService
      .openSession(+cash_register_id, opening_amount)
      .subscribe({
        next: (session) => {
          this.submitting.set(false);
          this.toastService.success('Caja abierta correctamente');
          this.sessionOpened.emit(session);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(
            err.error?.message || 'Error al abrir la caja',
          );
        },
      });
  }

  onCancel() {
    this.isOpenChange.emit(false);
  }
}

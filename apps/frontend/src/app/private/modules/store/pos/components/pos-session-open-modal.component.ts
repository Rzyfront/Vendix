import {Component, input, output, effect, untracked, inject, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

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
      [dialog]="true"
      title="Abrir Caja"
      subtitle="Selecciona una caja e ingresa el monto de apertura"
      class="so-aa-scope"
    >
      <!-- Header icon -->
      <div slot="header" class="so-header-icon">
        <app-icon name="unlock" [size]="20"></app-icon>
      </div>

      <!-- Body -->
      @if (loading()) {
        <div class="so-loading">
          <div class="so-spinner"></div>
        </div>
      } @else {
        <div class="so-body">
          <form [formGroup]="form" class="so-form">
            <!-- Cash Register Selection -->
            <div>
              <label class="so-label" for="so-register">
                Caja Registradora
                <span class="so-required" aria-hidden="true">*</span>
              </label>
              <select
                id="so-register"
                formControlName="cash_register_id"
                class="so-select"
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
                <p class="so-empty">
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
          <div class="so-tip">
            <app-icon
              name="info"
              [size]="18"
              class="so-tip-icon"
            ></app-icon>
            <p class="so-tip-text">
              El monto de apertura se usará para calcular la diferencia
              (sobrante/faltante) al cerrar la caja.
            </p>
          </div>
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="so-footer">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onOpen()"
          [disabled]="!form.valid || submitting() || loading()"
        >
          <app-icon name="unlock" [size]="16" slot="icon" ></app-icon>
          @if (submitting()) {
            Abriendo...
          } @else {
            Abrir Caja
          }
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    /* Stitch paso 7 — apertura de caja: icono success sólido, tip informativo
       en neutral-600 (text-secondary falla AA), select con target 44px y
       foco 3px primary (lenguaje pasos 2-6). */
    .so-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--color-success-50);
      color: var(--color-success-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .so-loading {
      display: flex;
      justify-content: center;
      padding: 48px 0;
    }

    .so-spinner {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      border-bottom: 2px solid var(--color-primary);
      animation: so-spin 0.8s linear infinite;
    }

    @keyframes so-spin {
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .so-spinner { animation: none; }
    }

    .so-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .so-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .so-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 6px;
    }

    .so-required {
      color: var(--color-error-700);
    }

    .so-select {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-primary);
      font-size: 14px;
      transition: border-color 0.2s ease;
    }

    .so-select:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
      border-color: var(--color-primary);
    }

    .so-empty {
      font-size: 12px;
      color: var(--color-error-700);
      margin: 4px 0 0;
    }

    .so-tip {
      display: flex;
      gap: 12px;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--color-info-200);
      background: var(--color-info-50);
      font-size: 14px;
    }

    .so-tip-icon {
      color: var(--color-info-700);
      margin-top: 2px;
      flex-shrink: 0;
    }

    .so-tip-text {
      color: var(--color-neutral-600);
      margin: 0;
      line-height: 1.5;
    }

    .so-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* Stitch 11b (7) — label MONTO + helper de app-input (compartido, fuera
       de alcance) en text-muted/secondary #94a3b8 (2.56:1): se remapean las
       vars heredadas a neutral-500 (~4.8:1) y neutral-600 (~7.0:1); primary
       -> success-700 deja el submit "Abrir Caja" (blanco/#2ecc71, 2.1) en
       ~5.0:1. Solo afecta a este subárbol. */
    .so-aa-scope {
      --color-primary: var(--color-success-700);
      --color-text-secondary: var(--color-neutral-600);
      --color-text-muted: var(--color-neutral-500);
    }
  `],
})
export class PosSessionOpenModalComponent {
  private destroyRef = inject(DestroyRef);
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
    this.cashRegisterService.getCashRegisters().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (session) => {
          this.submitting.set(false);
          this.toastService.success('Caja abierta correctamente');
          this.sessionOpened.emit(session);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  onCancel() {
    this.isOpenChange.emit(false);
  }
}

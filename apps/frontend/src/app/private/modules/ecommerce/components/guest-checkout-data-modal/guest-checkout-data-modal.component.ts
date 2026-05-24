import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

export interface GuestCheckoutData {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
}

@Component({
  selector: 'app-guest-checkout-data-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="continueWithoutData()"
      title="Datos opcionales"
      subtitle="Puedes continuar sin registrarte. Estos datos solo ayudan a coordinar tu pedido o emitir factura a tu nombre."
      size="md"
    >
      <form [formGroup]="form" class="guest-data-form">
        <div class="guest-data-grid">
          <app-input
            label="Nombre"
            formControlName="first_name"
            placeholder="Tu nombre"
          />
          <app-input
            label="Apellido"
            formControlName="last_name"
            placeholder="Tu apellido"
          />
          <app-input
            label="Correo"
            type="email"
            formControlName="email"
            placeholder="correo@ejemplo.com"
          />
          <app-input
            label="Teléfono"
            type="tel"
            formControlName="phone"
            placeholder="+57 300 000 0000"
          />
        </div>

        @if (invoicingEnabled()) {
          <div class="guest-data-section-title">
            Datos para factura electrónica
          </div>
          <p class="guest-data-hint">
            Opcional. Si llenas estos datos te emitiremos factura electrónica a
            tu nombre; si no, te emitiremos un POS equivalente.
          </p>
          <div class="guest-data-grid">
            <label class="guest-data-field">
              <span>Tipo de documento</span>
              <select formControlName="document_type">
                <option value="">No indicar</option>
                <option value="CC">CC</option>
                <option value="NIT">NIT</option>
                <option value="CE">CE</option>
                <option value="PP">PP</option>
                <option value="TI">TI</option>
              </select>
            </label>
            <app-input
              label="Número de documento"
              formControlName="document_number"
              placeholder="Documento"
            />
          </div>
        }
      </form>

      <div slot="footer" class="guest-data-actions">
        <app-button variant="ghost" (clicked)="continueWithoutData()">
          Continuar sin datos
        </app-button>
        <app-button variant="primary" (clicked)="continueWithData()">
          Guardar y continuar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .guest-data-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .guest-data-hint {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        margin: 0 0 0.5rem;
      }

      .guest-data-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }

      .guest-data-section-title {
        margin-top: 0.5rem;
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      .guest-data-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        font-size: var(--fs-sm);
        color: var(--color-text-primary);
      }

      .guest-data-field select {
        min-height: 42px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        color: var(--color-text-primary);
        padding: 0 0.75rem;
      }

      .guest-data-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        width: 100%;
      }

      @media (max-width: 640px) {
        .guest-data-grid {
          grid-template-columns: 1fr;
        }

        .guest-data-actions {
          flex-direction: column-reverse;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestCheckoutDataModalComponent {
  readonly isOpen = signal(false);
  readonly invoicingEnabled = input<boolean>(false);
  readonly completed = output<GuestCheckoutData | null>();

  readonly form = new FormGroup({
    first_name: new FormControl('', { nonNullable: true }),
    last_name: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true }),
    document_type: new FormControl('', { nonNullable: true }),
    document_number: new FormControl('', { nonNullable: true }),
  });

  open(): void {
    this.isOpen.set(true);
  }

  onOpenChange(isOpen: boolean): void {
    this.isOpen.set(isOpen);
  }

  continueWithoutData(): void {
    this.isOpen.set(false);
    this.completed.emit(null);
  }

  continueWithData(): void {
    const value = this.form.getRawValue();
    const entries = Object.entries(value).map(([key, val]) => [
      key,
      String(val || '').trim(),
    ]);
    const filtered = entries.filter(([, val]) => val.length > 0);
    const cleaned =
      filtered.length > 0
        ? (Object.fromEntries(filtered) as GuestCheckoutData)
        : null;

    this.isOpen.set(false);
    this.completed.emit(cleaned);
  }
}

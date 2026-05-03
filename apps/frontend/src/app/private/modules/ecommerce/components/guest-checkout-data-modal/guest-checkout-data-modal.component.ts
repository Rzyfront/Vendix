import {
  ChangeDetectionStrategy,
  Component,
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
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  country_code?: string;
  postal_code?: string;
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
      size="lg"
    >
      <form [formGroup]="form" class="guest-data-form">
        <div class="guest-data-notice">
          <strong>Es opcional.</strong>
          Si no quieres compartir datos ahora, puedes continuar sin llenar el
          formulario.
        </div>

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

        <div class="guest-data-section-title">
          Datos para factura electrónica si la necesitas
        </div>
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

        <div class="guest-data-section-title">
          Dirección opcional para coordinar entrega
        </div>
        <div class="guest-data-grid">
          <app-input
            label="Dirección"
            formControlName="address_line1"
            placeholder="Calle y número"
          />
          <app-input
            label="Complemento"
            formControlName="address_line2"
            placeholder="Apto, piso, oficina"
          />
          <app-input
            label="Ciudad"
            formControlName="city"
            placeholder="Ciudad"
          />
          <app-input
            label="Departamento/Estado"
            formControlName="state_province"
            placeholder="Departamento"
          />
          <app-input
            label="País"
            formControlName="country_code"
            placeholder="CO"
          />
          <app-input
            label="Código postal"
            formControlName="postal_code"
            placeholder="Opcional"
          />
        </div>
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

      .guest-data-notice {
        padding: 0.875rem 1rem;
        border-radius: var(--radius-md);
        background: var(--color-primary-light);
        color: var(--color-text-primary);
        font-size: var(--fs-sm);
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
  readonly completed = output<GuestCheckoutData | null>();

  readonly form = new FormGroup({
    first_name: new FormControl('', { nonNullable: true }),
    last_name: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true }),
    document_type: new FormControl('', { nonNullable: true }),
    document_number: new FormControl('', { nonNullable: true }),
    address_line1: new FormControl('', { nonNullable: true }),
    address_line2: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true }),
    state_province: new FormControl('', { nonNullable: true }),
    country_code: new FormControl('CO', { nonNullable: true }),
    postal_code: new FormControl('', { nonNullable: true }),
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
    const hasMeaningfulData = entries.some(
      ([key, val]) => key !== 'country_code' && val.length > 0,
    );
    const cleaned = hasMeaningfulData
      ? (Object.fromEntries(
          entries.filter(([, val]) => val.length > 0),
        ) as GuestCheckoutData)
      : null;

    this.isOpen.set(false);
    this.completed.emit(cleaned);
  }
}

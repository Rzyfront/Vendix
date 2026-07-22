import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  AddressFormFieldsComponent,
  AddressPayload,
} from '../../../../../../shared/components';

import {
  CreateAddressPayload,
  UpdateAddressPayload,
} from '../../services/store-orders.service';

/**
 * Modal de captura / edición de dirección de envío para una orden (A3-edit).
 *
 * Presentacional: NO realiza llamadas HTTP. Delega la captura + validación al
 * componente reutilizable `app-address-form-fields` (mapa opcional, geocoding,
 * warning no bloqueante) y emite el payload listo para persistir.
 *
 * Dos modos:
 * - **Crear** (`addressId === null`): emite `submitForm` con un
 *   `CreateAddressPayload` (claves DTO backend `address_line_1`, `state`,
 *   `country`, más `type:'shipping'` y `customer_id`). El padre hace
 *   `POST /store/addresses` → `PATCH /store/orders/:id`.
 * - **Editar** (`addressId` no null): emite `submitEdit` con
 *   `{ addressId, payload: UpdateAddressPayload }` (mismas claves DTO, sin
 *   `customer_id` ni `type` requeridos). El padre hace
 *   `PATCH /store/addresses/:id`.
 *
 * Zoneless-clean: signals + computed + input/output, sin NgZone/markForCheck,
 * sin @Input/@Output tradicionales, sin subscribe sin takeUntilDestroyed.
 */
@Component({
  selector: 'app-shipping-address-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    AddressFormFieldsComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="modalTitle()"
      [subtitle]="customerName() || 'Cliente'"
      size="md"
      (cancel)="close.emit()"
      (closed)="close.emit()"
    >
      <div
        class="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-700 mb-3"
      >
        <app-icon name="info" [size]="14" class="mt-0.5 flex-shrink-0"></app-icon>
        <span>
          {{ addressId()
            ? 'Edita la dirección de entrega vinculada a esta orden.'
            : 'La dirección quedará vinculada al cliente y se asignará como destino de envío de esta orden.'
          }}
        </span>
      </div>

      <app-address-form-fields
        [initialAddress]="initialAddress()"
        (addressChange)="onAddressChange($event)"
        (validChange)="onAddressValid($event)"
      ></app-address-form-fields>

      <div slot="footer" class="flex items-center justify-end gap-2">
        <app-button
          variant="ghost"
          type="button"
          [disabled]="saving()"
          (clicked)="close.emit()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          type="button"
          [loading]="saving()"
          [disabled]="!addressValid() || saving()"
          (clicked)="submit()"
        >
          {{ addressId() ? 'Guardar cambios' : 'Guardar dirección' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ShippingAddressModalComponent {
  /** Cliente al que se vinculará la dirección (de `order.customer_id`). */
  readonly customerId = input<number | null>(null);
  /** Nombre del cliente, solo para el subtítulo del modal. */
  readonly customerName = input<string>('');
  /** True mientras el padre persiste (POST+PATCH o PATCH). */
  readonly saving = input<boolean>(false);
  /**
   * ID de la dirección a editar. `null` = modo crear (POST). No-null = modo
   * editar (PATCH `/store/addresses/:id`).
   */
  readonly addressId = input<number | null>(null);
  /**
   * Dirección existente mapeada a `AddressPayload` para prefill el hijo
   * `app-address-form-fields`. En modo crear es `null`.
   */
  readonly initialAddress = input<AddressPayload | null>(null);

  /** Cierra el modal sin guardar. */
  readonly close = output<void>();
  /** Emite el payload listo para `POST /store/addresses` (modo crear). */
  readonly submitForm = output<CreateAddressPayload>();
  /** Emite `{ addressId, payload }` listo para `PATCH /store/addresses/:id` (modo editar). */
  readonly submitEdit = output<{ addressId: number; payload: UpdateAddressPayload }>();

  /** Última dirección emitida por el formulario hijo. */
  readonly addressPayload = signal<AddressPayload | null>(null);
  /** Validez del formulario hijo (síncrono, signal-based). */
  readonly addressValid = signal(false);

  /** Título dinámico según modo crear/editar. */
  readonly modalTitle = computed(() =>
    this.addressId()
      ? 'Editar dirección de entrega'
      : 'Agregar dirección de entrega',
  );

  /** Handler del hijo: actualiza la última dirección emitida. */
  onAddressChange(payload: AddressPayload): void {
    this.addressPayload.set(payload);
  }

  /** Handler del hijo: actualiza la validez del formulario de dirección. */
  onAddressValid(valid: boolean): void {
    this.addressValid.set(valid);
  }

  /**
   * Construye el payload desde la última `AddressPayload` emitida por el hijo
   * (claves Prisma: `address_line1`, `state_province`, `country_code`,
   * `postal_code`, `phone_number`, `latitude`, `longitude`) al DTO del backend
   * (`address_line_1`, `state`, `country` con guion bajo y nombres cortos).
   */
  submit(): void {
    if (!this.addressValid() || this.saving()) return;
    const payload = this.addressPayload();
    if (!payload) return;

    const cid = this.customerId();
    const id = this.addressId();

    if (id != null) {
      // Modo editar: PATCH /store/addresses/:id (sin customer_id ni type).
      const update: UpdateAddressPayload = {
        address_line_1: payload.address_line1 ?? '',
        city: payload.city ?? '',
        state: payload.state_province ?? '',
        country: payload.country_code ?? '',
      };
      if (payload.address_line2) update.address_line_2 = payload.address_line2;
      if (payload.postal_code) update.postal_code = payload.postal_code;
      // El DTO backend usa @IsString @IsLatLong → convertimos number → string.
      if (payload.latitude != null) update.latitude = String(payload.latitude);
      if (payload.longitude != null) update.longitude = String(payload.longitude);
      this.submitEdit.emit({ addressId: id, payload: update });
    } else {
      // Modo crear: POST /store/addresses con type + customer_id.
      const create: CreateAddressPayload = {
        address_line_1: payload.address_line1 ?? '',
        city: payload.city ?? '',
        state: payload.state_province ?? '',
        country: payload.country_code ?? '',
        type: 'shipping',
      };
      if (payload.address_line2) create.address_line_2 = payload.address_line2;
      if (payload.postal_code) create.postal_code = payload.postal_code;
      if (cid != null) create.customer_id = cid;
      this.submitForm.emit(create);
    }
  }
}
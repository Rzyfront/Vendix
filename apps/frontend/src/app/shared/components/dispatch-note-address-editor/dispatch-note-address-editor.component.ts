import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AddressFormFieldsComponent,
  AddressPayload,
} from '../address-form-fields/address-form-fields.component';
import {
  DispatchNoteAddressService,
  DispatchNoteAddressPayload,
} from './dispatch-note-address-editor.service';
import { ToastService } from '../toast/toast.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Editable delivery-address editor for a dispatch note (remisión).
 *
 * Wraps `app-address-form-fields` and persists the form via
 * `PATCH /store/dispatch-notes/:noteId/address` (see
 * `DispatchNoteAddressService`). Two modes:
 *
 * - display: read-only snapshot with an "Editar" button.
 * - edit: the form is editable with "Guardar" / "Cancelar" buttons.
 *
 * The `address` input is the `customer_address` JSON snapshot already
 * persisted on the note (keys: address_line1, address_line2, city,
 * state_province, country_code, postal_code, phone_number, latitude,
 * longitude). It is mapped 1:1 to `AddressPayload` (same key names) so the
 * round-trip needs no remapping. On save the form is mapped to the DTO
 * vocabulary (`address_line_1` with underscore) before hitting the backend.
 *
 * Zoneless + Signals: no NgZone, no markForCheck, no @Input/@Output. The
 * HTTP subscribe uses `takeUntilDestroyed(this.destroyRef)`.
 */
@Component({
  selector: 'app-dispatch-note-address-editor',
  standalone: true,
  imports: [AddressFormFieldsComponent, IconComponent],
  templateUrl: './dispatch-note-address-editor.component.html',
  styleUrls: ['./dispatch-note-address-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
})
export class DispatchNoteAddressEditorComponent {
  /** Dispatch note id whose `customer_address` snapshot is being edited. */
  readonly noteId = input<number>();
  /** Current `customer_address` snapshot (JSON blob from the note). */
  readonly address = input<AddressPayload | null>(null);

  /** Emits after a successful save so the parent can refresh the note. */
  readonly saved = output<void>();

  /** True while in edit mode (form visible); false = read-only display. */
  readonly editing = signal(false);
  /** True while the PATCH request is in flight. */
  readonly saving = signal(false);

  private readonly addressService = inject(DispatchNoteAddressService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Latest form value tracked from the child form (null until first change). */
  private currentFormValue = signal<AddressPayload | null>(null);

  startEdit(): void {
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    // Drop any in-progress edits — the next time edit is opened, the child
    // form re-prefills from `address()` via its `initialAddress` effect.
    this.currentFormValue.set(null);
  }

  /** Tracks the child form's value + validity as the user edits. */
  onAddressChange(value: AddressPayload): void {
    this.currentFormValue.set(value);
  }

  save(): void {
    const id = this.noteId();
    if (id == null) {
      this.toast.error('No se pudo guardar: falta el id de la remisión.');
      return;
    }
    const value = this.currentFormValue() ?? this.address();
    if (!value) {
      this.toast.error('No hay dirección para guardar.');
      return;
    }

    const payload: DispatchNoteAddressPayload = {
      address_line_1: value.address_line1,
      address_line_2: value.address_line2,
      city: value.city,
      state_province: value.state_province,
      country_code: value.country_code,
      postal_code: value.postal_code,
      phone_number: value.phone_number,
      latitude: value.latitude,
      longitude: value.longitude,
    };

    this.saving.set(true);
    this.addressService
      .updateAddress(id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
          this.toast.success('Dirección de entrega actualizada.');
          this.saved.emit();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(
            'No pudimos guardar la dirección. Intenta de nuevo.',
            'Error',
          );
        },
      });
  }
}
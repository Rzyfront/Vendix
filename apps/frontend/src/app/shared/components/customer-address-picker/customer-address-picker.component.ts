import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';

export interface CustomerAddressPickerAddress {
  id: number;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  country_code: string;
  phone_number?: string | null;
  is_primary?: boolean;
}

/**
 * CustomerAddressPickerComponent
 *
 * Reusable address selector for the ecommerce flows that need the
 * customer to pick where the order / booking is going. The same
 * component is used by:
 *
 *   - Checkout (Direccion de Envio step) — for product shipments
 *   - Booking (A domicilio) — for technician dispatch
 *
 * The visual structure mirrors what MercadoLibre / Amazon use: a
 * vertical list of address cards, each with a radio + a
 * multi-line preview, and an "Agregar nueva dirección" card at the
 * end. When an address is selected, an optional "Modificar
 * domicilio o elegir otro" link surfaces underneath, since the
 * account page is the canonical place to manage addresses.
 *
 * Inputs:
 *   - addresses           list of saved addresses for the customer
 *   - selectedAddressId   currently-selected address id (or null)
 *   - showAddNew         show the "+ Agregar nueva dirección" card
 *   - showEditLink       show the "Modificar" link under the selected card
 *   - heading            optional h4 above the list (e.g. "¿A dónde vamos?")
 *
 * Outputs:
 *   - addressSelected    fires with the new id when the user picks
 *   - addNewClicked      fires when the user clicks the add-new card
 *   - editClicked        fires when the user clicks the modify link
 */
@Component({
  selector: 'app-customer-address-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './customer-address-picker.component.html',
  styleUrls: ['./customer-address-picker.component.scss'],
})
export class CustomerAddressPickerComponent {
  private router = inject(Router);

  /** The saved addresses to show. */
  readonly addresses = input<CustomerAddressPickerAddress[]>([]);
  /** The currently-selected address id (null = none). */
  readonly selectedAddressId = input<number | null>(null);
  /** Show the "+ Agregar nueva dirección" card at the end. */
  readonly showAddNew = input<boolean>(true);
  /** Show the "Modificar domicilio" link under the selected card. */
  readonly showEditLink = input<boolean>(true);
  /** Optional h4 heading above the list. */
  readonly heading = input<string>('');

  /** Fires when the user selects an address. */
  readonly addressSelected = output<number>();
  /** Fires when the user clicks "+ Agregar nueva dirección". */
  readonly addNewClicked = output<void>();
  /** Fires when the user clicks "Modificar domicilio". */
  readonly editClicked = output<void>();

  /** True if there are any addresses to render. */
  readonly hasAddresses = computed(() => this.addresses().length > 0);

  /** Format address line 1 (and 2 if present). */
  formatAddressLine1(a: CustomerAddressPickerAddress): string {
    return a.address_line2
      ? `${a.address_line1}, ${a.address_line2}`
      : a.address_line1;
  }

  /** Format city line (city + state if present). */
  formatAddressCity(a: CustomerAddressPickerAddress): string {
    return a.state_province
      ? `${a.city}, ${a.state_province}`
      : a.city;
  }

  select(id: number): void {
    this.addressSelected.emit(id);
  }

  addNew(): void {
    this.addNewClicked.emit();
  }

  /** Default edit behavior: navigate to /account where the customer
   *  manages all addresses. Consumers that need a different behavior
   *  (e.g. open a modal) can override via the (editClicked) event. */
  edit(): void {
    this.editClicked.emit();
    this.router.navigate(['/account']);
  }

  isSelected(id: number): boolean {
    return this.selectedAddressId() === id;
  }
}
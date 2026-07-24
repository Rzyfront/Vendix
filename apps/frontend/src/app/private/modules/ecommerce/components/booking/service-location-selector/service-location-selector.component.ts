import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  effect,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  CustomerAddressPickerComponent,
  CustomerAddressPickerAddress,
} from '../../../../../../shared/components/customer-address-picker/customer-address-picker.component';

export type ServiceLocation = 'home' | 'shop';

/** Re-export so existing consumers (e.g. BookingComponent) keep working
 *  without changing their import paths. The actual data shape now
 *  lives in the shared component. */
export type CustomerAddress = CustomerAddressPickerAddress;

export interface StoreAddress {
  id: number;
  address_line1: string;
  city: string;
  state_province?: string | null;
  country_code: string;
}

/**
 * ServiceLocationSelectorComponent
 *
 * The user previously had to choose between "A domicilio" and "En el
 * local" via two radio cards. That toggle was removed: now the choice
 * is determined by the `offerHomeService` input (driven from the
 * store's services settings). When true, the customer address picker
 * is shown. When false, the technician's local address is shown
 * read-only.
 *
 * The component still emits the resolved `ServiceLocation` via the
 * `valueChange` output so parent flows that listen to it keep
 * working without API changes.
 */
@Component({
  selector: 'app-service-location-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent, CustomerAddressPickerComponent],
  templateUrl: './service-location-selector.component.html',
  styleUrls: ['./service-location-selector.component.scss'],
})
export class ServiceLocationSelectorComponent {
  private router = inject(Router);

  readonly storeAddress = input<StoreAddress | null>(null);
  readonly customerAddresses = input<CustomerAddress[]>([]);
  readonly selectedAddressId = input<number | null>(null);
  /**
   * Whether the store offers 'A domicilio' service. When false, only
   * the technician's local address is shown. Defaults to true so
   * existing callers don't accidentally hide the option.
   */
  readonly offerHomeService = input<boolean>(true);

  /** Resolved service location — derived from `offerHomeService`.
   *  Emitted to the parent on input change so the parent can react
   *  without polling the component. */
  readonly valueChange = output<ServiceLocation>();
  readonly addressChange = output<number | null>();

  constructor() {
    // Emit the resolved value whenever the input changes. Replaces the
    // old `pickHome()` / `pickShop()` user-click handlers — the
    // decision is now driven by config, not user input.
    effect(() => {
      this.valueChange.emit(this.offerHomeService() ? 'home' : 'shop');
    });
  }

  /**
   * Called by the shared <app-customer-address-picker> when the user
   * picks a card. Forward the id to the parent so the booking DTO
   * includes the correct service_address_id.
   */
  onAddressPicked(id: number): void {
    this.addressChange.emit(id);
  }

  /**
   * Called by the shared picker when the user clicks "Modificar
   * domicilio" or "Agregar nueva dirección". Both navigate to
   * /account where the customer manages addresses.
   */
  openAccountAddresses(): void {
    this.router.navigate(['/account']);
  }

  formatAddressLine(a: StoreAddress): string {
    return a.address_line1;
  }

  formatAddressCity(a: StoreAddress): string {
    return a.state_province
      ? `${a.city}, ${a.state_province}`
      : a.city;
  }
}

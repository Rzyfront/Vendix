import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

export type ServiceLocation = 'home' | 'shop';

export interface CustomerAddress {
  id: number;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  country_code: string;
  postal_code?: string | null;
  is_primary?: boolean;
}

export interface StoreAddress extends CustomerAddress {}

/**
 * ServiceLocationSelectorComponent
 *
 * Two radio cards that ask the customer where the service will be
 * performed:
 *  - `home`  → the technician goes to the customer's address. The
 *              component emits the picked `CustomerAddress` so the
 *              parent can include it in the booking DTO.
 *  - `shop`  → the customer goes to the technician's local. The
 *              component receives the store's address via `[storeAddress]`
 *              and renders it (read-only) so the customer sees where
 *              to show up.
 *
 * Mobile-first: grid 2 cols on <768px, 2 cols on ≥768px. Each card
 * is a 44×44+ touch target (rule from skill `vendix-ui-ux`).
 * Radio cards pattern from `app-pos-fulfillment-selector.component.ts`.
 */
@Component({
  selector: 'app-service-location-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  templateUrl: './service-location-selector.component.html',
  styleUrls: ['./service-location-selector.component.scss'],
})
export class ServiceLocationSelectorComponent {
  readonly value = input<ServiceLocation | null>(null);
  readonly storeAddress = input<StoreAddress | null>(null);
  readonly customerAddresses = input<CustomerAddress[]>([]);
  readonly selectedAddressId = input<number | null>(null);

  readonly valueChange = output<ServiceLocation>();
  readonly addressChange = output<number | null>();

  /** True when home addresses are missing — the parent can show a hint. */
  readonly hasAddresses = computed(() => this.customerAddresses().length > 0);

  /** Address list shown when value === 'home'. Empty if user has none. */
  readonly addressesToShow = computed(() => {
    if (this.value() !== 'home') return [];
    return this.customerAddresses();
  });

  pickHome(): void {
    this.valueChange.emit('home');
    // Auto-pick the primary address on first home select, if any.
    if (this.selectedAddressId() == null) {
      const primary = this.customerAddresses().find((a) => a.is_primary)
        ?? this.customerAddresses()[0];
      if (primary) {
        this.addressChange.emit(primary.id);
      }
    }
  }

  pickShop(): void {
    this.valueChange.emit('shop');
    // Clear any previously-picked home address — shop bookings don't have one.
    if (this.selectedAddressId() != null) {
      this.addressChange.emit(null);
    }
  }

  selectAddress(id: number): void {
    this.addressChange.emit(id);
  }

  formatAddressLine(a: CustomerAddress): string {
    const parts = [a.address_line1];
    if (a.address_line2) parts.push(a.address_line2);
    return parts.join(', ');
  }

  formatAddressCity(a: CustomerAddress): string {
    const city = [a.city];
    if (a.state_province) city.push(a.state_province);
    return city.join(', ');
  }
}

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
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../../../../environments/environment';
import { TenantFacade } from '../../../../../../core/store/tenant/tenant.facade';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

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

interface NewAddressDraft {
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  country_code: string;
  postal_code: string;
  phone_number: string;
  is_primary: boolean;
}

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
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './service-location-selector.component.html',
  styleUrls: ['./service-location-selector.component.scss'],
})
export class ServiceLocationSelectorComponent {
  private http = inject(HttpClient);
  private tenantFacade = inject(TenantFacade);
  private toast = inject(ToastService);

  readonly value = input<ServiceLocation | null>(null);
  readonly storeAddress = input<StoreAddress | null>(null);
  readonly customerAddresses = input<CustomerAddress[]>([]);
  readonly selectedAddressId = input<number | null>(null);
  /**
   * Whether the store offers 'A domicilio' service. When false, the
   * 'A domicilio' radio card is hidden and only 'En el local' shows.
   * Defaults to true so existing callers don't accidentally hide
   * the option.
   */
  readonly offerHomeService = input<boolean>(true);

  readonly valueChange = output<ServiceLocation>();
  readonly addressChange = output<number | null>();
  readonly addressesChanged = output<CustomerAddress[]>();

  readonly showNewAddressForm = signal(false);
  readonly savingAddress = signal(false);
  readonly draft = signal<NewAddressDraft>({
    address_line1: '',
    address_line2: '',
    city: '',
    state_province: '',
    country_code: 'CO',
    postal_code: '',
    phone_number: '',
    is_primary: false,
  });

  private get apiUrl(): string {
    return `${environment.apiUrl}/ecommerce/reservations/customer/addresses`;
  }

  private get headers(): HttpHeaders {
    const storeId = this.tenantFacade.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  /** True when home addresses are missing — the parent can show a hint. */
  readonly hasAddresses = computed(() => this.customerAddresses().length > 0);

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

  toggleNewAddressForm(): void {
    this.showNewAddressForm.update((v) => !v);
  }

  /** Update a single field of the new-address draft (signal-friendly). */
  patchDraft<K extends keyof NewAddressDraft>(key: K, value: NewAddressDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  saveNewAddress(): void {
    const d = this.draft();
    if (!d.address_line1?.trim() || !d.city?.trim() || !d.country_code?.trim()) {
      this.toast.error('Calle, ciudad y país son obligatorios');
      return;
    }
    this.savingAddress.set(true);
    this.http
      .post<any>(this.apiUrl, d, { headers: this.headers })
      .subscribe({
        next: (created) => {
          const list = [...this.customerAddresses(), created];
          // Sort by is_primary DESC.
          list.sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
          this.addressesChanged.emit(list);
          this.addressChange.emit(created.id);
          this.resetDraft();
          this.showNewAddressForm.set(false);
          this.savingAddress.set(false);
          this.toast.success('Dirección agregada');
        },
        error: () => {
          this.savingAddress.set(false);
          this.toast.error('No se pudo guardar la dirección');
        },
      });
  }

  private resetDraft(): void {
    this.draft.set({
      address_line1: '',
      address_line2: '',
      city: '',
      state_province: '',
      country_code: 'CO',
      postal_code: '',
      phone_number: '',
      is_primary: false,
    });
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

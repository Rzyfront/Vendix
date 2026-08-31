import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import type { CustomerAddressPickerAddress } from '../../../../../../shared/components/customer-address-picker/customer-address-picker.component';

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
  imports: [CommonModule, IconComponent],
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
  /**
   * Appointment redesign phase 2 — per-product home-service eligibility.
   * The booking flow passes `offer_home_service_for_product` from
   * `GET /ecommerce/store/services?product_id=...`. When false, the
   * "A domicilio" option is hidden even if the store globally offers
   * it (e.g. "Tintura" no va a domicilio aunque el salón sí ofrezca
   * el servicio en otros productos). Defaults to true to preserve
   * the legacy behavior — only callers that pass the per-product
   * flag actually gate on it.
   */
  readonly productEligibleForHomeService = input<boolean>(true);

  /** Resolved service location — driven by la elección explícita del
   *  cliente o, si no eligió todavía, por la config `offerHomeService`.
   *  Emitted to the parent on cada cambio para que BookingComponent
   *  pueda sincronizar `serviceLocation` con el selector. */
  readonly valueChange = output<ServiceLocation>();
  readonly addressChange = output<number | null>();

  /** Elección explícita del usuario. null = aún no eligió, en ese
   *  caso el default es `offerHomeService() ? 'home' : 'shop'`. */
  private readonly userChoice = signal<'shop' | 'home' | null>(null);

  constructor() {
    // Re-emite cuando cambia la elección del usuario o los flags de
    // config (tienda + producto). La decisión efectiva es siempre:
    // elección explícita si existe, sino el fallback compuesto.
    effect(() => {
      const choice = this.userChoice();
      const fallback = this.showHomeOption() ? 'home' : 'shop';
      // Si el producto se volvió NO elegible mientras el usuario tenía
      // elegida la opción "home", forzamos `shop` y limpiamos la
      // elección explícita para que el visual no muestre un estado
      // inconsistente.
      if (choice === 'home' && !this.showHomeOption()) {
        this.userChoice.set(null);
      }
      this.valueChange.emit(this.userChoice() ?? fallback);
    });
  }

  /**
   * Computed: ¿mostrar la opción "A domicilio" al cliente?
   * Combina la config global de la tienda (`offerHomeService`) con
   * la elegibilidad per-producto (`productEligibleForHomeService`).
   * Cualquiera de las dos en `false` oculta la opción.
   */
  showHomeOption(): boolean {
    return this.offerHomeService() && this.productEligibleForHomeService();
  }

  pickHome(): void {
    if (!this.showHomeOption()) return; // tienda o producto no ofrece a domicilio
    this.userChoice.set('home');
  }

  pickShop(): void {
    this.userChoice.set('shop');
  }

  /**
   * Modalidad efectiva: la elección EXPLÍCITA del usuario si hizo click,
   * si no, el fallback compuesto (tienda ∧ producto). Lo usamos en el
   * template para marcar `[class.active]` en el botón correspondiente,
   * así el visual refleja la decisión actual.
   */
  effectiveServiceLocation(): ServiceLocation {
    const choice = this.userChoice();
    if (choice) return choice;
    return this.showHomeOption() ? 'home' : 'shop';
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

import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { HospitalityVatExemptServicesPageComponent } from '../../hospitality/reservations/pages/vat-exempt-services-page/vat-exempt-services-page.component';
import { SettingsSectionComponent } from '../general/components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../general/services/general-settings.store';
import { PosInvoicingSettingsSection } from './pos-invoicing-settings.section';
import { FISCAL_SETTINGS_TEMPLATE } from './fiscal-settings.template';

/**
 * Página de configuración de FACTURACIÓN. Su primera sección es «Emisión
 * automática de factura» (`pos-invoicing-settings.section.ts`: flags
 * `invoicing.pos` / `invoicing.ecommerce`). Las reglas AIU se definen por
 * documento o en Perfiles de facturación, no como preferencia de la tienda.
 * La pestaña «Venta» ya no monta el bloque de emisión: hay un solo control por
 * flag, y es éste.
 *
 * Con industria «Hotelería» suma la sección «Servicios exentos de IVA» (R3),
 * con la misma visibilidad por industria que la pestaña «Hotelería».
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [
    IconComponent,
    RouterLink,
    PosInvoicingSettingsSection,
    SettingsSectionComponent,
    HospitalityVatExemptServicesPageComponent,
  ],
  template: FISCAL_SETTINGS_TEMPLATE,
  styleUrls: ['../general/pages/_settings-page.scss'],
})
export class FiscalSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);

  /** `#section-vat-exempt` from the old Hotelería URL; the router has no anchor scrolling. */
  private readonly fragment = inject(ActivatedRoute).snapshot.fragment;

  /** Scroll once the report renders, otherwise the page may be too short to reach it. */
  protected scrollToFragment(): void {
    if (this.fragment) document.getElementById(this.fragment)?.scrollIntoView({ block: 'start' });
  }
}

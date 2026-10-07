import { Component } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { AiuSettingsSection } from './aiu-settings.section';
import { PosInvoicingSettingsSection } from './pos-invoicing-settings.section';

/**
 * Página de configuración de FACTURACIÓN. Su primera sección es «Emisión
 * automática de factura» (`pos-invoicing-settings.section.ts`: flags
 * `invoicing.pos` / `invoicing.ecommerce`), seguida del Régimen AIU. La
 * pestaña «Venta» ya no monta el bloque de emisión: hay un solo control por
 * flag, y es éste.
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [IconComponent, PosInvoicingSettingsSection, AiuSettingsSection],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="receipt" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Configuración fiscal de la tienda.</span>
          Define si la venta emite su factura electrónica sola y el régimen AIU
          que el emisor declara al firmar un documento.
        </p>
      </div>

      <app-pos-invoicing-settings-section></app-pos-invoicing-settings-section>

      <app-aiu-settings-section></app-aiu-settings-section>
    </div>
  `,
  styleUrls: ['../general/pages/_settings-page.scss'],
})
export class FiscalSettingsPage {}

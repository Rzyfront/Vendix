import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { PosInvoicingSettingsSection } from './pos-invoicing-settings.section';
import { FISCAL_SETTINGS_TEMPLATE } from './fiscal-settings.template';

/**
 * Página de configuración de FACTURACIÓN. Su primera sección es «Emisión
 * automática de factura» (`pos-invoicing-settings.section.ts`: flags
 * `invoicing.pos` / `invoicing.ecommerce`). Las reglas AIU se definen por
 * documento o en Perfiles de facturación, no como preferencia de la tienda.
 * La pestaña «Venta» ya no monta el bloque de emisión: hay un solo control por
 * flag, y es éste.
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [IconComponent, RouterLink, PosInvoicingSettingsSection],
  template: FISCAL_SETTINGS_TEMPLATE,
  styleUrls: ['../general/pages/_settings-page.scss'],
})
export class FiscalSettingsPage {}


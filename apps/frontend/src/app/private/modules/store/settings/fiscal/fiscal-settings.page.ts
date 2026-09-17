import { Component } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { AiuSettingsSection } from './aiu-settings.section';

/**
 * Página de configuración FISCAL — hoy sólo aloja el Régimen AIU. El bloque
 * de facturación del POS (antes una segunda pestaña "Caja") se retiró de
 * aquí: ya vive en Configuración → General → Venta
 * (`pos-invoicing-settings.section.ts`, montado desde `sales-settings.page.ts`),
 * y mantenerlo también aquí era un segundo control del mismo flag
 * (`invoicing.pos.auto_emit`).
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [IconComponent, AiuSettingsSection],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="receipt" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Configuración fiscal de la tienda.</span>
          El régimen AIU afecta lo que el emisor electrónico declara cuando
          firma un documento.
        </p>
      </div>

      <app-aiu-settings-section></app-aiu-settings-section>
    </div>
  `,
  styleUrls: ['../general/pages/_settings-page.scss'],
})
export class FiscalSettingsPage {}

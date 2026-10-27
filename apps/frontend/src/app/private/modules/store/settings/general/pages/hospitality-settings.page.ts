import { Component, inject } from '@angular/core';

import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { HospitalitySettingsForm } from '../components/hospitality-settings-form/hospitality-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Hotelería» — industria hospitality (H0.5).
 *
 * Igual que «Mesas»: sin guard de industria en la ruta (la cascada de
 * industrias puede no estar hidratada); el shell oculta la pestaña y la página
 * avisa si la tienda no es un hotel.
 */
@Component({
  selector: 'app-hospitality-settings-page',
  standalone: true,
  imports: [
    IconComponent,
    AlertBannerComponent,
    SettingsSectionComponent,
    HospitalitySettingsForm,
  ],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="hotel" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Opera el hotel.</span>
          Define a qué hora llegan y salen los huéspedes y el número RNT del
          establecimiento.
        </p>
      </div>

      @if (!store.isHospitality()) {
        <app-alert-banner variant="info" icon="info">
          Estos ajustes sólo surten efecto en tiendas con industria
          «Hotelería». Agrégala en Negocio → Tipos de Negocio para que la
          pestaña aparezca en el menú de secciones.
        </app-alert-banner>
      }

      <app-settings-section
        anchorId="section-hospitality"
        icon="hotel"
        iconTone="teal"
        title="Hotelería"
        hint="Las horas usan la zona horaria de la tienda.">
        <app-hospitality-settings-form
          [settings]="
            store.settings().hospitality || {
              check_in_time: '15:00',
              check_out_time: '12:00',
              no_show_time: '06:00',
              rnt_number: '',
              default_overbooking_allowance: 0
            }
          "
          (settingsChange)="store.onSectionChange('hospitality', $event)" />
      </app-settings-section>
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class HospitalitySettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}

import { Component, inject } from '@angular/core';

import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { RestaurantSettingsForm } from '../components/restaurant-settings-form/restaurant-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Mesas» — industria restaurante.
 *
 * **Sin guard de industria en la ruta.** `AuthFacade.isRestaurant` sale de una
 * cascada (settings → login → []) que puede no estar hidratada cuando corre un
 * guard, y guardear sobre estado no hidratado produce redirecciones falsas. La
 * pestaña se oculta cuando no aplica —eso lo decide el shell—, el deep-link
 * sigue resolviendo y la página renderiza normal; si la tienda no es un
 * restaurante, un aviso explica a quién le sirve la sección.
 */
@Component({
  selector: 'app-tables-settings-page',
  standalone: true,
  imports: [
    IconComponent,
    AlertBannerComponent,
    SettingsSectionComponent,
    RestaurantSettingsForm,
  ],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="utensils" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Gobierna el salón.</span>
          Define qué puede hacer el comensal cuando escanea el QR de su mesa y si
          la cuenta se puede cerrar sin pasar por el mesero.
        </p>
      </div>

      @if (!store.isRestaurant()) {
        <app-alert-banner variant="info" icon="info">
          Estos ajustes sólo surten efecto en tiendas con industria
          «Restaurante». Agrégala en Negocio → Tipos de Negocio para que la
          pestaña aparezca en el menú de secciones.
        </app-alert-banner>
      }

      <app-settings-section
        anchorId="section-restaurant"
        icon="utensils"
        iconTone="teal"
        title="Mesas"
        hint="El checkout por mesa permite al comensal pagar su cuenta sin llamar al mesero.">
        <app-restaurant-settings-form
          [settings]="
            store.settings().restaurant || { enable_table_checkout: false }
          "
          (settingsChange)="store.onSectionChange('restaurant', $event)" />
      </app-settings-section>
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class TablesSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}

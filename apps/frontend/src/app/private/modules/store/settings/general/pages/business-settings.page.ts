import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AppSettingsForm } from '../components/app-settings-form/app-settings-form.component';
import { GeneralSettingsForm } from '../components/general-settings-form/general-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Negocio»: quién es la tienda y cómo se ve.
 *
 * Reúne las secciones «Identidad y General» y «Personalización» de la vista
 * monolítica. Es la única página que habla con `GeneralSettingsForm`, y por eso
 * la que cablea el puente de `services` y de validez hacia el store: con rutas
 * hijas el formulario se desmonta al cambiar de pestaña, así que guardar desde
 * cualquier otra pestaña ya no puede leerlo por `viewChild`.
 */
@Component({
  selector: 'app-business-settings-page',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SettingToggleComponent,
    SettingsSectionComponent,
    GeneralSettingsForm,
    AppSettingsForm,
  ],
  templateUrl: './business-settings.page.html',
  styleUrls: ['./_settings-page.scss', './business-settings.page.scss'],
})
export class BusinessSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
  private readonly authFacade = inject(AuthFacade);

  /** Only the owner turns the Apps module on or off (apps-module S7/T8). */
  protected readonly canToggleApps = computed(() => this.authFacade.isOwner());

  protected readonly appsEnabled = computed(
    () => this.store.settings().apps?.enabled === true,
  );

  /** Saves immediately; the sidebar reacts through the auth store. */
  protected onAppsToggle(enabled: boolean): void {
    if (enabled === this.appsEnabled()) return;
    this.store.saveSectionNow('apps', { enabled });
  }
}

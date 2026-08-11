import { Component, inject } from '@angular/core';

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
    IconComponent,
    SettingsSectionComponent,
    GeneralSettingsForm,
    AppSettingsForm,
  ],
  templateUrl: './business-settings.page.html',
  styleUrls: ['./_settings-page.scss', './business-settings.page.scss'],
})
export class BusinessSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}

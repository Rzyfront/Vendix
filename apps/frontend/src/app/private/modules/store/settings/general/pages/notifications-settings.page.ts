import { Component, inject } from '@angular/core';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { NotificationsSettingsForm } from '../components/notifications-settings-form/notifications-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Notificaciones»: qué avisa la tienda y por dónde.
 */
@Component({
  selector: 'app-notifications-settings-page',
  standalone: true,
  imports: [IconComponent, SettingsSectionComponent, NotificationsSettingsForm],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="bell" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Elige qué te interrumpe.</span>
          Apagar un canal deja de avisar a todo el equipo de la tienda, no sólo a
          ti: el evento sigue ocurriendo, pero nadie lo ve llegar.
        </p>
      </div>

      <app-settings-section
        anchorId="section-notifications"
        icon="bell"
        iconTone="purple"
        title="Notificaciones"
        hint="Aplica a toda la tienda; cada usuario puede afinar sus preferencias en su perfil.">
        <app-notifications-settings-form
          [settings]="store.settings().notifications"
          (settingsChange)="store.onSectionChange('notifications', $event)" />
      </app-settings-section>
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class NotificationsSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}

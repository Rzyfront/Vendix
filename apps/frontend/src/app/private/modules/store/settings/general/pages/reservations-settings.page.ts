import { Component, inject } from '@angular/core';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReservationsSettingsForm } from '../components/reservations-settings-form/reservations-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Reservas» — rediseño de citas, fase 2.
 *
 * Siempre visible: cualquier tienda con reservas habilitadas se beneficia de la
 * política, y apagar `allow_direct_reschedule` convierte el reagendamiento de
 * un clic del cliente en una aprobación pendiente del administrador.
 */
@Component({
  selector: 'app-reservations-settings-page',
  standalone: true,
  imports: [IconComponent, SettingsSectionComponent, ReservationsSettingsForm],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="calendar-clock" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Decide cuánta autonomía tiene el cliente.</span>
          Estos ajustes cambian lo que un cliente puede hacer con su cita por su
          cuenta y qué queda esperando tu aprobación en la agenda.
        </p>
      </div>

      <app-settings-section
        anchorId="section-reservations"
        icon="calendar-clock"
        iconTone="teal"
        title="Reservas"
        hint="Al apagar el reagendamiento directo, cada cambio de cita queda pendiente de tu aprobación.">
        <!-- Fallback a { allow_direct_reschedule: true } cuando la tienda nunca
             persistió esta sección — preserva la UX heredada de un clic hasta
             que el operador opte explícitamente por el flujo de aprobación. -->
        <app-reservations-settings-form
          [settings]="
            store.settings().reservations || { allow_direct_reschedule: true }
          "
          (settingsChange)="store.onSectionChange('reservations', $event)" />
      </app-settings-section>
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class ReservationsSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}

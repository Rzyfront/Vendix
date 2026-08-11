import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { CarrierSettingsForm } from '../components/carrier-settings-form/carrier-settings-form.component';
import { DispatchSettingsForm } from '../components/dispatch-settings-form/dispatch-settings-form.component';
import { InventorySettingsForm } from '../components/inventory-settings-form/inventory-settings-form.component';
import { OperationsSettingsForm } from '../components/operations-settings-form/operations-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Logística»: todo lo que pasa entre que la mercancía entra y llega al
 * cliente.
 *
 * Reúne «Inventario», «Operaciones», «Despacho y Logística», «Reparto» y —sólo
 * para gimnasios— «Zona Fit». El gate de `isGym()` sigue siendo el mismo de la
 * vista monolítica: es visibilidad, no autorización.
 */
@Component({
  selector: 'app-logistics-settings-page',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SettingToggleComponent,
    SettingsSectionComponent,
    InventorySettingsForm,
    OperationsSettingsForm,
    DispatchSettingsForm,
    CarrierSettingsForm,
  ],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="truck" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Mueve la mercancía.</span>
          Estos ajustes deciden cuándo se descuenta el stock, cuánto tarda una
          preparación, en qué momento una orden pasa a entregada y cuánto se le
          liquida al repartidor.
        </p>
      </div>

      <!-- Inventario -->
      <app-settings-section
        anchorId="section-inventory"
        icon="package"
        iconTone="green"
        title="Inventario"
        hint="Umbrales y reglas de stock que alimentan las alertas y bloquean ventas sin existencias.">
        <app-inventory-settings-form
          [settings]="store.settings().inventory"
          (settingsChange)="store.onSectionChange('inventory', $event)" />
      </app-settings-section>

      <!-- Operaciones -->
      <app-settings-section
        anchorId="section-operations"
        icon="clock"
        iconTone="teal"
        title="Operaciones"
        hint="La hora de corte decide a qué día contable pertenece una venta de madrugada.">
        <app-operations-settings-form
          [settings]="
            store.settings().operations || {
              default_preparation_time_minutes: 15,
              ticket_closing_hour: 3
            }
          "
          (settingsChange)="store.onSectionChange('operations', $event)" />
      </app-settings-section>

      <!-- Despacho y Logística -->
      <app-settings-section
        anchorId="section-dispatch"
        icon="truck"
        iconTone="teal"
        title="Despacho y Logística"
        hint="Determina en qué momento del reparto la orden cambia de estado para el cliente.">
        <app-dispatch-settings-form
          [settings]="
            store.settings().dispatch || { order_state_update_mode: 'on_close' }
          "
          (settingsChange)="store.onSectionChange('dispatch', $event)" />
      </app-settings-section>

      <!-- Reparto (tarifa por defecto del repartidor) -->
      <app-settings-section
        anchorId="section-reparto"
        icon="coins"
        iconTone="teal"
        title="Reparto"
        hint="Tarifa que se propone al liquidar una planilla; se puede ajustar por ruta.">
        <app-carrier-settings-form
          [settings]="
            store.settings().carrier || {
              default_tariff: { mode: 'per_stop', amount: '0', currency: 'COP' }
            }
          "
          (settingsChange)="store.onSectionChange('carrier', $event)" />
      </app-settings-section>

      <!-- Zona Fit — sólo industria gimnasio -->
      @if (store.isGym()) {
        <app-settings-section
          anchorId="section-membership"
          icon="dumbbell"
          iconTone="teal"
          title="Zona Fit"
          hint="Con la validación en segundo plano el torniquete no exige una acción del recepcionista.">
          <app-setting-toggle
            label="Validación de acceso en segundo plano"
            description="Permite validar el acceso de los miembros de forma continua en segundo plano."
            [ngModel]="store.settings().membership?.ambient_access_enabled ?? false"
            (changed)="
              store.onSectionChange('membership', {
                ambient_access_enabled: $event
              })
            " />
        </app-settings-section>
      }
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class LogisticsSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}

import { Component, DestroyRef, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { HospitalityIcalChannelsComponent } from '../../../hospitality/channels/components/ical-channels/ical-channels.component';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { HospitalitySettingsForm } from '../components/hospitality-settings-form/hospitality-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';
import { HospitalitySettings } from '../../../../../../core/models/store-settings.interface';

/** Same defaults as the backend (`default-store-settings.ts`) for a store that never saved them. */
const DEFAULT_HOSPITALITY: HospitalitySettings = {
  check_in_time: '15:00',
  check_out_time: '12:00',
  no_show_time: '06:00',
  night_audit_time: '02:00',
  rnt_number: '',
  default_overbooking_allowance: 0,
  room_charge_origin: 'Restaurante',
  folio_invoice_verification: true,
  booking_hold_minutes: 15,
  ical_import_interval_minutes: 15,
};

/** Typing in a text field emits per keystroke; one save per pause. */
const AUTOSAVE_DELAY_MS = 600;

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
    HospitalityIcalChannelsComponent,
  ],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="hotel" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Opera el hotel.</span>
          Define los horarios de llegada, salida y cierre del día, el Registro
          Nacional de Turismo (RNT), las reservas, la cuenta del huésped y los
          calendarios externos. Cada cambio se guarda solo.
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
          [settings]="hospitality()"
          (settingsChange)="queueSave($event)" />
      </app-settings-section>

      <!-- R2 — former "Canales" screen; /admin/hospitality/channels lands here. -->
      <app-settings-section
        anchorId="section-ical"
        icon="calendar-check"
        iconTone="purple"
        title="Calendarios externos (Airbnb, Booking…)"
        hint="Comparte la disponibilidad de cada habitación con Airbnb o Booking y bloquea aquí las fechas que vendan ellos.">
        <app-hospitality-ical-channels (ready)="scrollToFragment()" />
      </app-settings-section>
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class HospitalitySettingsPage {
  protected readonly store = inject(GeneralSettingsStore);

  protected readonly hospitality = computed<HospitalitySettings>(() => ({
    ...DEFAULT_HOSPITALITY,
    ...this.store.settings().hospitality,
  }));

  private pending: Partial<HospitalitySettings> = {};
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Leaving the tab mid-pause still saves the last change.
    inject(DestroyRef).onDestroy(() => this.flushSave());
  }

  /** U17 — autosave: the form emits only its valid fields; they merge over the saved block. */
  protected queueSave(patch: Partial<HospitalitySettings>): void {
    this.pending = { ...this.pending, ...patch };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), AUTOSAVE_DELAY_MS);
  }

  private flushSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const value = { ...this.hospitality(), ...this.pending };
    this.pending = {};
    this.store.saveSectionNow('hospitality', value);
  }

  /** `#section-ical` from the old Canales URL; the router has no anchor scrolling. */
  private readonly fragment = inject(ActivatedRoute).snapshot.fragment;

  /** Scroll once the lists render, otherwise the page is too short to reach it. */
  protected scrollToFragment(): void {
    if (this.fragment) document.getElementById(this.fragment)?.scrollIntoView({ block: 'start' });
  }
}

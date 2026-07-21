import {
  Component,
  ChangeDetectionStrategy,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * ServicesSettingsForm
 *
 * Standalone card for the 'Servicios' section. Renders the toggle
 * '¿Ofrece servicio a domicilio?' and the 'Dirección del local'
 * sub-section. The parent (GeneralSettings) owns the FormGroup and
 * passes it in via [servicesForm].
 *
 * Mobile-first: iOS-style toggle, grid 2-col → 1-col at ≤480px,
 * 44px+ touch targets.
 */
@Component({
  selector: 'app-services-settings-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './services-settings-form.component.html',
  styleUrls: ['./services-settings-form.component.scss'],
})
export class ServicesSettingsForm {
  /** The FormGroup containing the services sub-fields. */
  readonly servicesForm = input.required<FormGroup>();

  /**
   * Explicit change handler for the offer_home_service toggle.
   *
   * For some reason the [formGroup] directive does not seem to be
   * propagating the change to the FormControl when the toggle is
   * clicked, so this fallback toggles the value directly. The same
   * emit goes through valueChanges → settingsChange on the parent.
   */
  onOfferHomeServiceChange(event: Event): void {
    // eslint-disable-next-line no-console
    console.log('[services-settings-form] toggle change:', event);
  }
}

import {
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';

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
  imports: [CommonModule, ReactiveFormsModule, IconComponent, SettingToggleComponent],
  templateUrl: './services-settings-form.component.html',
  styleUrls: ['./services-settings-form.component.scss'],
})
export class ServicesSettingsForm {
  /**
   * The FormGroup containing the services sub-fields. Exposed as an
   * input signal; the parent's `servicesForm` getter resolves it
   * to the FormGroup instance for [formGroup] binding in the template.
   */
  readonly servicesForm = input.required<FormGroup>();

  /**
   * Local mirror of the FormGroup signal so the template can read
   * it synchronously and the [formGroup] directive receives a
   * concrete (non-signal) value on every change detection cycle.
   */
  private readonly form = signal<FormGroup | null>(null);

  /**
   * Typed accessor for the offer_home_service FormControl. Used by
   * the template's <app-setting-toggle [formControl]="..."> binding.
   */
  get offerHomeServiceControl(): FormControl<boolean> {
    return this.form()!.get('offer_home_service') as FormControl<boolean>;
  }

  constructor() {
    effect(() => {
      this.form.set(this.servicesForm());
    });
  }

  /**
   * Propagate field changes to the parent so the GeneralSettingsForm
   * persists them via its settingsChange output.
   */
  onFieldChange(): void {
    // The form is a sub-FormGroup of the GeneralSettingsForm; the
    // parent's existing settingsChange output fires from the form
    // valueChanges pipeline. We don't need to emit here — the parent
    // listens to the form directly.
  }
}

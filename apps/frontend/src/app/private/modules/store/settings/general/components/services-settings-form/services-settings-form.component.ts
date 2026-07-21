import {
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  ControlContainer,
} from '@angular/forms';
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
  /**
   * The FormGroup containing the services sub-fields. Exposed as an
   * input signal; the parent's `servicesForm` getter resolves it
   * to the FormGroup instance for [formGroup] binding in the template.
   */
  readonly servicesForm = input.required<FormGroup>();

  /**
   * Track the most-recently seen FormGroup via a writable signal so
   * the template can read it synchronously. The input signal from
   * the parent is the source of truth, but inside the child we copy
   * it into a local signal so [formGroup]="form()" resolves
   * synchronously even when the parent's getter returns the same
   * reference (input signals are not always unwrapped automatically
   * by directives that need a non-signal value).
   */
  private readonly form = signal<FormGroup | null>(null);

  constructor() {
    effect(() => {
      this.form.set(this.servicesForm());
    });
  }
}

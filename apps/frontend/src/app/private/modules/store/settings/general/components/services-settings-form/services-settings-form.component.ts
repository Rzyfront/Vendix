import {
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
  signal,
  DestroyRef,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
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
  imports: [CommonModule, ReactiveFormsModule, IconComponent, SettingToggleComponent, SelectorComponent],
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
   * Cache the FormGroup as a local signal so the template can read
   * it synchronously and the [formGroup] directive receives a
   * concrete (non-signal) value on every change detection cycle.
   * The parent's servicesForm input signal is the source of truth
   * but it can only be read as a function (this.servicesForm()),
   * so we cache the resolved value here.
   */
  readonly form = signal<FormGroup | null>(null);

  /**
   * Reactive signal of the offer_home_service FormControl value.
   * The FormControl itself isn't a signal, but we project its
   * valueChanges Observable into a signal so the disable/enable
   * effect below can react to user toggles in real time.
   */
  private readonly offerHomeServiceValue = signal<boolean | null>(null);

  /**
   * Typed accessor for the offer_home_service FormControl.
   */
  get offerHomeServiceControl(): FormControl<boolean> {
    return this.form()!.get('offer_home_service') as FormControl<boolean>;
  }

  /**
   * Typed accessor for the local_address sub-FormGroup.
   */
  get localAddressGroup(): FormGroup {
    return this.form()!.get('local_address') as FormGroup;
  }

  constructor() {
    // Cache the FormGroup from the input signal so the template and
    // effects can read it synchronously without invoking a function
    // call on every change detection cycle.
    effect(() => {
      this.form.set(this.servicesForm());
    });

    // Project offer_home_service's valueChanges into a local signal so
    // the parent (BookingComponent) can react to the toggle in real
    // time. The address fields stay editable regardless of the toggle
    // because the local address is the dispatch origin for BOTH
    // 'En el local' and 'A domicilio' flows.
    effect((onCleanup) => {
      const root = this.form();
      if (!root) return;
      const sub = root
        .get('offer_home_service')
        ?.valueChanges.subscribe((v: boolean | null) => {
          this.offerHomeServiceValue.set(v);
        });
      onCleanup(() => sub?.unsubscribe());
    });

    // Load departments once for Colombia. Most LATAM stores default
    // to CO; if the user changes country later we re-load.
    this.countryService.getDepartments().then((d) => this.departments.set(d));

    // Reload cities whenever the user picks a department.
    effect((onCleanup) => {
      const root = this.form();
      if (!root) return;
      const sub = root
        .get('state_province')
        ?.valueChanges.subscribe((depName: string) => {
          const dep = this.departments().find((d) => d.name === depName);
          if (dep) {
            this.countryService
              .getCitiesByDepartment(dep.id)
              .then((c) => this.cities.set(c));
          } else {
            this.cities.set([]);
          }
        });
      onCleanup(() => sub?.unsubscribe());
    });
  }

  /**
   * Apply Required validators on the three mandatory address fields
   * (calle, ciudad, país). The address is always required because:
   * - 'En el local' needs the shop address to show where the
   *   customer should go.
   * - 'A domicilio' needs the same address as the dispatch origin.
   *
   * updateValueAndValidity({ emitEvent: false }) so the status
   * change doesn't fire valueChanges for every field on every
   * patchValue cycle.
   */
  private applyAddressValidation(required: boolean): void {
    const address = this.localAddressGroup;
    const fields = ['address_line1', 'city', 'country_code'] as const;
    for (const name of fields) {
      const ctrl = address.get(name) as FormControl;
      if (!ctrl) continue;
      ctrl.setValidators(required ? [Validators.required] : []);
      ctrl.updateValueAndValidity({ emitEvent: false });
    }
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

import {
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
  signal,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import {
  CountryService,
  Country,
  Department,
  City,
} from '../../../../../../../services/country.service';

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
  /** Inject the CountryService to load departments + cities for
   * the País / Departamento / Ciudad selectors. Same service the
   * ecommerce address-modal uses, so the data and the auth context
   * match. */
  private readonly countryService = inject(CountryService);

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

  /** Countries + departments + cities for the local-address selectors. */
  readonly countries = signal<Country[]>(this.countryService.getCountries());
  readonly departments = signal<Department[]>([]);
  readonly cities = signal<City[]>([]);

  /** DELETED: lastLoadedState guard — caused re-entry bug, removed. */

  /** Guard so the city-loading effect re-fetches only when state_province
   * actually changes, not on every unrelated effect tick. */
  
  /**
   * SelectorOption[] derivations for the <app-selector> bindings.
   * The form's country_code / state_province / city controls store
   * the human-readable `name` (not the `id`), so we map `value` to
   * the same field used as label. (Swap these mappings if the parent
   * ever migrates to id-stored values.)
   */
  readonly countryOptions = computed<SelectorOption[]>(() =>
    this.countries().map((c) => ({ value: c.code, label: c.name })),
  );
  readonly departmentOptions = computed<SelectorOption[]>(() =>
    this.departments().map((d) => ({ value: d.name, label: d.name })),
  );
  readonly cityOptions = computed<SelectorOption[]>(() =>
    this.cities().map((c) => ({ value: c.name, label: c.name })),
  );

  /**
   * Typed accessor for the offer_home_service FormControl.
   */
  get offerHomeServiceControl(): FormControl<boolean> {
    return this.form()!.get('offer_home_service') as FormControl<boolean>;
  }

  /**
   * Signal that mirrors the state_province control's value.
   *
   * NOTE: a previous version used `toSignal(valueChanges, { initialValue })`
   * as a CLASS FIELD. That was broken because class fields run BEFORE the
   * constructor — at that point `this.form()` is null, so the
   * `valueChanges` was undefined and we fell back to `of(null)`. The
   * observable was bound to that empty `of(null)` forever; even after
   * the constructor's effect populated `this.form`, stateValue stayed
   * null. The current implementation initializes the signal lazily
   * inside the constructor (where `this.form()` is available) and
   * syncs both the initial value and live changes from the control.
   */
  private readonly stateValue = signal<string | null>(null);

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

    // Sync stateValue from the form control. Runs whenever the form
    // becomes available (signal change) or whenever state_province's
    // valueChanges fires. Replaces the broken `toSignal` class-field
    // pattern that was bound to an empty `of(null)` because class
    // fields evaluate before the constructor.
    effect((onCleanup) => {
      const root = this.form();
      if (!root) return;
      const stateControl = root
        .get('local_address')
        ?.get('state_province');
      if (!stateControl) return;

      // Sync current value once (covers initial mount AND the case
      // where the parent patched the control with emitEvent: false —
      // valueChanges doesn't fire for those, but `.value` does have
      // the latest data).
      const current = stateControl.value as string | null;
      if (this.stateValue() !== current) {
        this.stateValue.set(current);
      }

      const sub = stateControl.valueChanges.subscribe(
        (v: string | null) => this.stateValue.set(v),
      );
      onCleanup(() => sub?.unsubscribe());
    }, { allowSignalWrites: true });

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

    // Reload cities whenever state_province changes. Reading the
    // value via the control (not valueChanges.subscribe) is critical:
    // the form is patched with `emitEvent: false` on initial mount
    // (so valueChanges doesn't fire for the pre-populated value),
    // and a valueChanges subscription would miss that case entirely,
    // leaving the city dropdown empty until the user manually
    // re-selects the same department. The `lastLoadedState` flag
    // ensures we only hit the API once per actual value change.
    // Read state_province via stateValue (the manual signal updated
    // in the constructor's sync effect). This effect re-runs whenever
    // the signal updates: initial value at mount + every valueChanges
    // emit, including the parent's `setValue` with emitEvent: true
    // that fires after a silent patchValue.
    effect(() => {
      const value = (this.stateValue() as string) ?? '';
      this.loadCitiesForState(value);
    });

    // Race-condition fix: the effect above fires when state_province
    // changes, but it can fire BEFORE `getDepartments()` resolves
    // (~500ms latency from api-colombia.com). In that case
    // `this.departments()` is still empty → the lookup misses →
    // `cities.set([])` runs and never recovers, because the valueChanges
    // signal won't fire again once departments arrive.
    //
    // This second effect reacts to `this.departments()` directly: when
    // departments finally populate AND there's a current state_province
    // value, re-run the city load. `loadCitiesForState` is idempotent.
    //
    // No `lastLoadedState` guard — see comment in Effect 1 for why.
    effect(() => {
      const deps = this.departments();
      if (!deps.length) return;
      const root = this.form();
      if (!root) return;
      const localAddress = root.get('local_address');
      if (!localAddress) return;
      const depName = localAddress.get('state_province')?.value as string | null;
      this.loadCitiesForState(depName ?? '');
    });
  }

  /**
   * Look up the department by name in the currently-loaded list, then
   * fetch its cities from the API. Centralized so the country effect
   * (post-hydration) and the state effect (subsequent selections)
   * share the same loading logic.
   */
  private loadCitiesForState(depName: string): void {
    if (!depName) {
      this.cities.set([]);
      return;
    }
    const dep = this.departments().find((d) => d.name === depName);
    if (!dep) {
      this.cities.set([]);
      return;
    }
    this.countryService
      .getCitiesByDepartment(dep.id)
      .then((c: City[]) => this.cities.set(c))
      .catch((err) => {
        console.error(
          `[services-settings] Failed to load cities for "${depName}" (id=${dep.id})`,
          err,
        );
        this.cities.set([]);
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

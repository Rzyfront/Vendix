import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged, startWith } from 'rxjs/operators';

import { AddressMapPickerComponent } from '../../../private/modules/ecommerce/components/address-map-picker/address-map-picker.component';
import {
  GeocodingService,
  NormalizedAddress,
} from '../../../private/modules/ecommerce/services/geocoding.service';
import { InputComponent } from '../input/input.component';
import { IconComponent } from '../icon/icon.component';
import { DianMunicipalitySelectComponent } from '../dian-municipality-select/dian-municipality-select.component';
import {
  DianMunicipalityLookupService,
  DianMunicipalityOption,
} from '../../services/dian-municipality-lookup.service';

/** País cuyo catálogo Divipola gobierna este formulario. */
const COLOMBIA_COUNTRY_CODE = 'CO';

/** Lat/lng pair — mirrors AddressMapPickerComponent.LatLng (not exported there). */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Plain address object used both as `initialAddress` input and as the payload
 * emitted by `addressChange`. Keys mirror the `addresses` table columns
 * (address_line1, state_province, country_code, ...) so a customer address
 * snapshot can be round-tripped without remapping.
 */
export interface AddressPayload {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  country_code: string | null;
  postal_code: string | null;
  phone_number: string | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * Código DANE (Divipola) del municipio → columna
   * `addresses.municipality_code`.
   *
   * OPCIONAL en la interfaz a propósito, por dos razones distintas:
   *
   * 1. La captura general de direcciones no lo exige y las direcciones
   *    históricas lo tienen en NULL — hacerlo obligatorio rompería toda alta de
   *    dirección no fiscal. Quien lo exige es el camino de facturación, que ya
   *    lanza `CITY_CODE_REQUIRED` cuando falta.
   * 2. Marcarlo requerido obligaría a tocar todos los consumidores que
   *    construyen un `AddressPayload` literal (despacho, rutas, checkout, POS).
   */
  municipality_code?: string | null;
}

/**
 * Reusable shipping/delivery address form with optional collapsible map.
 *
 * - Reactive form (NO ngModel) with the same syntactic validators as the
 *   checkout address form (see checkout.component.ts l.419-446).
 * - Optional map: `app-address-map-picker` (already standalone) is imported
 *   as a child and shown only when `showMap()` is true.
 * - Reverse-geocode on map locate re-fills the textual fields (same flow as
 *   checkout `applyReverseGeocode` / `prefillFromGeocode`).
 * - Forward-geocode on typed `address_line1` (debounced 500ms) silently sets
 *   latitude/longitude; failure sets `addressWarning` (NON-blocking).
 * - Emits `addressChange` on every form change and `validChange` on every
 *   status change so the parent can gate save/next buttons.
 *
 * Zoneless + Signals: no NgZone, no markForCheck, no @Input/@Output. Any
 * `subscribe` uses `takeUntilDestroyed(this.destroyRef)`.
 */
@Component({
  selector: 'app-address-form-fields',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AddressMapPickerComponent,
    InputComponent,
    IconComponent,
    DianMunicipalitySelectComponent,
  ],
  templateUrl: './address-form-fields.component.html',
  styleUrls: ['./address-form-fields.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
})
export class AddressFormFieldsComponent {
  /** Address to prefill the form with (edición). Null on create. */
  readonly initialAddress = input<AddressPayload | null>(null);
  /** Optional map center coordinate (e.g. existing lat/lng or GPS fix). */
  readonly center = input<LatLng | null>(null);
  /**
   * Opt-in: when true, `phone_number` becomes REQUIRED and therefore affects
   * `validChange` / `form.valid`. Default false keeps the historical behavior
   * for existing consumers (customer-modal, dispatch-note editor, shipping
   * address modal) — phone stays optional there.
   */
  readonly requirePhone = input<boolean>(false);
  /**
   * Opt-in: when true, the component renders inline error feedback for the
   * required fields (and phone when {@link requirePhone} is set) and marks the
   * form as touched. Default false → no visual change for existing consumers.
   */
  readonly showErrors = input<boolean>(false);

  /** Emits the full form value on every change. */
  readonly addressChange = output<AddressPayload>();
  /** Emits the form's `valid` status on every status change. */
  readonly validChange = output<boolean>();

  /** Toggles the collapsible map section. */
  readonly showMap = signal(false);
  /** Non-blocking warning (e.g. forward-geocode failed). Never gates saving. */
  readonly addressWarning = signal<string | null>(null);
  /** Coordinate derived from the form (lat/lng controls or map center). */
  readonly coordsSignal = signal<LatLng | null>(null);
  /** True while reverse-geocoding a map locate. */
  readonly reverseLoading = signal(false);

  private readonly fb = inject(FormBuilder);
  private readonly geocoding = inject(GeocodingService);
  private readonly municipalities = inject(DianMunicipalityLookupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup = this.fb.group({
    address_line1: [
      null as string | null,
      [Validators.required, Validators.minLength(5), Validators.maxLength(150)],
    ],
    address_line2: [null as string | null, [Validators.maxLength(100)]],
    city: [null as string | null, [Validators.required]],
    state_province: [null as string | null, [Validators.required]],
    country_code: ['CO' as string, [Validators.required]],
    postal_code: [null as string | null, [Validators.maxLength(20)]],
    // Código DANE del municipio. SIN validadores: es opcional en la captura
    // general (direcciones no fiscales e históricas viven sin él) y solo el
    // camino de facturación lo exige. Ponerle `required` aquí bloquearía el
    // guardado de toda dirección de envío del sistema.
    municipality_code: [null as string | null],
    phone_number: [
      null as string | null,
      [Validators.pattern(/^[\d+#*\s()-]*$/)],
    ],
    // Hidden coordinates. No validators so they never affect form.valid.
    latitude: [null as number | null],
    longitude: [null as number | null],
  });

  /**
   * Zoneless bridge of the form's status → signal. ReactiveForms status is a
   * plain property, not a signal; reading it inside a computed would never
   * recompute. `toSignal(statusChanges)` makes per-control validity reactive so
   * the inline error blocks (below) render/refresh in this OnPush component.
   */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  /** Inline-error visibility per required field (only meaningful when `showErrors()`). */
  readonly line1Invalid = computed<boolean>(() => {
    this.formStatus();
    return !!this.form.get('address_line1')?.invalid;
  });
  readonly cityInvalid = computed<boolean>(() => {
    this.formStatus();
    return !!this.form.get('city')?.invalid;
  });
  readonly stateInvalid = computed<boolean>(() => {
    this.formStatus();
    return !!this.form.get('state_province')?.invalid;
  });
  readonly phoneInvalid = computed<boolean>(() => {
    this.formStatus();
    return !!this.form.get('phone_number')?.invalid;
  });

  /**
   * País actual del formulario, como signal. Igual que `formStatus`, el valor
   * de un FormControl es una propiedad plana: leerlo dentro de un `computed`
   * nunca recalcularía, así que se puentea por `valueChanges`.
   */
  private readonly countryCode = toSignal(
    this.form
      .get('country_code')!
      .valueChanges.pipe(
        startWith(this.form.get('country_code')!.value),
      ) as Observable<string | null>,
    // `startWith` emite de forma síncrona al suscribirse, así que el valor real
    // ('CO') llega de inmediato; este `initialValue` solo cubre ese instante.
    { initialValue: null },
  );

  /** Código DANE actualmente puesto en el formulario, como signal. */
  private readonly municipalityCode = toSignal(
    this.form
      .get('municipality_code')!
      .valueChanges.pipe(
        startWith(this.form.get('municipality_code')!.value),
      ) as Observable<string | null>,
    { initialValue: null },
  );

  /**
   * El selector de municipio solo aparece para Colombia: la Divipola es un
   * catálogo colombiano y ofrecerlo en una dirección extranjera sería ofrecer
   * un dato que no existe.
   */
  readonly showMunicipality = computed<boolean>(
    () => (this.countryCode() ?? '').trim().toUpperCase() === COLOMBIA_COUNTRY_CODE,
  );

  /**
   * Ciudad y departamento pasan a solo-lectura en cuanto hay municipio DANE
   * elegido.
   *
   * Es la garantía de coherencia: mientras el código está puesto, los dos
   * textos los escribe el catálogo, así que no puede existir «Medellín /
   * Cundinamarca». Al limpiar el municipio vuelven a ser editables, que es lo
   * que necesitan las direcciones sin dato fiscal y las de otros países.
   */
  readonly cityLockedByMunicipality = computed<boolean>(
    () => this.showMunicipality() && !!this.municipalityCode(),
  );

  constructor() {
    // Prefill when `initialAddress` arrives (create → null, edit → snapshot).
    effect(() => {
      const addr = this.initialAddress();
      if (!addr) return;
      this.form.patchValue(
        {
          address_line1: addr.address_line1 ?? null,
          address_line2: addr.address_line2 ?? null,
          city: addr.city ?? null,
          state_province: addr.state_province ?? null,
          country_code: addr.country_code ?? 'CO',
          postal_code: addr.postal_code ?? null,
          phone_number: addr.phone_number ?? null,
          latitude: addr.latitude ?? null,
          longitude: addr.longitude ?? null,
          municipality_code: addr.municipality_code ?? null,
        },
        // `emitEvent: true` SOLO para municipality_code no es posible en un
        // patchValue conjunto, así que el signal se refresca explícitamente
        // abajo: `municipalityCode` se alimenta de `valueChanges` y con
        // `emitEvent:false` no se enteraría de la precarga, dejando ciudad y
        // departamento editables sobre una dirección que sí tiene código.
        { emitEvent: false },
      );
      this.form
        .get('municipality_code')!
        .setValue(addr.municipality_code ?? null, { emitEvent: true });
      if (addr.latitude != null && addr.longitude != null) {
        this.coordsSignal.set({ lat: addr.latitude, lng: addr.longitude });
      }
    });

    // Keep coordsSignal in sync with the hidden lat/lng controls so the map
    // follows whatever point the form currently has.
    effect(() => {
      const lat = this.form.get('latitude')?.value as number | null;
      const lng = this.form.get('longitude')?.value as number | null;
      if (lat != null && lng != null) {
        this.coordsSignal.set({ lat, lng });
      }
    });

    // Opt-in: make phone_number required when `requirePhone()` is true so it
    // affects form.valid / validChange. Default false leaves the constructor
    // validators untouched → no behavior change for existing consumers.
    effect(() => {
      const require = this.requirePhone();
      untracked(() => this.applyPhoneRequirement(require));
    });

    // Opt-in: when the parent flips `showErrors()` on, mark the form touched so
    // the shared app-input controls surface their own required styling too. The
    // inline error blocks (driven by `showErrors()` + *Invalid computeds) give
    // the immediate feedback that does not depend on child re-render.
    effect(() => {
      if (this.showErrors()) {
        untracked(() => this.form.markAllAsTouched());
      }
    });

    // Emit addressChange + validChange on every value/status change.
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.addressChange.emit(this.form.value as AddressPayload);
      });
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.validChange.emit(this.form.valid);
      });

    // Forward-geocode typed address_line1 (debounced 500ms). Sets lat/lng
    // silently; failure sets a non-blocking warning.
    this.form
      .get('address_line1')!
      .valueChanges.pipe(
        debounceTime(500),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((line1: string | null) => this.forwardGeocodeFromForm(line1));
  }

  /** Toggles the collapsible map section. */
  toggleMap(): void {
    this.showMap.set(!this.showMap());
  }

  /**
   * El operador eligió (o quitó) un municipio DANE.
   *
   * Al elegir, el catálogo pasa a ser la fuente de verdad de `city` y
   * `state_province`: se sobreescriben con el nombre oficial del municipio y de
   * su departamento. Eso es lo que hace imposible una combinación inválida —
   * los dos textos dejan de ser independientes del código.
   *
   * Al quitar, los textos se dejan como estaban (no se borra trabajo del
   * usuario) y vuelven a ser editables.
   */
  onMunicipalitySelected(municipality: DianMunicipalityOption | null): void {
    if (!municipality) {
      this.addressChange.emit(this.form.value as AddressPayload);
      return;
    }
    this.form
      .get('city')
      ?.setValue(municipality.name, { emitEvent: false });
    this.form
      .get('state_province')
      ?.setValue(municipality.department_name, { emitEvent: false });
    this.form.markAsDirty();
    this.addressChange.emit(this.form.value as AddressPayload);
  }

  /**
   * Applies (or removes) the `Validators.required` on `phone_number` depending
   * on `requirePhone`. When required, revalidates with `emitEvent:true` so the
   * parent's `validChange` reflects the stricter gate; when NOT required it
   * restores the constructor validators silently (`emitEvent:false`) so default
   * consumers observe no extra emissions.
   */
  private applyPhoneRequirement(require: boolean): void {
    const phone = this.form.get('phone_number');
    if (!phone) return;
    const pattern = Validators.pattern(/^[\d+#*\s()-]*$/);
    if (require) {
      phone.setValidators([Validators.required, pattern]);
      phone.updateValueAndValidity({ emitEvent: true });
    } else {
      phone.setValidators([pattern]);
      phone.updateValueAndValidity({ emitEvent: false });
    }
  }

  /**
   * Map located (drag/click): store the exact coordinate and reverse-geocode
   * to re-fill the textual fields. Mirrors checkout `applyReverseGeocode` +
   * `prefillFromGeocode` but without the CO department/city ID remapping
   * (this reusable component uses free-text city/state_province).
   */
  onLocated(coords: LatLng): void {
    this.form.get('latitude')?.setValue(coords.lat);
    this.form.get('longitude')?.setValue(coords.lng);
    this.coordsSignal.set(coords);

    this.reverseLoading.set(true);
    this.geocoding
      .reverse(coords.lat, coords.lng)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (address) => this.prefillFromGeocode(address),
        error: () => {
          this.reverseLoading.set(false);
          // Keep the exact coordinate; the user fills the textual address.
        },
      });
  }

  private prefillFromGeocode(address: NormalizedAddress): void {
    // emitEvent:false → reverse fill must NOT re-trigger the forward-geocode
    // watcher on address_line1 (that would fight the map).
    if (address.address_line1) {
      this.form
        .get('address_line1')
        ?.setValue(address.address_line1, { emitEvent: false });
    }
    if (address.address_line2) {
      this.form
        .get('address_line2')
        ?.setValue(address.address_line2, { emitEvent: false });
    }
    if (address.city) {
      this.form.get('city')?.setValue(address.city, { emitEvent: false });
    }
    if (address.state_province) {
      this.form
        .get('state_province')
        ?.setValue(address.state_province, { emitEvent: false });
    }
    if (address.country_code) {
      this.form
        .get('country_code')
        ?.setValue(address.country_code.toUpperCase(), { emitEvent: false });
    }
    if (address.postal_code) {
      this.form
        .get('postal_code')
        ?.setValue(address.postal_code, { emitEvent: false });
    }
    this.form.markAsDirty();
    this.reverseLoading.set(false);
    // Re-emit so the parent sees the reverse-filled values.
    this.addressChange.emit(this.form.value as AddressPayload);
    // El geocodificador devuelve nombres y NUNCA el código DANE
    // (`geocoding.service.ts:440` pone `municipality_code: null` a propósito),
    // así que se traduce aquí. Sin este paso, ubicar la dirección en el mapa
    // dejaría la dirección sin código y la emisión seguiría bloqueada.
    this.resolveMunicipalityFromText();
  }

  /**
   * Traduce los textos `city` + `state_province` a un municipio del catálogo y
   * lo escribe en `municipality_code`.
   *
   * NO bloquea nada y NO pisa una elección previa del operador: si ya hay
   * código puesto, se respeta. Si el catálogo no resuelve, el campo se queda
   * vacío y el selector se lo pedirá al operador — nunca se rellena Bogotá por
   * defecto, que es precisamente el error que el bloqueante existe para evitar.
   */
  private resolveMunicipalityFromText(): void {
    const control = this.form.get('municipality_code');
    if (!control || control.value) return;

    const country = (this.form.get('country_code')?.value as string | null) ?? '';
    if (country.trim().toUpperCase() !== COLOMBIA_COUNTRY_CODE) return;

    const city = (this.form.get('city')?.value as string | null) ?? '';
    const department =
      (this.form.get('state_province')?.value as string | null) ?? '';
    if (!city.trim() || !department.trim()) return;

    this.municipalities
      .resolveByName(city, department)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((municipality) => {
        if (!municipality) return;
        // Otra escritura pudo llegar mientras la petición estaba en vuelo.
        if (control.value) return;
        control.setValue(municipality.code, { emitEvent: true });
        this.form
          .get('city')
          ?.setValue(municipality.name, { emitEvent: false });
        this.form
          .get('state_province')
          ?.setValue(municipality.department_name, { emitEvent: false });
        this.addressChange.emit(this.form.value as AddressPayload);
      });
  }

  /**
   * Forward-geocodes the typed address → coordinate, and re-centers the map
   * on it. Query = line1 + city + "Colombia". The resolved point is stored
   * silently on the hidden lat/lng controls. Failure sets `addressWarning`
   * (NON-blocking — `validChange` is based only on syntactic validators).
   */
  private forwardGeocodeFromForm(line1: string | null): void {
    const base = (line1 ?? '').trim();
    if (base.length < 5) {
      this.addressWarning.set(null);
      return;
    }
    const city = (this.form.get('city')?.value as string | null)?.trim() ?? '';
    const query = [base, city, 'Colombia'].filter(Boolean).join(', ');

    this.geocoding
      .forward(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.lat == null || res?.lng == null) {
            this.addressWarning.set(
              'No pudimos geocodificar la dirección. Verifícala o ubícala en el mapa.',
            );
            return;
          }
          this.addressWarning.set(null);
          this.form
            .get('latitude')
            ?.setValue(res.lat, { emitEvent: false });
          this.form
            .get('longitude')
            ?.setValue(res.lng, { emitEvent: false });
          this.coordsSignal.set({ lat: res.lat, lng: res.lng });
        },
        error: () => {
          // Forward-geocode failed → leave the map as-is; manual form works.
          this.addressWarning.set(null);
        },
      });
  }
}
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
import { Observable, merge } from 'rxjs';
import { debounceTime, map, startWith } from 'rxjs/operators';

import { AddressMapPickerComponent } from '../../../private/modules/ecommerce/components/address-map-picker/address-map-picker.component';
import {
  GeocodePrecision,
  GeocodingService,
  NormalizedAddress,
} from '../../../private/modules/ecommerce/services/geocoding.service';
import { CountryService } from '../../../core/services/country.service';
import { InputComponent } from '../input/input.component';
import { IconComponent } from '../icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../selector/selector.component';
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
  /**
   * True once the operator (or GPS via `onLocated`) placed/dragged the map
   * pin for THIS coordinate — a manual point the operator explicitly set,
   * as opposed to a forward-geocode guess. Optional and purely additive:
   * existing consumers that don't read it are unaffected.
   */
  pin_confirmed?: boolean;
  /**
   * Precision tier of the last forward-geocode result (see
   * `GeocodePrecision`), or `null` when the point came from a confirmed pin
   * or hasn't been resolved yet. Optional and purely additive.
   */
  geocode_precision?: GeocodePrecision | null;
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
    SelectorComponent,
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
  /** POS opt-in: keep optional address fields behind a secondary action. */
  readonly compact = input<boolean>(false);
  /** null follows prefilled data; once toggled, the cashier owns visibility. */
  readonly advancedOverride = signal<boolean | null>(null);
  readonly showAdvanced = computed<boolean>(() =>
    !this.compact() || (this.advancedOverride() ?? (
      !!this.initialAddress()?.address_line2 ||
      !!this.initialAddress()?.postal_code ||
      (this.initialAddress()?.country_code != null &&
        this.initialAddress()?.country_code !== COLOMBIA_COUNTRY_CODE)
    )),
  );
  /** Optional map center coordinate (e.g. existing lat/lng or GPS fix). */
  readonly center = input<LatLng | null>(null);
  /**
   * Base del endpoint DANE a usar para `resolveByName`. Default:
   * `/store/addresses/dian/municipalities` (gateado por `store:addresses:read`).
   * El super-admin org modal pasa `/superadmin/addresses/dian/municipalities`
   * porque su JWT no tiene el permiso de tienda.
   */
  readonly dianEndpointBase = input<string | null>(null);
  /**
   * Opt-in: when true, `phone_number` becomes REQUIRED and therefore affects
   * `validChange` / `form.valid`. Default false keeps the historical behavior
   * for existing consumers (customer-modal, dispatch-note editor, shipping
   * address modal) — phone stays optional there.
   */
  readonly requirePhone = input<boolean>(false);
  /**
   * Opt-out: when false, the phone field is not rendered at all. Default true
   * keeps the historical behavior for every existing consumer.
   *
   * Exists because not every address destination has a phone column: the
   * subscription billing profile persists through `BillingAddressDto`, which has
   * none, so a rendered phone field would silently discard whatever the client
   * types into it. Hiding it is the honest option.
   *
   * Hiding never blocks the form: `phone_number` only carries a pattern
   * validator unless {@link requirePhone} is set, and an empty value satisfies
   * it. Do not combine `showPhone: false` with `requirePhone: true` — that would
   * demand a value through a field nobody can see.
   */
  readonly showPhone = input<boolean>(true);
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
  /** Precision tier of the last forward-geocode result; null when unresolved
   *  or superseded by a confirmed pin (see {@link pinConfirmed}). */
  readonly precision = signal<GeocodePrecision | null>(null);
  /** Canonical label the geocoder resolved the query to, for display only. */
  readonly geocodeLabel = signal<string | null>(null);
  /**
   * True once the operator (drag/click on the map, or GPS via `onLocated`)
   * placed an exact point. While true, forward-geocode results from typing
   * must NOT overwrite the coordinate — the manual pin wins. Editing
   * `address_line1` again means a different address is being entered, so
   * it resets back to false (see the constructor subscription below).
   */
  readonly pinConfirmed = signal(false);
  /** Counter to discard a stale forward-geocode response that resolves after
   *  a newer request was already fired (fast retyping, fast pin drag). */
  private geocodeGeneration = 0;

  /**
   * Non-blocking precision badge shown under the address line. A confirmed
   * pin always wins over whatever precision tier a prior geocode returned —
   * the operator's placement is more trustworthy than a text-match guess.
   */
  readonly precisionBadge = computed<{
    text: string;
    tone: 'success' | 'warning';
    icon: string;
  } | null>(() => {
    if (this.pinConfirmed()) {
      return { text: 'Punto confirmado en el mapa', tone: 'success', icon: 'map-pin' };
    }
    switch (this.precision()) {
      case 'exact':
        return { text: 'Ubicación exacta', tone: 'success', icon: 'check-circle' };
      case 'interpolated':
        return { text: 'Ubicación aproximada a la placa', tone: 'success', icon: 'map-pin' };
      case 'intersection':
        return { text: 'Ubicada en la esquina', tone: 'success', icon: 'map-pin' };
      case 'street':
        return {
          text: 'Solo encontramos la calle — confirma el punto en el mapa',
          tone: 'warning',
          icon: 'alert-triangle',
        };
      case 'area':
        return {
          text: 'Solo encontramos el barrio o sector — confirma el punto en el mapa',
          tone: 'warning',
          icon: 'alert-triangle',
        };
      default:
        return null;
    }
  });

  private readonly fb = inject(FormBuilder);
  private readonly geocoding = inject(GeocodingService);
  private readonly municipalities = inject(DianMunicipalityLookupService);
  private readonly countryService = inject(CountryService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Catálogo de países como opciones del selector: la etiqueta es el nombre y
   * el valor es el código ISO — el mismo reparto etiqueta/valor que usan los
   * demás formularios del repo (`address-modal`, `legal-data-form`).
   *
   * Esa separación es el punto: el cliente elige «Colombia» y el control
   * `country_code` sigue guardando `CO`, que es lo que leen
   * {@link showMunicipality} para decidir si ofrece el catálogo DANE y el
   * backend para persistir la dirección. Un campo de texto libre dejaba al
   * cliente viendo el código crudo y le permitía teclear cualquier cosa.
   *
   * OJO — en el repo conviven DOS `CountryService`:
   *   - `core/services/country.service.ts` (el que se usa acá): ~67 países,
   *     `getCountries(): Observable<Country[]>`.
   *   - `services/country.service.ts`: ~13 países, `getCountries(): Country[]`
   *     síncrono, y es el que importan los otros 12 consumidores.
   * Se toma el de `core` a propósito: es un superconjunto, así que ningún
   * cliente fuera de esos 13 países se queda sin poder elegir el suyo. Unificar
   * los dos catálogos es un refactor aparte, pendiente.
   *
   * `getCountries()` devuelve un `of(...)` estático, así que el signal ya trae
   * la lista en el primer render; el `initialValue` solo cubre ese instante.
   */
  readonly countryOptions = toSignal(
    this.countryService.getCountries().pipe(
      map((list): SelectorOption[] =>
        list.map((c) => ({ value: c.code, label: c.name })),
      ),
    ),
    { initialValue: [] as SelectorOption[] },
  );



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

  /**
   * H7 — visibilidad del selector DANE. Antes de este fix vivía SOLO detrás de
   * `showAdvanced() && showMunicipality()`, y en modo `compact` (POS)
   * `showAdvanced()` es `false` salvo que la dirección precargada ya trajera
   * apto/postal/país≠CO. Resultado: una dirección nueva capturada desde el POS
   * no tenía ningún control para elegir el municipio, y `resolveMunicipalityFromText`
   * solo se disparaba desde el reverse-fill del mapa (también oculto en
   * compact) — la dirección se guardaba sin `municipality_code`, que la
   * factura electrónica usa como `city_code` del adquiriente.
   *
   * Fix mínimo: el selector se muestra igual que antes cuando `showAdvanced()`
   * es true (0 cambios para los 6 consumidores no-compact ni para el POS con
   * "Más detalles" expandido), Y ADEMÁS en `compact` cuando el auto-resolve
   * (ver el `merge(...)` del constructor) no encontró código — así el cajero
   * siempre tiene cómo elegirlo manualmente.
   */
  readonly municipalitySelectVisible = computed<boolean>(
    () =>
      this.showMunicipality() &&
      (this.showAdvanced() || (this.compact() && !this.municipalityCode())),
  );

  constructor() {
    // Si el consumidor del form pasó un base DANE distinto (e.g. super-admin
    // reusando este componente en el modal de orgs), reconfiguramos el servicio
    // compartido antes de cualquier lookup. Sin esto, el `resolveByName` que
    // dispara el reverse-geocode apuntaría al endpoint de tienda (403).
    //
    // `dianEndpointBase` es un `input()` (signal) — su valor puede NO estar
    // disponible en el constructor (Angular setea los inputs DESPUÉS de la
    // construcción), así que lo observamos con effect.
    effect(() => {
      const base = this.dianEndpointBase();
      if (base) this.municipalities.setBaseUrl(base);
    });

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
        // El patch va silencioso porque `address_line1` tiene un watcher que
        // geocodifica lo que se teclea: emitir aquí dispararía una búsqueda
        // sobre la dirección precargada y pisaría con una aproximación las
        // coordenadas que vienen en el snapshot.
        //
        // El precio es que los dos controles puenteados a signal
        // (`country_code` y `municipality_code`, ambos alimentados de
        // `valueChanges`) no se enterarían de la precarga, así que se
        // re-escriben explícitamente abajo. Sin eso, `showMunicipality()` se
        // quedaría en el 'CO' inicial aunque llegara otro país, y
        // `cityLockedByMunicipality()` dejaría ciudad y departamento editables
        // sobre una dirección que sí trae código DANE.
        { emitEvent: false },
      );
      this.form
        .get('country_code')!
        .setValue(addr.country_code ?? 'CO', { emitEvent: true });
      this.form
        .get('municipality_code')!
        .setValue(addr.municipality_code ?? null, { emitEvent: true });
      if (addr.latitude != null && addr.longitude != null) {
        this.coordsSignal.set({ lat: addr.latitude, lng: addr.longitude });
      }
    });

    // `coordsSignal` (map center) is now written directly, as a signal, at
    // every place a coordinate is resolved: the initial-address prefill
    // above, `onLocated`, `forwardGeocodeFromForm`'s success path, and
    // `clearCoords`. There used to be an `effect()` here reading
    // `form.get('latitude')?.value` — a PLAIN property, not a signal — so it
    // never re-ran after its first (no-op) execution and the map silently
    // never re-centered on a resolved coordinate. See
    // vendix-zoneless-signals: reading a FormControl value inside `effect()`
    // does not register a reactive dependency.

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
        this.emitAddressChange();
      });
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.validChange.emit(this.form.valid);
      });

    // A manual pin (map drag/click/GPS) is the source of truth for its
    // coordinate. Typing a NEW address_line1 means the operator is entering
    // a different address, so the previous pin confirmation no longer
    // applies to it. `prefillFromGeocode`/the initial-address prefill both
    // write address_line1 with `emitEvent:false`, so they never reach here.
    this.form
      .get('address_line1')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.pinConfirmed()) this.pinConfirmed.set(false);
      });

    // Re-geocode (debounced 500ms) on address_line1, city, state_province OR
    // municipality_code changes — the #1 bug this component had: only
    // address_line1 re-triggered a forward-geocode, so picking a different
    // city/department on an address that already resolved coordinates left
    // them silently stale.
    //
    // Gated on `form.dirty` so the silent `initialAddress` prefill (which
    // sets `country_code`/`municipality_code` with `emitEvent:true` but never
    // calls `markAsDirty`) does NOT fire a needless re-geocode on every
    // modal open. `form.dirty` turns true on real typing, and is explicitly
    // set by `onMunicipalitySelected` and `prefillFromGeocode` — exactly the
    // user-driven changes that must re-trigger this (see vendix-known-errors:
    // "setValue no marca dirty").
    merge(
      this.form.get('address_line1')!.valueChanges,
      this.form.get('city')!.valueChanges,
      this.form.get('state_province')!.valueChanges,
      this.form.get('municipality_code')!.valueChanges,
    )
      .pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.form.dirty) return;
        this.forwardGeocodeFromForm();
        // H7 — solo en `compact` (POS): el selector DANE queda oculto detrás
        // de `showAdvanced()` (ver `municipalitySelectVisible`), así que sin
        // esto una dirección nueva tecleada desde el POS nunca obtenía
        // `municipality_code` salvo que el cajero abriera "Más detalles" y el
        // mapa. `resolveMunicipalityFromText` ya es idempotente (no pisa un
        // código existente) y ya valida país CO — se reutiliza tal cual.
        // Gateado a `compact()` para no alterar el comportamiento de los
        // demás consumidores (customer-modal, dispatch-note editor, checkout
        // suscripción, organization/store edit), donde el selector manual ya
        // está siempre visible.
        if (this.compact()) this.resolveMunicipalityFromText();
      });
  }

  /**
   * Emits the current form value PLUS the two signal-only fields
   * (`pin_confirmed`, `geocode_precision`) that are not FormControls. Every
   * `addressChange` emission goes through this helper so parents always see
   * both, and existing consumers that ignore them are unaffected.
   */
  private emitAddressChange(): void {
    this.addressChange.emit({
      ...(this.form.value as AddressPayload),
      pin_confirmed: this.pinConfirmed(),
      geocode_precision: this.precision(),
    });
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
      this.emitAddressChange();
      return;
    }
    this.form
      .get('city')
      ?.setValue(municipality.name, { emitEvent: false });
    this.form
      .get('state_province')
      ?.setValue(municipality.department_name, { emitEvent: false });
    this.form.markAsDirty();
    this.emitAddressChange();
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
    // The map pin is now the source of truth for this coordinate: it must
    // win over any in-flight or future forward-geocode guess.
    this.pinConfirmed.set(true);
    this.precision.set(null);
    this.geocodeLabel.set(null);
    this.addressWarning.set(null);
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

  /**
   * Reverse-geocode landed after a map locate. Only fills fields that are
   * CURRENTLY EMPTY — the typed address is the truth; a pin dropped on an
   * already-filled form must never clobber `address_line1` (or any other
   * textual field) with the provider's guess. `country_code` is the one
   * exception (see its own comment below): it is a controlled selector, not
   * free text the operator typed.
   */
  private prefillFromGeocode(address: NormalizedAddress): void {
    const isEmpty = (value: unknown) =>
      value == null || String(value).trim().length === 0;

    // emitEvent:false → reverse fill must NOT re-trigger the forward-geocode
    // watcher on address_line1/city/state_province (that would fight the map
    // pin this method exists to honor).
    if (address.address_line1 && isEmpty(this.form.get('address_line1')?.value)) {
      this.form
        .get('address_line1')
        ?.setValue(address.address_line1, { emitEvent: false });
    }
    if (address.address_line2 && isEmpty(this.form.get('address_line2')?.value)) {
      this.form
        .get('address_line2')
        ?.setValue(address.address_line2, { emitEvent: false });
    }
    if (address.city && isEmpty(this.form.get('city')?.value)) {
      this.form.get('city')?.setValue(address.city, { emitEvent: false });
    }
    if (address.state_province && isEmpty(this.form.get('state_province')?.value)) {
      this.form
        .get('state_province')
        ?.setValue(address.state_province, { emitEvent: false });
    }
    if (address.country_code) {
      // Este SÍ emite, al revés que sus vecinos: `country_code` está puenteado
      // a signal por `valueChanges`, y en silencio `showMunicipality()` seguiría
      // creyendo que la dirección es colombiana después de que el mapa la
      // llevara a otro país — ofreciendo un catálogo Divipola que allí no
      // existe. No hay watcher colgado de este control, así que emitir es
      // inocuo.
      this.form
        .get('country_code')
        ?.setValue(address.country_code.toUpperCase(), { emitEvent: true });
    }
    if (address.postal_code && isEmpty(this.form.get('postal_code')?.value)) {
      this.form
        .get('postal_code')
        ?.setValue(address.postal_code, { emitEvent: false });
    }
    this.form.markAsDirty();
    this.reverseLoading.set(false);
    // Re-emit so the parent sees the reverse-filled values (plus the
    // pinConfirmed/precision signals set by `onLocated`).
    this.emitAddressChange();
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
        this.emitAddressChange();
      });
  }

  /**
   * Forward-geocodes the composed address (line1 + city + state) and
   * re-centers the map on the result. Debounced trigger lives in the
   * constructor's `merge(...)` subscription and fires on address_line1,
   * city, state_province OR municipality_code changes.
   *
   * A confirmed pin (`pinConfirmed()`) already IS the exact point the
   * operator wants: this method returns immediately without calling the
   * provider, so a forward-geocode can never overwrite it.
   *
   * Null result or an HTTP error CLEARS lat/lng (via {@link clearCoords}) —
   * the #2 historical bug here was keeping the OLD coordinate on failure,
   * which let a quote go out for a stale/unrelated point. `addressWarning`
   * is NON-blocking — `validChange` is based only on syntactic validators.
   */
  private forwardGeocodeFromForm(): void {
    if (this.pinConfirmed()) return;

    const line1 = ((this.form.get('address_line1')?.value as string | null) ?? '').trim();
    if (line1.length < 5) {
      this.addressWarning.set(null);
      this.precision.set(null);
      this.geocodeLabel.set(null);
      return;
    }
    const city = ((this.form.get('city')?.value as string | null) ?? '').trim();
    const state = ((this.form.get('state_province')?.value as string | null) ?? '').trim();
    const country = ((this.form.get('country_code')?.value as string | null) ?? '')
      .trim()
      .toUpperCase();
    // "Colombia" is only a helpful hint for CO (or an unset) country — biasing
    // a foreign address toward Colombia would send the query to the wrong
    // place entirely.
    const query =
      !country || country === COLOMBIA_COUNTRY_CODE
        ? [line1, city, 'Colombia'].filter(Boolean).join(', ')
        : [line1, city, state].filter(Boolean).join(', ');

    const generation = ++this.geocodeGeneration;
    this.geocoding
      .forward(query, { city: city || undefined, state: state || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // A newer request superseded this one, or the operator confirmed a
          // pin while this call was in flight — either way, discard.
          if (generation !== this.geocodeGeneration || this.pinConfirmed()) return;
          if (res?.lat == null || res?.lng == null) {
            this.clearCoords();
            this.addressWarning.set(
              'No pudimos geocodificar la dirección. Verifícala o ubícala en el mapa.',
            );
            return;
          }
          this.addressWarning.set(null);
          this.form.get('latitude')?.setValue(res.lat, { emitEvent: false });
          this.form.get('longitude')?.setValue(res.lng, { emitEvent: false });
          this.coordsSignal.set({ lat: res.lat, lng: res.lng });
          this.precision.set(res.precision ?? null);
          this.geocodeLabel.set(res.label ?? null);
          this.emitAddressChange();
          // Low-precision hit: open the map — even in compact mode — so the
          // operator can confirm or drag the pin. Non-blocking: nothing here
          // gates `validChange`/submit.
          if (res.precision === 'street' || res.precision === 'area') {
            this.showMap.set(true);
            this.advancedOverride.set(true);
          }
        },
        error: () => {
          if (generation !== this.geocodeGeneration || this.pinConfirmed()) return;
          this.clearCoords();
          this.addressWarning.set(
            'No pudimos geocodificar la dirección. Verifícala o ubícala en el mapa.',
          );
        },
      });
  }

  /**
   * Clears the resolved coordinate (and its precision) and re-emits so the
   * parent never quotes shipping against a stale/previous point. Called on a
   * null forward-geocode result and on an HTTP error.
   */
  private clearCoords(): void {
    this.form.get('latitude')?.setValue(null, { emitEvent: false });
    this.form.get('longitude')?.setValue(null, { emitEvent: false });
    this.coordsSignal.set(null);
    this.precision.set(null);
    this.geocodeLabel.set(null);
    this.emitAddressChange();
  }
}

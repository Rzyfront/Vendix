import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Subject, merge } from 'rxjs';
import { debounceTime, finalize, map, startWith } from 'rxjs/operators';

import { AddressMapPickerComponent } from '../../../private/modules/ecommerce/components/address-map-picker/address-map-picker.component';
import {
  GeocodePrecision,
  GeocodingService,
} from '../../../private/modules/ecommerce/services/geocoding.service';
import { InputComponent } from '../input/input.component';
import { IconComponent } from '../icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../selector/selector.component';
import {
  DianDepartmentOption,
  DianMunicipalityLookupService,
  DianMunicipalityOption,
} from '../../services/dian-municipality-lookup.service';

/** País cuyo catálogo Divipola gobierna este formulario. */
const COLOMBIA_COUNTRY_CODE = 'CO';

/** Single covered municipality that pre-fills and hides the geography fields. */
export interface LockedLocation {
  country_code: string;
  state_province: string;
  city: string;
}

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
   * Opcional en el tipo público para conservar compatibilidad con consumidores
   * que construyen `AddressPayload` literales; el formulario exige el código
   * antes de ser válido y lo completa desde los selectores DANE.
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
  /**
   * True once this address has a resolved lat/lng (map pin OR successful
   * forward-geocode) — false when neither ever resolved a coordinate.
   * Optional and purely additive, mirroring `pin_confirmed`/`geocode_precision`.
   * Exists so a consumer that must NOT quote/default a rate without a real
   * point (POS delivery gating) can read one flag instead of re-deriving
   * `Number.isFinite(latitude) && Number.isFinite(longitude)` itself.
   */
  has_location?: boolean;
}

const UNLOCATED_ADDRESS_WARNING =
  'No pudimos ubicar tu dirección. Marca el punto en el mapa para calcular la tarifa de envío.';

/**
 * Reusable shipping/delivery address form with optional collapsible map.
 *
 * - Reactive form (NO ngModel) with the same syntactic validators as the
 *   checkout address form (see checkout.component.ts l.419-446).
 * - Optional map: `app-address-map-picker` (already standalone) is imported
 *   as a child and shown only when `showMap()` is true.
 * - The map ONLY supplies lat/lng (`onLocated`): it never writes into the
 *   typed address fields, not even empty ones — the operator's own text is
 *   the sole source of the written address.
 * - Forward-geocode on typed `address_line1` (debounced 500ms) silently sets
 *   latitude/longitude; failure clears them, sets `addressWarning` and force-opens
 *   the map with a scroll+highlight focus (NON-blocking for `validChange`, but
 *   a consumer MAY choose to gate on `has_location`/coords — see POS shipping).
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
   * Base del endpoint DANE para catálogos e hidratación. Default:
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
  /**
   * Opt-out: when false, the map's native "locate me" (GPS) control is
   * hidden via CSS (`.no-gps`, see the stylesheet). Default true keeps the
   * historical behavior for every existing consumer.
   *
   * POS keeps this enabled: delivery operators may be away from the store and
   * can explicitly choose their current location. GPS is never automatic and
   * remains separate from recentering on the typed address; it supplies only
   * coordinates and never derives/replaces the DANE department or city.
   */
  readonly allowGeolocation = input<boolean>(true);
  /**
   * Fixed-location mode: when the store ships to ONE municipality, country,
   * department, city and municipality_code are pre-filled and their selectors
   * are replaced by a chip. Only takes effect once the municipality resolves
   * against the DANE catalog ({@link lockResolved}); otherwise nothing hides.
   * Default null → historical behavior.
   */
  readonly lockedLocation = input<LockedLocation | null>(null);
  /** When false AND the location is locked, the postal code field is hidden. */
  readonly showPostalCode = input<boolean>(true);

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
  /**
   * City/vereda centroid from an 'area'-precision geocode hit — NOT a
   * resolved point (bug reported E2E 2026-09-27: a nonsense rural address
   * resolved to the city centroid and was silently treated as located).
   * Kept SEPARATE from `coordsSignal` so the map can re-center near the city
   * (`coordsSignal() ?? mapCenterHint()` in the template) without it ever
   * counting toward `has_location`/`hasResolvedLocation` or being persisted
   * to `latitude`/`longitude`. Superseded automatically once `coordsSignal`
   * resolves to a real point (the `??` favors it).
   */
  readonly mapCenterHint = signal<LatLng | null>(null);
  /** True once `lockedLocation` resolved to a DANE municipality. */
  readonly lockResolved = signal(false);
  readonly isLocked = computed<boolean>(
    () => !!this.lockedLocation() && this.lockResolved(),
  );
  /** Chip text for the locked municipality (display only). */
  readonly lockedLabel = computed<string>(() => {
    const loc = this.lockedLocation();
    if (!loc) return '';
    const country = loc.country_code?.toUpperCase() === COLOMBIA_COUNTRY_CODE
      ? 'Colombia'
      : loc.country_code;
    return `${loc.city}, ${loc.state_province} · ${country}`;
  });
  /**
   * Centroid of the locked municipality. VISUAL framing only: it feeds the
   * map's `focusArea` and is NEVER written to `coordsSignal`, the lat/lng
   * controls or `mapCenterHint`, so it cannot count as `has_location` nor
   * reach a shipping quote.
   */
  readonly municipalityFocus = signal<LatLng | null>(null);
  /** Map framing: the geocoder's area hint wins over the municipality centroid. */
  readonly focusArea = computed<LatLng | null>(
    () => this.mapCenterHint() ?? this.municipalityFocus(),
  );
  /** Resolved DANE municipality of the lock, re-applied after a hydration. */
  private lockedMunicipality: DianMunicipalityOption | null = null;
  private lockLookupGeneration = 0;
  private municipalityFocusKey: string | null = null;
  /**
   * True for a couple seconds right after a forward-geocode failure force-opens
   * the map, so the operator's eye lands on it (see {@link focusMapForWarning}).
   */
  readonly mapHighlight = signal(false);
  /** Ref to the map section wrapper, scrolled into view on a geocode failure. */
  private readonly mapWrapperRef = viewChild<ElementRef<HTMLDivElement>>('mapWrapper');
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
   * Chip de carga (2026-09-27) — reference count of forward-geocode requests
   * currently in flight. A COUNTER, not a plain boolean: `forwardGeocodeFromForm`
   * does not cancel the underlying HTTP call on a new request (no `switchMap`)
   * — it only discards a STALE response via {@link geocodeGeneration} once it
   * arrives. Two requests can therefore be in flight at once on a slow
   * geocode cascade; a plain boolean flipped to `false` in the first one's
   * `finalize` would go stuck-false while the second (the one that matters)
   * is still pending. Counting in-flight requests avoids that.
   */
  private readonly locatingRequestCount = signal(0);
  /** True while a forward-geocode for the typed address is in flight. */
  readonly isLocatingAddress = computed<boolean>(
    () => this.locatingRequestCount() > 0,
  );

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
  private readonly destroyRef = inject(DestroyRef);
  /** Host element — used to tell "the operator is still typing in THIS
   *  form" apart from focus elsewhere on the page (see
   *  {@link isTextEntryInsideHost}, rule 3 of the auto-scroll gate). */
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  /**
   * Pending timer for an AUTOMATIC map-scroll request (owner decision
   * 2026-09-27, see {@link requestAutoMapFocus}). Restarted per request,
   * cancelled the moment the operator edits the address again.
   */
  private autoMapFocusTimer: ReturnType<typeof setTimeout> | null = null;
  /** Detaches the one-shot `blur` listener from the "not while typing" rule. */
  private autoMapFocusBlurCleanup: (() => void) | null = null;
  /**
   * Rule 4: an AUTOMATIC scroll happens at most once per component instance.
   * Plain field, not a signal — nothing in the template reads it (see
   * vendix-zoneless-signals: signals are for template-observed state only).
   */
  private autoMapFocusDone = false;
  /** A geocode miss whose warning waits for the first auto-focus to show. */
  private pendingAddressWarning = false;

  /** Colombia es el único país habilitado para captura de direcciones por ahora. */
  readonly countryOptions = signal<SelectorOption[]>([
    { value: COLOMBIA_COUNTRY_CODE, label: 'Colombia' },
  ]);

  readonly departments = signal<DianDepartmentOption[]>([]);
  readonly municipalitiesForDepartment = signal<DianMunicipalityOption[]>([]);
  readonly selectedDepartmentCode = signal<string | null>(null);
  readonly selectedMunicipalityCode = signal<string | null>(null);
  readonly departmentsLoading = signal(false);
  readonly municipalitiesLoading = signal(false);
  readonly departmentCatalogError = signal<string | null>(null);
  readonly municipalityCatalogError = signal<string | null>(null);
  readonly legacyAddressHint = signal<string | null>(null);
  readonly departmentOptions = computed<SelectorOption[]>(() =>
    this.departments().map((item) => ({ value: item.code, label: item.name })),
  );
  readonly municipalityOptions = computed<SelectorOption[]>(() =>
    this.municipalitiesForDepartment().map((item) => ({ value: item.code, label: item.name })),
  );
  readonly municipalitySelectorDisabled = computed(() =>
    !this.selectedDepartmentCode() || this.municipalitiesLoading() || !!this.municipalityCatalogError(),
  );
  private readonly geographyChanges = new Subject<void>();
  private departmentRequestGeneration = 0;
  private municipalityRequestGeneration = 0;
  private hydrationGeneration = 0;

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
    municipality_code: [null as string | null, [Validators.required]],
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

  constructor() {
    // Configura el espejo (si aplica) antes de cargar el catálogo. Inputs son
    // señales y el effect corre una vez que Angular aplicó sus valores.
    effect(() => {
      const base = this.dianEndpointBase();
      this.municipalities.setBaseUrl(base);
      untracked(() => this.loadDepartments());
    });

    // La geografía precargada nunca se muestra como texto libre: hasta resolver
    // DANE los selectores quedan vacíos y el texto legado solo es una pista.
    effect(() => {
      const addr = this.initialAddress();
      if (!addr) return;
      untracked(() => this.hydrateAddress(addr));
    });

    // Fixed-location mode: resolve the locked municipality against the DANE
    // catalog and pre-fill geography. Runs after the initialAddress effect
    // (declaration order); hydrateAddress also re-applies it, so the lock wins.
    effect(() => {
      const loc = this.lockedLocation();
      untracked(() => this.applyLockedLocation(loc));
    });

    // One forward-geocode per locked municipality, purely to frame the map.
    effect(() => {
      const locked = this.isLocked();
      const loc = this.lockedLocation();
      untracked(() => this.frameLockedMunicipality(locked ? loc : null));
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
    // applies to it. The initial-address prefill writes address_line1 with
    // `emitEvent:false`, so it never reaches here.
    this.form
      .get('address_line1')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.pinConfirmed()) this.pinConfirmed.set(false);
      });

    // Re-geocode debounced on street edits or a deliberate geography change.
    merge(
      this.form.get('address_line1')!.valueChanges,
      this.geographyChanges,
    )
      .pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.form.dirty) return;
        this.forwardGeocodeFromForm();
      });

    // Rule 2 of the auto-scroll gate (owner, 2026-09-27): cancel a pending
    // AUTOMATIC map-scroll timer the instant any address field changes — it
    // was waiting on the address as it stood before, not on whatever gets
    // typed next. Deliberately NOT debounced (unlike the geocode trigger
    // above): it must react on every keystroke, not just after a typing
    // pause, or a scroll could still slip out mid-edit.
    merge(
      this.form.get('address_line1')!.valueChanges,
      this.form.get('city')!.valueChanges,
      this.form.get('state_province')!.valueChanges,
      this.form.get('municipality_code')!.valueChanges,
      this.geographyChanges,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clearPendingAutoMapFocus());

    // Belt-and-suspenders: `takeUntilDestroyed` above stops future emissions,
    // but an already-scheduled `setTimeout` isn't an rxjs subscription and
    // survives destroy on its own — clear it explicitly.
    this.destroyRef.onDestroy(() => this.clearPendingAutoMapFocus());
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
      has_location: this.coordsSignal() != null,
    });
  }

  /** Toggles the collapsible map section. */
  toggleMap(): void {
    this.showMap.set(!this.showMap());
  }

  onDepartmentChange(value: string | number | null): void {
    const code = value == null ? null : String(value);
    const department = this.departments().find((item) => item.code === code) ?? null;
    if ((department?.code ?? null) === this.selectedDepartmentCode()) return;

    this.hydrationGeneration++;
    this.municipalityRequestGeneration++;
    this.selectedDepartmentCode.set(department?.code ?? null);
    this.selectedMunicipalityCode.set(null);
    this.municipalitiesForDepartment.set([]);
    this.municipalitiesLoading.set(false);
    this.municipalityCatalogError.set(null);
    this.legacyAddressHint.set(null);
    this.invalidateGeographyAndLocation();
    this.form.patchValue(
      {
        city: null,
        state_province: department?.name ?? null,
        municipality_code: null,
      },
      { emitEvent: false },
    );
    this.form.markAsDirty();
    this.form.updateValueAndValidity({ emitEvent: true });
    this.geographyChanges.next();
    if (department) this.loadMunicipalities(department.code);
  }

  onCityChange(value: string | number | null): void {
    const code = value == null ? null : String(value);
    if (code === this.selectedMunicipalityCode()) return;
    if (code == null) {
      this.hydrationGeneration++;
      this.selectedMunicipalityCode.set(null);
      this.legacyAddressHint.set(null);
      this.invalidateGeographyAndLocation();
      this.form.patchValue({ city: null, municipality_code: null }, { emitEvent: false });
      this.form.markAsDirty();
      this.form.updateValueAndValidity({ emitEvent: true });
      this.geographyChanges.next();
      return;
    }
    const municipality = this.municipalitiesForDepartment().find((item) => item.code === code);
    if (!municipality || municipality.department_code !== this.selectedDepartmentCode()) return;

    this.hydrationGeneration++;
    this.selectedMunicipalityCode.set(municipality.code);
    this.legacyAddressHint.set(null);
    this.invalidateGeographyAndLocation();
    this.form.patchValue(
      {
        city: municipality.name,
        state_province: municipality.department_name,
        municipality_code: municipality.code,
      },
      { emitEvent: false },
    );
    this.form.markAsDirty();
    this.form.updateValueAndValidity({ emitEvent: true });
    this.geographyChanges.next();
  }

  retryDepartments(): void {
    this.loadDepartments();
  }

  retryMunicipalities(): void {
    const departmentCode = this.selectedDepartmentCode();
    if (departmentCode) this.loadMunicipalities(departmentCode);
  }

  private loadDepartments(): void {
    const generation = ++this.departmentRequestGeneration;
    this.departmentsLoading.set(true);
    this.departmentCatalogError.set(null);
    this.municipalities
      .listDepartments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (departments) => {
          if (generation !== this.departmentRequestGeneration) return;
          this.departments.set(departments);
          this.departmentsLoading.set(false);
        },
        error: () => {
          if (generation !== this.departmentRequestGeneration) return;
          this.departmentsLoading.set(false);
          this.departmentCatalogError.set('No pudimos cargar los departamentos DANE. Intenta de nuevo.');
        },
      });
  }

  private loadMunicipalities(departmentCode: string): void {
    const generation = ++this.municipalityRequestGeneration;
    this.municipalitiesLoading.set(true);
    this.municipalityCatalogError.set(null);
    this.municipalitiesForDepartment.set([]);
    this.municipalities
      .listByDepartment(departmentCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (municipalities) => {
          if (generation !== this.municipalityRequestGeneration ||
              departmentCode !== this.selectedDepartmentCode()) return;
          this.municipalitiesForDepartment.set(municipalities);
          this.municipalitiesLoading.set(false);
        },
        error: () => {
          if (generation !== this.municipalityRequestGeneration ||
              departmentCode !== this.selectedDepartmentCode()) return;
          this.municipalitiesLoading.set(false);
          this.municipalityCatalogError.set('No pudimos cargar las ciudades de este departamento. Intenta de nuevo.');
        },
      });
  }

  private hydrateAddress(address: AddressPayload): void {
    const generation = ++this.hydrationGeneration;
    this.municipalityRequestGeneration++;
    this.geocodeGeneration++;
    const city = address.city?.trim() ?? '';
    const state = address.state_province?.trim() ?? '';
    const hint = city || state ? `Antes: ${[city, state].filter(Boolean).join(', ')}` : null;
    const hasValidCoords = this.hasValidCoords(address.latitude, address.longitude);

    this.selectedDepartmentCode.set(null);
    this.selectedMunicipalityCode.set(null);
    this.municipalitiesForDepartment.set([]);
    this.municipalitiesLoading.set(false);
    this.municipalityCatalogError.set(null);
    this.legacyAddressHint.set(hint);
    this.form.patchValue(
      {
        address_line1: address.address_line1 ?? null,
        address_line2: address.address_line2 ?? null,
        city: null,
        state_province: null,
        country_code: COLOMBIA_COUNTRY_CODE,
        postal_code: address.postal_code ?? null,
        phone_number: address.phone_number ?? null,
        latitude: hasValidCoords ? address.latitude : null,
        longitude: hasValidCoords ? address.longitude : null,
        municipality_code: null,
      },
      { emitEvent: false },
    );
    this.form.markAsPristine();
    this.pinConfirmed.set(address.pin_confirmed === true && hasValidCoords);
    this.precision.set(address.geocode_precision ?? null);
    this.geocodeLabel.set(null);
    this.addressWarning.set(null);
    this.pendingAddressWarning = false;
    this.coordsSignal.set(hasValidCoords
      ? { lat: address.latitude!, lng: address.longitude! }
      : null);
    this.mapCenterHint.set(null);
    this.form.updateValueAndValidity({ emitEvent: true });

    // Fixed-location mode wins over whatever geography the address carried.
    if (this.lockedMunicipality && this.lockedLocation()) {
      this.applyLockedMunicipality();
      return;
    }

    const lookup$ = address.municipality_code?.trim()
      ? this.municipalities.resolveByCode(address.municipality_code)
      : city && state
        ? this.municipalities.resolveByName(city, state)
        : null;
    if (!lookup$) return;

    lookup$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (municipality) => {
          if (generation !== this.hydrationGeneration) return;
          if (!municipality || !/^\d{2}$/.test(municipality.department_code)) {
            this.legacyAddressHint.set(hint);
            return;
          }
          this.selectedDepartmentCode.set(municipality.department_code);
          this.selectedMunicipalityCode.set(municipality.code);
          this.legacyAddressHint.set(null);
          this.form.patchValue({
            city: municipality.name,
            state_province: municipality.department_name,
            municipality_code: municipality.code,
          }, { emitEvent: false });
          this.form.updateValueAndValidity({ emitEvent: true });
          this.loadMunicipalities(municipality.department_code);
        },
        error: () => {
          if (generation === this.hydrationGeneration) this.legacyAddressHint.set(hint);
        },
      });
  }

  private applyLockedLocation(loc: LockedLocation | null): void {
    const generation = ++this.lockLookupGeneration;
    if (!loc) {
      const wasLocked = this.lockedMunicipality != null;
      this.lockedMunicipality = null;
      this.lockResolved.set(false);
      // Selectors reappear: they need their municipality list back.
      const dep = this.selectedDepartmentCode();
      if (wasLocked && dep) this.loadMunicipalities(dep);
      return;
    }
    this.municipalities
      .resolveByName(loc.city.trim(), loc.state_province.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (municipality) => {
          if (generation !== this.lockLookupGeneration) return;
          if (!municipality || !/^\d{2}$/.test(municipality.department_code)) {
            this.lockedMunicipality = null;
            this.lockResolved.set(false);
            return;
          }
          this.lockedMunicipality = municipality;
          this.applyLockedMunicipality();
          this.lockResolved.set(true);
        },
        error: () => {
          if (generation !== this.lockLookupGeneration) return;
          this.lockedMunicipality = null;
          this.lockResolved.set(false);
        },
      });
  }

  /** Patches the locked geography (same value format as hydrateAddress). */
  private applyLockedMunicipality(): void {
    const municipality = this.lockedMunicipality;
    const loc = this.lockedLocation();
    if (!municipality || !loc) return;
    // Cancels any pending hydration lookup that could overwrite the lock.
    this.hydrationGeneration++;
    const previousCode = this.form.get('municipality_code')?.value as string | null;
    if (previousCode && previousCode !== municipality.code) {
      // Coordinates of another municipality must not survive the lock.
      this.invalidateGeographyAndLocation();
    }
    this.selectedDepartmentCode.set(municipality.department_code);
    this.selectedMunicipalityCode.set(municipality.code);
    this.legacyAddressHint.set(null);
    this.form.patchValue({
      country_code: loc.country_code?.toUpperCase() || COLOMBIA_COUNTRY_CODE,
      city: municipality.name,
      state_province: municipality.department_name,
      municipality_code: municipality.code,
    }, { emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: true });
  }

  private frameLockedMunicipality(loc: LockedLocation | null): void {
    if (!loc) {
      this.municipalityFocusKey = null;
      this.municipalityFocus.set(null);
      return;
    }
    const key = `${loc.city}|${loc.state_province}`;
    if (this.municipalityFocusKey === key) return;
    this.municipalityFocusKey = key;
    this.municipalityFocus.set(null);
    this.geocoding
      .municipalityCenter(loc.city, loc.state_province)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (this.municipalityFocusKey !== key) return;
          this.municipalityFocus.set(res);
        },
        error: () => {
          if (this.municipalityFocusKey === key) this.municipalityFocus.set(null);
        },
      });
  }

  private invalidateGeographyAndLocation(): void {
    this.geocodeGeneration++;
    this.pinConfirmed.set(false);
    this.precision.set(null);
    this.geocodeLabel.set(null);
    this.addressWarning.set(null);
    this.pendingAddressWarning = false;
    this.mapCenterHint.set(null);
    this.form.patchValue({ latitude: null, longitude: null }, { emitEvent: false });
    this.coordsSignal.set(null);
    this.clearPendingAutoMapFocus();
  }

  private hasValidCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
    return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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
   * Map located (drag/click/GPS): store the exact coordinate as the source of
   * truth for this pin.
   *
   * Coordinator directive (requirement 1, 2026-09): the map's reverse-geocode
   * must NEVER write into the typed address fields any more — not even empty
   * ones. Previously this method reverse-geocoded the point and used the
   * result to prefill `address_line1`/`city`/`state_province`/etc
   * (`prefillFromGeocode`, now removed). That produced addresses that read as
   * if the customer typed them but actually came from a coarse reverse-geocode
   * guess. The map now ONLY supplies lat/lng; the operator's own typed text is
   * the sole source of the written address.
   *
   * Geography remains owned by the DANE selectors; moving the pin only changes
   * coordinates and never resolves or rewrites the selected municipality.
   */
  onLocated(coords: LatLng): void {
    // The map pin is now the source of truth for this coordinate: it must
    // win over any in-flight or future forward-geocode guess.
    this.pinConfirmed.set(true);
    this.precision.set(null);
    this.geocodeLabel.set(null);
    this.addressWarning.set(null);
    this.pendingAddressWarning = false;
    this.form.get('latitude')?.setValue(coords.lat);
    this.form.get('longitude')?.setValue(coords.lng);
    this.coordsSignal.set(coords);
    this.emitAddressChange();
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
      this.pendingAddressWarning = false;
      this.precision.set(null);
      this.geocodeLabel.set(null);
      return;
    }
    const city = ((this.form.get('city')?.value as string | null) ?? '').trim();
    const state = ((this.form.get('state_province')?.value as string | null) ?? '').trim();
    const country = ((this.form.get('country_code')?.value as string | null) ?? '')
      .trim()
      .toUpperCase();
    // Owner decision 2026-09-27: never geocode a partial address — the street
    // line alone almost never matches, and a premature miss only flashed the
    // warning and force-opened the map while the operator was still typing.
    if (!country || !city || !state) {
      this.addressWarning.set(null);
      this.pendingAddressWarning = false;
      this.precision.set(null);
      this.geocodeLabel.set(null);
      return;
    }
    // "Colombia" is only a helpful hint for CO (or an unset) country — biasing
    // a foreign address toward Colombia would send the query to the wrong
    // place entirely.
    const query =
      !country || country === COLOMBIA_COUNTRY_CODE
        ? [line1, city, 'Colombia'].filter(Boolean).join(', ')
        : [line1, city, state].filter(Boolean).join(', ');

    const generation = ++this.geocodeGeneration;
    this.locatingRequestCount.update((n) => n + 1);
    this.geocoding
      .forward(query, { city: city || undefined, state: state || undefined })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        // Runs on next/error AND on early unsubscribe (component destroyed
        // mid-flight) — the chip never gets stuck showing "Ubicando...".
        finalize(() => this.locatingRequestCount.update((n) => Math.max(0, n - 1))),
      )
      .subscribe({
        next: (res) => {
          // A newer request superseded this one, or the operator confirmed a
          // pin while this call was in flight — either way, discard.
          if (generation !== this.geocodeGeneration || this.pinConfirmed()) return;
          if (res?.lat == null || res?.lng == null) {
            this.clearCoords();
            this.focusMapForWarning();
            return;
          }
          if (res.precision === 'area') {
            // City/vereda centroid, not a resolved point (see
            // `mapCenterHint` doc). Re-center the map near it so the
            // operator can find themselves, but treat it exactly like an
            // unresolved geocode: coords stay cleared, same warning + CTA +
            // focus path as a null/error result.
            this.mapCenterHint.set({ lat: res.lat, lng: res.lng });
            this.clearCoords();
            this.focusMapForWarning();
            return;
          }
          this.addressWarning.set(null);
          this.pendingAddressWarning = false;
          this.form.get('latitude')?.setValue(res.lat, { emitEvent: false });
          this.form.get('longitude')?.setValue(res.lng, { emitEvent: false });
          this.coordsSignal.set({ lat: res.lat, lng: res.lng });
          this.precision.set(res.precision ?? null);
          this.geocodeLabel.set(res.label ?? null);
          this.emitAddressChange();
          // Low-precision hit: open the map — even in compact mode — so the
          // operator can confirm or drag the pin. Non-blocking: nothing here
          // gates `validChange`/submit.
          // Opening goes through the same gate as the scroll: in the POS the
          // map sits ABOVE the fields, so force-opening it mid-typing shoves
          // the field being edited ~570px down the sheet.
          if (res.precision === 'street') {
            this.requestAutoMapFocus();
          }
        },
        error: () => {
          if (generation !== this.geocodeGeneration || this.pinConfirmed()) return;
          this.clearCoords();
          this.focusMapForWarning();
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

  /**
   * Requirement 2 (coordinator, 2026-09): when the forward-geocode fails
   * outright (null result or HTTP error), the map must open — even in
   * `compact` mode — AND grab the operator's attention, since there is no
   * other way left to get a coordinate for that address. Force-opens the map
   * section, scrolls to it and pulses a highlight class for a couple seconds
   * (`mapHighlight`, see the stylesheet's `.map-wrapper--highlight`). All of
   * it — opening included — is gated through {@link requestAutoMapFocus}
   * (owner, 2026-09-27): the map renders ABOVE the fields, so opening it
   * while the operator types pushes the field out from under their thumb,
   * just like the scroll did. The warning text still shows immediately.
   * Every call-site is an AUTOMATIC focus (a geocode result, never a click).
   */
  private focusMapForWarning(): void {
    // The warning box also renders ABOVE the address line, so inserting it
    // mid-typing shifted the field too: until the first auto-focus fires it
    // is held back and shown together with the map.
    if (this.autoMapFocusDone) {
      this.addressWarning.set(UNLOCATED_ADDRESS_WARNING);
      return;
    }
    this.pendingAddressWarning = true;
    this.requestAutoMapFocus();
  }

  /**
   * Gate for an AUTOMATIC map scroll (owner decision 2026-09-27). A debounced
   * forward-geocode fires after every typing pause; a partial address that
   * fails used to scroll the page right out from under the operator's thumb
   * mid-keystroke — worse on mobile with the keyboard open. This method never
   * scrolls synchronously; it only ever schedules {@link runAutoMapFocus}.
   *
   * Rule 2: 500ms debounce, restarted on every new request (a fresh call
   * always wins over whatever timer was already pending).
   */
  private requestAutoMapFocus(): void {
    if (this.autoMapFocusDone) return;
    this.clearPendingAutoMapFocus();
    this.autoMapFocusTimer = setTimeout(() => {
      this.autoMapFocusTimer = null;
      this.runAutoMapFocus();
    }, 500);
  }

  /**
   * Rule 1 — required-fields gate: department, municipality and a real
   * address line must ALL be filled before an automatic scroll is allowed.
   * Re-checked both when the timer fires and again on `blur` (see
   * {@link runAutoMapFocus}), since the address can still be incomplete at
   * either point.
   */
  private autoMapFocusGateOpen(): boolean {
    const state = ((this.form.get('state_province')?.value as string | null) ?? '').trim();
    const city = ((this.form.get('city')?.value as string | null) ?? '').trim();
    const line1 = ((this.form.get('address_line1')?.value as string | null) ?? '').trim();
    return state.length > 0 && city.length > 0 && line1.length >= 5;
  }

  /**
   * Runs when the 500ms timer elapses, and again from the one-shot `blur`
   * listener it may attach (rule 3). If the operator is still typing in a
   * text field inside THIS component when the timer fires, the scroll is
   * deferred to that field's `blur` instead of firing on top of them.
   */
  private runAutoMapFocus(): void {
    if (this.autoMapFocusDone || !this.autoMapFocusGateOpen()) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.isTextEntryInsideHost(active)) {
      this.clearPendingAutoMapFocus();
      const onBlur = () => {
        active.removeEventListener('blur', onBlur);
        this.autoMapFocusBlurCleanup = null;
        // Next tick: `activeElement` is still <body> during `blur`. If focus
        // just moved to another field of this form, keep waiting on that one.
        setTimeout(() => this.runAutoMapFocus(), 0);
      };
      active.addEventListener('blur', onBlur, { once: true });
      this.autoMapFocusBlurCleanup = () => active.removeEventListener('blur', onBlur);
      return;
    }
    if (this.pendingAddressWarning) {
      this.addressWarning.set(UNLOCATED_ADDRESS_WARNING);
      this.pendingAddressWarning = false;
    }
    this.showMap.set(true);
    this.advancedOverride.set(true);
    this.mapHighlight.set(true);
    setTimeout(() => this.mapHighlight.set(false), 2000);
    this.scrollMapIntoView();
    this.autoMapFocusDone = true; // Rule 4 — never again for this instance.
  }

  /**
   * Text-entry elements the "not while typing" rule waits out: text-like
   * `<input>` types (or no `type` attribute, which defaults to `text`),
   * `<textarea>`, and `contenteditable` — but only inside THIS component's
   * host, so focus elsewhere on the page (another modal, the page chrome)
   * never blocks the scroll.
   */
  private isTextEntryInsideHost(el: HTMLElement): boolean {
    if (!this.hostRef.nativeElement.contains(el)) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'tel', 'email', 'number'].includes(type);
  }

  /**
   * The actual scroll. `setTimeout(0)` (not synchronous) because
   * `showMap.set(true)` only schedules the `@if (showMap())` block to
   * render; the wrapper element does not exist in the DOM yet on this same
   * synchronous tick.
   */
  private scrollMapIntoView(): void {
    setTimeout(() => {
      this.mapWrapperRef()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  /** Cancels the pending timer and/or detaches the `blur` listener, if any. */
  private clearPendingAutoMapFocus(): void {
    if (this.autoMapFocusTimer != null) {
      clearTimeout(this.autoMapFocusTimer);
      this.autoMapFocusTimer = null;
    }
    this.autoMapFocusBlurCleanup?.();
    this.autoMapFocusBlurCleanup = null;
  }
}

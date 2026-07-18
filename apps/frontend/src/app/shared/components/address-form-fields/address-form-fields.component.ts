import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { AddressMapPickerComponent } from '../../../private/modules/ecommerce/components/address-map-picker/address-map-picker.component';
import {
  GeocodingService,
  NormalizedAddress,
} from '../../../private/modules/ecommerce/services/geocoding.service';
import { InputComponent } from '../input/input.component';
import { IconComponent } from '../icon/icon.component';

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
    phone_number: [
      null as string | null,
      [Validators.pattern(/^[\d+#*\s()-]*$/)],
    ],
    // Hidden coordinates. No validators so they never affect form.valid.
    latitude: [null as number | null],
    longitude: [null as number | null],
  });

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
        },
        { emitEvent: false },
      );
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
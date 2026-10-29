import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  ToggleComponent,
} from '../../../../../shared/components/index';
import { DOCUMENT_TYPES } from '../../../../../shared/constants/document-types';
import { CountryService } from '../../../../../core/services/country.service';
import {
  FOREIGN_DOCUMENT_TYPES,
  GuestField,
  guestFieldErrorMap,
  reportsSire,
  resolveNationality,
  TRAVEL_PURPOSES,
} from '../../../store/hospitality/reservations/interfaces/guest.interface';
import {
  HotelBookingService,
  HotelPrecheckin,
  HotelPrecheckinGuest,
} from '../../services/hotel-booking.service';
import { apiMessage, formatDateOnly } from './hotel-date.util';

/** Most guests one online check-in sends (same cap as the API). */
const MAX_GUESTS = 20;

interface GuestForm {
  reservation_room_id: FormControl<number | null>;
  document_type: FormControl<string>;
  document_number: FormControl<string>;
  first_name: FormControl<string>;
  last_name: FormControl<string>;
  nationality_country_code: FormControl<string>;
  birth_date: FormControl<string>;
  residence_city: FormControl<string>;
  origin_city: FormControl<string>;
  travel_purpose: FormControl<string>;
}

type GuestErrors = Partial<Record<GuestField | 'reservation_room_id', string>>;

/**
 * Hospitality Suite (H8.1) — online check-in: the guest opens the link the
 * hotel sent, without login, and fills the TRA/SIRE data of the holder and
 * each companion so check-in at the desk takes a minute.
 */
@Component({
  selector: 'app-hotel-precheckin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <div class="mx-auto max-w-xl space-y-4 p-4" data-testid="precheckin-page">
      <h1 class="flex items-center gap-2 text-xl font-semibold">
        <app-icon name="hotel" [size]="22" />
        Pre-registro de tu estadía
      </h1>

      @if (loadError(); as message) {
        <div class="space-y-3 rounded-lg border border-border p-4" data-testid="precheckin-error">
          <p class="text-sm">{{ message }}</p>
          @if (retryable()) {
            <app-button variant="outline" customClasses="min-h-11 sm:min-h-0" (clicked)="load()">
              <app-icon slot="icon" name="refresh-cw" [size]="14" />
              Reintentar
            </app-button>
          }
        </div>
      } @else if (done()) {
        <div class="space-y-2 rounded-lg border border-border p-4 text-center" data-testid="precheckin-done">
          @if (missingGuests() > 0) {
            <app-icon name="alert-triangle" [size]="32" class="text-warning" />
            <p class="text-lg font-semibold" data-testid="precheckin-partial">
              {{ missingGuests() === 1 ? 'Falta 1 acompañante' : 'Faltan ' + missingGuests() + ' acompañantes' }}
              por registrar
            </p>
            <p class="text-sm text-text-secondary">
              Recibimos los datos de {{ savedCount() }} {{ savedCount() === 1 ? 'huésped' : 'huéspedes' }}.
              Registra a los demás ahora o en recepción con su documento.
            </p>
          } @else {
            <app-icon name="circle-check" [size]="32" class="text-success" />
            <p class="text-lg font-semibold">Pre-registro completo ✓</p>
            <p class="text-sm text-text-secondary">
              Recibimos los datos de {{ savedCount() }} {{ savedCount() === 1 ? 'huésped' : 'huéspedes' }}.
              En recepción solo confirmaremos tu documento.
            </p>
          }
          <app-button variant="outline" customClasses="min-h-11 sm:min-h-0" (clicked)="startAgain()">
            {{ missingGuests() > 0 ? 'Registrar a los que faltan' : 'Agregar o corregir huéspedes' }}
          </app-button>
        </div>
      } @else if (info(); as r) {
        <div class="space-y-1 rounded-lg border border-border p-4 text-sm">
          <p class="font-medium">{{ r.store_name }} · Reserva {{ r.reservation_number }}</p>
          <p class="text-text-secondary">
            Llegada {{ date(r.arrival_date) }} · Salida {{ date(r.departure_date) }}
          </p>
          @if (r.registered.length) {
            <p class="text-text-secondary" data-testid="precheckin-registered">
              Ya registrados: {{ registeredNames() }}
            </p>
          }
          @if (r.completed_at) {
            <app-badge variant="success" size="sm">Pre-registro completo ✓</app-badge>
          } @else if (r.registered_count && r.registered_count < r.expected_guests) {
            <app-badge variant="warning" size="sm">
              Pre-registro parcial: {{ r.registered_count }} de {{ r.expected_guests }} huéspedes
            </app-badge>
          }
          @if (r.checked_in) {
            <p class="text-text-secondary" data-testid="precheckin-in-house">
              Ya estás en el hotel: aquí solo puedes agregar acompañantes nuevos. Para corregir
              datos ya registrados, acércate a recepción.
            </p>
          }
        </div>

        <form
          [formGroup]="form"
          class="space-y-4"
          novalidate
          data-testid="precheckin-form"
          (ngSubmit)="submit()"
        >
          <div formArrayName="guests" class="space-y-4">
            @for (group of guests.controls; track group; let i = $index) {
              <fieldset
                [formGroupName]="i"
                class="space-y-3 rounded-lg border border-border p-4"
                data-testid="precheckin-guest"
                [attr.data-autofocus]="i === 0 ? '' : null"
              >
                <legend class="flex w-full items-center justify-between gap-2 px-1 font-medium">
                  {{ guestTitle(i) }}
                  @if (i > 0) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      customClasses="min-h-11 min-w-11"
                      [ariaLabel]="'Quitar ' + guestTitle(i)"
                      (clicked)="removeGuest(i)"
                    >
                      <app-icon slot="icon" name="trash-2" [size]="14" />
                    </app-button>
                  }
                </legend>

                @if (roomOptions().length > 1) {
                  <app-selector
                    formControlName="reservation_room_id"
                    label="Habitación"
                    placeholder="Elige la habitación"
                    [required]="true"
                    [options]="roomOptions()"
                    [errorText]="errors()[i]?.reservation_room_id ?? ''"
                  />
                }

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <app-selector
                    formControlName="document_type"
                    label="Tipo de documento"
                    placeholder="Elige el tipo"
                    [required]="true"
                    [options]="documentTypeOptions"
                    [errorText]="errors()[i]?.document_type ?? ''"
                  />
                  <app-input
                    formControlName="document_number"
                    label="Número de documento"
                    [required]="true"
                    [error]="errors()[i]?.document_number ?? ''"
                    customWrapperClass="mt-0"
                  />
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <app-input
                    formControlName="first_name"
                    label="Nombres"
                    [required]="true"
                    [error]="errors()[i]?.first_name ?? ''"
                    customWrapperClass="mt-0"
                  />
                  <app-input
                    formControlName="last_name"
                    label="Apellidos"
                    [required]="true"
                    [error]="errors()[i]?.last_name ?? ''"
                    customWrapperClass="mt-0"
                  />
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <app-selector
                    formControlName="nationality_country_code"
                    label="Nacionalidad"
                    placeholder="Elige el país"
                    [required]="foreignDocument(i)"
                    [searchable]="true"
                    [options]="countryOptions"
                    [errorText]="errors()[i]?.nationality_country_code ?? ''"
                  />
                  <app-input
                    formControlName="birth_date"
                    label="Fecha de nacimiento"
                    type="date"
                    [required]="foreigner(i)"
                    [error]="errors()[i]?.birth_date ?? ''"
                    customWrapperClass="mt-0"
                  />
                </div>
                @if (foreigner(i)) {
                  <p class="text-xs text-text-secondary">
                    Los huéspedes extranjeros se reportan a Migración Colombia; por eso pedimos la
                    fecha de nacimiento.
                  </p>
                }

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <app-input
                    formControlName="residence_city"
                    label="Ciudad de residencia"
                    [required]="true"
                    [error]="errors()[i]?.residence_city ?? ''"
                    customWrapperClass="mt-0"
                  />
                  <app-input
                    formControlName="origin_city"
                    label="Ciudad de procedencia"
                    [required]="true"
                    [error]="errors()[i]?.origin_city ?? ''"
                    customWrapperClass="mt-0"
                  />
                </div>

                <app-selector
                  formControlName="travel_purpose"
                  label="Motivo de viaje"
                  placeholder="Elige el motivo"
                  [required]="true"
                  [options]="purposeOptions"
                  [errorText]="errors()[i]?.travel_purpose ?? ''"
                />
              </fieldset>
            }
          </div>

          @if (guests.length < maxGuests) {
            <app-button
              variant="outline"
              customClasses="min-h-11 sm:min-h-0"
              (clicked)="addGuest()"
              data-testid="precheckin-add"
            >
              <app-icon slot="icon" name="user-plus" [size]="16" />
              Agregar acompañante
            </app-button>
          }

          <div
            class="space-y-2 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary"
            data-testid="precheckin-data-notice"
          >
            <p class="font-medium text-text-primary">Autorización de tratamiento de datos personales</p>
            <p>
              {{ info()?.store_name || 'El hotel' }} usará estos datos solo para el registro de
              huéspedes y los reportes que exige la ley (Tarjeta de Registro de Alojamiento del
              MinCIT y SIRE de Migración Colombia), según la Ley 1581 de 2012. Puedes conocer,
              actualizar y rectificar tus datos con el hotel.
            </p>
            <app-toggle
              formControlName="data_consent"
              label="Autorizo el tratamiento de mis datos y los de mis acompañantes"
              data-testid="precheckin-consent"
            />
          </div>

          @if (submitError(); as message) {
            <p class="rounded-lg bg-error/10 px-3 py-2 text-sm" role="alert" data-testid="precheckin-submit-error">
              {{ message }}
            </p>
          }

          <app-button
            type="submit"
            variant="primary"
            [fullWidth]="true"
            [loading]="saving()"
            [disabled]="!consent()"
            customClasses="min-h-11"
            data-testid="precheckin-submit"
          >
            <app-icon slot="icon" name="send" [size]="16" />
            Enviar pre-registro
          </app-button>
          @if (!consent()) {
            <p class="text-center text-xs text-text-secondary">
              Autoriza el tratamiento de datos para enviar
            </p>
          }
        </form>
      } @else {
        <p class="text-text-secondary">Cargando tu reserva…</p>
      }
    </div>
  `,
})
export class HotelPrecheckinComponent implements OnInit {
  private readonly service = inject(HotelBookingService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly maxGuests = MAX_GUESTS;
  readonly info = signal<HotelPrecheckin | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly retryable = signal(false);
  readonly saving = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly done = signal(false);
  readonly savedCount = signal(0);
  /** Guests of the party still unregistered after the last send. */
  readonly missingGuests = signal(0);
  readonly consent = signal(false);
  readonly errors = signal<GuestErrors[]>([]);
  /** Bumped on every form change so the per-guest SIRE hints recompute. */
  private readonly revision = signal(0);
  private attempted = false;
  private token = '';

  readonly guests = this.fb.array<FormGroup<GuestForm>>([]);
  readonly form = this.fb.group({
    guests: this.guests,
    data_consent: this.fb.nonNullable.control(false),
  });

  readonly documentTypeOptions: SelectorOption[] = DOCUMENT_TYPES.filter(
    (type) => type.code !== 'NIT',
  ).map((type) => ({ value: type.code, label: type.label }));
  readonly purposeOptions: SelectorOption[] = Object.entries(TRAVEL_PURPOSES).map(
    ([value, label]) => ({ value, label }),
  );
  readonly countryOptions: SelectorOption[] = countryOptions(inject(CountryService));

  readonly roomOptions = computed<SelectorOption[]>(() =>
    (this.info()?.rooms ?? []).map((room) => ({ value: room.id, label: room.name })),
  );
  readonly registeredNames = computed(() =>
    (this.info()?.registered ?? []).map((guest) => guest.name).join(', '),
  );
  private readonly hasHolder = computed(() =>
    (this.info()?.registered ?? []).some((guest) => guest.is_primary),
  );

  constructor() {
    this.form.controls.data_consent.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.consent.set(value));
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.revision.update((n) => n + 1);
      if (this.attempted) this.validate();
    });
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.load();
  }

  load(): void {
    this.loadError.set(null);
    this.info.set(null);
    this.service
      .getPrecheckin(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => {
          this.info.set(info);
          const pending = Math.max(1, info.expected_guests - info.registered.length);
          this.resetGuests(Math.min(pending, MAX_GUESTS));
          this.focusFirstField();
        },
        error: (err: { status?: number }) => {
          // 404/410 are final (unknown or expired link); anything else can be retried.
          this.retryable.set(err?.status !== 404 && err?.status !== 410);
          this.loadError.set(
            apiMessage(err, 'No pudimos cargar tu reserva. Revisa tu conexión e inténtalo de nuevo.'),
          );
        },
      });
  }

  guestTitle(index: number): string {
    if (index === 0 && !this.hasHolder()) return 'Titular de la reserva';
    return `Acompañante ${this.hasHolder() ? index + 1 : index}`;
  }

  foreignDocument(index: number): boolean {
    this.revision();
    return FOREIGN_DOCUMENT_TYPES.includes(this.guests.at(index)?.controls.document_type.value ?? '');
  }

  foreigner(index: number): boolean {
    this.revision();
    const group = this.guests.at(index);
    if (!group) return false;
    return reportsSire(
      resolveNationality(group.controls.document_type.value, group.controls.nationality_country_code.value),
    );
  }

  addGuest(): void {
    if (this.guests.length >= MAX_GUESTS) return;
    this.guests.push(this.guestGroup());
  }

  removeGuest(index: number): void {
    this.guests.removeAt(index);
  }

  startAgain(): void {
    this.done.set(false);
    this.load();
  }

  submit(): void {
    if (this.saving()) return;
    this.attempted = true;
    if (!this.validate() || !this.consent()) return;
    this.submitError.set(null);
    this.saving.set(true);
    this.service
      .submitPrecheckin(this.token, { guests: this.body(), data_consent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.savedCount.set(result.guests);
          this.missingGuests.set(Math.max(0, result.expected_guests - result.registered_count));
          this.done.set(true);
        },
        error: (err) => {
          this.saving.set(false);
          this.submitError.set(apiMessage(err, 'No pudimos enviar el pre-registro. Inténtalo de nuevo.'));
        },
      });
  }

  date(value: string): string {
    return formatDateOnly(value);
  }

  private body(): HotelPrecheckinGuest[] {
    return this.guests.controls.map((group) => {
      const raw = group.getRawValue();
      return {
        reservation_room_id: raw.reservation_room_id ?? undefined,
        document_type: raw.document_type,
        document_number: raw.document_number.trim(),
        first_name: raw.first_name.trim(),
        last_name: raw.last_name.trim(),
        nationality_country_code: raw.nationality_country_code || undefined,
        birth_date: raw.birth_date || undefined,
        residence_city: raw.residence_city.trim(),
        origin_city: raw.origin_city.trim(),
        travel_purpose: raw.travel_purpose,
      };
    });
  }

  /** Writes the message under each missing field; true when nothing is missing. */
  private validate(): boolean {
    const needsRoom = this.roomOptions().length > 1;
    const errors: GuestErrors[] = this.body().map((guest) => {
      const fieldErrors: GuestErrors = guestFieldErrorMap({ ...guest, data_consent: true });
      if (needsRoom && !guest.reservation_room_id) fieldErrors.reservation_room_id = 'Elige la habitación';
      return fieldErrors;
    });
    this.errors.set(errors);
    return errors.every((fieldErrors) => Object.keys(fieldErrors).length === 0);
  }

  private resetGuests(count: number): void {
    this.attempted = false;
    this.errors.set([]);
    this.submitError.set(null);
    this.guests.clear();
    for (let i = 0; i < count; i++) this.guests.push(this.guestGroup());
    this.form.controls.data_consent.setValue(false);
  }

  private guestGroup(): FormGroup<GuestForm> {
    const rooms = this.info()?.rooms ?? [];
    return this.fb.group<GuestForm>({
      reservation_room_id: this.fb.control<number | null>(rooms.length === 1 ? rooms[0].id : null),
      document_type: this.fb.nonNullable.control('CC'),
      document_number: this.fb.nonNullable.control(''),
      first_name: this.fb.nonNullable.control(''),
      last_name: this.fb.nonNullable.control(''),
      nationality_country_code: this.fb.nonNullable.control(''),
      birth_date: this.fb.nonNullable.control(''),
      residence_city: this.fb.nonNullable.control(''),
      origin_city: this.fb.nonNullable.control(''),
      travel_purpose: this.fb.nonNullable.control(''),
    });
  }

  /** R-FORM-05 — the form opens on the first field of the first guest. */
  private focusFirstField(): void {
    const timer = setTimeout(() =>
      this.host
        .querySelector('[data-autofocus]')
        ?.querySelector<HTMLElement>('input:not([type="hidden"]), button')
        ?.focus(),
    );
    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }
}

/** Country catalog (synchronous `of`) with Spanish names, sorted. */
function countryOptions(countries: CountryService): SelectorOption[] {
  const names = new Intl.DisplayNames(['es'], { type: 'region' });
  const options: SelectorOption[] = [];
  countries.getCountries().subscribe((list) => {
    for (const country of list) {
      options.push({ value: country.code, label: names.of(country.code) ?? country.name });
    }
  });
  return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

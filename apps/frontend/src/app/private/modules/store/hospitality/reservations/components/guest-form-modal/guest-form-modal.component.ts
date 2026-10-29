import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { DOCUMENT_TYPES } from '../../../../../../../shared/constants/document-types';
import { CountryService } from '../../../../../../../core/services/country.service';
import { LodgingReservation, LodgingReservationRoom } from '../../interfaces/reservation.interface';
import {
  FOREIGN_DOCUMENT_TYPES,
  GuestField,
  guestFieldErrorMap,
  LodgingGuest,
  LodgingGuestRequest,
  reportsSire,
  resolveNationality,
  TRAVEL_PURPOSES,
} from '../../interfaces/guest.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

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
  entry_permit_type: FormControl<string>;
  is_non_resident: FormControl<boolean>;
  data_consent: FormControl<boolean>;
}

/** What the register asks the modal to do: edit a guest or add one. */
export interface GuestFormTarget {
  reservation: LodgingReservation;
  /** Guest to edit; null adds one. */
  guest: LodgingGuest | null;
  /** Adding the holder: prefilled from the reservation customer. */
  holder: boolean;
  /** Room the new guest sleeps in (picked from the room row). */
  room_id: number | null;
}

/**
 * Hospitality Suite (H3.1) — register the holder or a companion: document,
 * nationality and origin (TRA), birth date for foreigners (SIRE). Shows the
 * data-processing notice before saving; saving needs its acceptance.
 */
@Component({
  selector: 'app-guest-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    BadgeComponent,
  ],
  template: `
    <app-modal
      [isOpen]="target() !== null"
      (isOpenChange)="!$event && closed.emit()"
      (cancel)="closed.emit()"
      (opened)="reset()"
      [size]="'md'"
      [dialog]="true"
      [title]="title()"
      [subtitle]="target()?.reservation?.reservation_number ?? ''"
    >
      <form
        [formGroup]="form"
        id="guest-form"
        class="space-y-4"
        novalidate
        data-testid="guest-form"
        (ngSubmit)="onSubmit()"
      >
        @if (roomOptions().length > 1) {
          <app-selector
            formControlName="reservation_room_id"
            label="Habitación"
            placeholder="Elige la habitación"
            [required]="true"
            [options]="roomOptions()"
            [errorText]="roomError()"
          />
        }

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <app-selector
            formControlName="document_type"
            label="Tipo de documento"
            placeholder="Elige el tipo"
            [required]="true"
            [options]="documentTypeOptions"
            [errorText]="fieldErrors().document_type ?? ''"
          />
          <app-input
            formControlName="document_number"
            label="Número de documento"
            [required]="true"
            [error]="fieldErrors().document_number ?? ''"
            customWrapperClass="mt-0"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <app-input
            formControlName="first_name"
            label="Nombres"
            [required]="true"
            [error]="fieldErrors().first_name ?? ''"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="last_name"
            label="Apellidos"
            [required]="true"
            [error]="fieldErrors().last_name ?? ''"
            customWrapperClass="mt-0"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <app-selector
            formControlName="nationality_country_code"
            label="Nacionalidad"
            placeholder="Elige el país"
            [required]="nationalityRequired()"
            [searchable]="true"
            [options]="countryOptions"
            [errorText]="fieldErrors().nationality_country_code ?? ''"
          />
          <app-input
            formControlName="birth_date"
            label="Fecha de nacimiento"
            type="date"
            [required]="sire()"
            [error]="fieldErrors().birth_date ?? ''"
            customWrapperClass="mt-0"
          />
        </div>
        @if (sire()) {
          <div class="space-y-1" data-testid="guest-form-sire">
            <app-badge variant="warning" size="sm">Reporta a Migración (SIRE)</app-badge>
            <p class="text-xs text-text-secondary" data-testid="guest-form-sire-help">
              ¿Qué es esto? Los huéspedes extranjeros se reportan a Migración Colombia por el
              SIRE (Sistema de Información para el Reporte de Extranjeros). Por eso se piden la
              fecha de nacimiento y el permiso de ingreso.
            </p>
          </div>
        }

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <app-input
            formControlName="residence_city"
            label="Ciudad de residencia"
            [required]="true"
            [error]="fieldErrors().residence_city ?? ''"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="origin_city"
            label="Ciudad de procedencia"
            [required]="true"
            [error]="fieldErrors().origin_city ?? ''"
            customWrapperClass="mt-0"
          />
        </div>

        <app-selector
          formControlName="travel_purpose"
          label="Motivo de viaje"
          placeholder="Elige el motivo"
          [required]="true"
          [options]="purposeOptions"
          [errorText]="fieldErrors().travel_purpose ?? ''"
        />

        @if (sire()) {
          <div class="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <app-input
              formControlName="entry_permit_type"
              label="Permiso de ingreso"
              placeholder="Ej. PIP-5"
              customWrapperClass="mt-0"
            />
            <app-toggle formControlName="is_non_resident" label="No residente en Colombia" />
          </div>
        }

        @if (serverError()) {
          <p
            class="rounded-lg bg-error/10 px-3 py-2 text-sm font-medium text-text-primary"
            role="alert"
            data-testid="guest-errors"
          >
            {{ serverError() }}
          </p>
        }

        <div
          class="space-y-2 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary"
          data-testid="guest-data-notice"
        >
          <p class="font-medium text-text-primary">Aviso de tratamiento de datos personales</p>
          <p>
            Los datos del huésped se usan solo para el registro hotelero y los reportes que exige la
            ley (Tarjeta de Registro de Alojamiento del MinCIT y SIRE de Migración Colombia), según
            la Ley 1581 de 2012. El titular puede conocer, actualizar y rectificar sus datos.
          </p>
          <app-toggle
            formControlName="data_consent"
            label="El huésped conoce y acepta el aviso"
            data-testid="guest-data-consent"
          />
        </div>
      </form>

      <div slot="footer" class="flex flex-wrap items-center justify-end gap-2">
        @if (!consent()) {
          <p class="mr-auto text-xs text-text-secondary" data-testid="guest-consent-hint">
            Acepta el aviso de tratamiento de datos
          </p>
        }
        <app-button variant="ghost" (clicked)="closed.emit()">Cancelar</app-button>
        <app-button
          type="submit"
          form="guest-form"
          variant="primary"
          [loading]="saving()"
          [disabled]="!consent()"
          [ariaLabel]="consent() ? '' : 'Guardar: acepta el aviso de tratamiento de datos'"
          data-testid="guest-save"
        >
          <app-icon slot="icon" name="save" [size]="16" />
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class GuestFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly target = input<GuestFormTarget | null>(null);
  readonly closed = output<void>();
  readonly saved = output<LodgingGuest>();

  readonly saving = signal(false);
  /** U5 — messages under each field, shown after a save attempt. */
  readonly fieldErrors = signal<Partial<Record<GuestField, string>>>({});
  readonly roomError = signal('');
  /** API rejection that no single field owns. */
  readonly serverError = signal('');
  /** After a save attempt, fixing a field clears its message right away. */
  private attempted = false;
  readonly documentType = signal('');
  readonly nationality = signal('');
  readonly consent = signal(false);

  readonly documentTypeOptions: SelectorOption[] = DOCUMENT_TYPES.filter(
    (type) => type.code !== 'NIT',
  ).map((type) => ({ value: type.code, label: type.label }));

  readonly purposeOptions: SelectorOption[] = Object.entries(TRAVEL_PURPOSES).map(
    ([value, label]) => ({ value, label }),
  );

  /** Countries with their Spanish name ("Estados Unidos"). */
  readonly countryOptions: SelectorOption[] = countryOptions(inject(CountryService));

  readonly title = computed(() => {
    const target = this.target();
    if (target?.guest) return 'Editar huésped';
    return target?.holder ? 'Registrar titular' : 'Agregar acompañante';
  });
  readonly roomOptions = computed<SelectorOption[]>(() =>
    (this.target()?.reservation.rooms ?? [])
      .filter((room) => !room.cancelled_at)
      .map((room) => ({ value: room.id, label: roomLabel(room) })),
  );
  readonly nationalityRequired = computed(() =>
    FOREIGN_DOCUMENT_TYPES.includes(this.documentType()),
  );
  readonly sire = computed(() =>
    reportsSire(resolveNationality(this.documentType(), this.nationality())),
  );

  readonly form: FormGroup<GuestForm> = this.fb.group<GuestForm>({
    reservation_room_id: this.fb.control<number | null>(null),
    document_type: this.fb.nonNullable.control(''),
    document_number: this.fb.nonNullable.control(''),
    first_name: this.fb.nonNullable.control(''),
    last_name: this.fb.nonNullable.control(''),
    nationality_country_code: this.fb.nonNullable.control(''),
    birth_date: this.fb.nonNullable.control(''),
    residence_city: this.fb.nonNullable.control(''),
    origin_city: this.fb.nonNullable.control(''),
    travel_purpose: this.fb.nonNullable.control(''),
    entry_permit_type: this.fb.nonNullable.control(''),
    is_non_resident: this.fb.nonNullable.control(false),
    data_consent: this.fb.nonNullable.control(false),
  });

  constructor() {
    const { document_type, nationality_country_code, data_consent } = this.form.controls;
    document_type.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.documentType.set(value);
        // A passport is usually a non-resident visitor (IVA exemption, H3.9).
        if (value === 'PA') this.form.controls.is_non_resident.setValue(true);
      });
    nationality_country_code.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.nationality.set(value ?? ''));
    data_consent.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.consent.set(value));
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const target = this.target();
      if (this.attempted && target) this.validate(this.body(target));
    });
  }

  reset(): void {
    const target = this.target();
    if (!target) return;
    const guest = target.guest;
    const customer = target.holder ? target.reservation.customer : null;
    const rooms = this.roomOptions();
    this.form.reset({
      reservation_room_id:
        guest?.reservation_room_id ?? target.room_id ?? (rooms.length === 1 ? Number(rooms[0].value) : null),
      document_type: guest?.document_type ?? customer?.document_type ?? 'CC',
      document_number: guest?.document_number ?? customer?.document_number ?? '',
      first_name: guest?.first_name ?? customer?.first_name ?? '',
      last_name: guest?.last_name ?? customer?.last_name ?? '',
      nationality_country_code: guest?.nationality_country_code ?? '',
      birth_date: guest?.birth_date ?? '',
      residence_city: guest?.residence_city ?? '',
      origin_city: guest?.origin_city ?? '',
      travel_purpose: guest?.travel_purpose ?? '',
      entry_permit_type: guest?.entry_permit_type ?? '',
      is_non_resident: guest?.is_non_resident ?? false,
      data_consent: false,
    });
    const raw = this.form.getRawValue();
    this.documentType.set(raw.document_type);
    this.nationality.set(raw.nationality_country_code);
    this.consent.set(false);
    this.fieldErrors.set({});
    this.roomError.set('');
    this.serverError.set('');
    this.attempted = false;
  }

  onSubmit(): void {
    const target = this.target();
    if (!target || this.saving()) return;
    this.attempted = true;
    const body = this.body(target);
    if (!this.validate(body) || !body.data_consent) {
      this.form.markAllAsTouched();
      return;
    }
    this.serverError.set('');

    const reservationId = target.reservation.id;
    const request = target.guest
      ? this.reservationsService.updateGuest(reservationId, target.guest.id, body)
      : this.reservationsService.createGuest(reservationId, body);
    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (guest) => {
        this.saving.set(false);
        this.toastService.success(target.guest ? 'Huésped actualizado' : 'Huésped registrado');
        this.saved.emit(guest);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        const text = typeof message === 'string' ? message : 'No se pudo guardar el huésped';
        this.serverError.set(text);
      },
    });
  }

  /** Request body from the form, trimmed. */
  private body(target: GuestFormTarget): LodgingGuestRequest {
    const raw = this.form.getRawValue();
    const foreign = this.sire();
    return {
      reservation_room_id: raw.reservation_room_id ?? undefined,
      customer_id: target.guest?.customer_id ?? (target.holder ? target.reservation.customer.id : undefined),
      is_primary: target.guest ? undefined : target.holder,
      document_type: raw.document_type,
      document_number: raw.document_number.trim(),
      first_name: raw.first_name.trim(),
      last_name: raw.last_name.trim(),
      nationality_country_code: raw.nationality_country_code || undefined,
      birth_date: raw.birth_date || undefined,
      residence_city: raw.residence_city.trim(),
      origin_city: raw.origin_city.trim(),
      travel_purpose: raw.travel_purpose,
      entry_permit_type: foreign ? raw.entry_permit_type.trim() || undefined : undefined,
      is_non_resident: foreign ? raw.is_non_resident : false,
      data_consent: raw.data_consent,
    };
  }

  /** Writes the error under each field; true when nothing is missing. */
  private validate(body: LodgingGuestRequest): boolean {
    const errors = guestFieldErrorMap(body);
    const roomMissing = this.roomOptions().length > 1 && !body.reservation_room_id;
    this.fieldErrors.set(errors);
    this.roomError.set(roomMissing ? 'Elige la habitación' : '');
    return Object.keys(errors).length === 0 && !roomMissing;
  }
}

/** "Doble · 101" or "Doble · Sin asignar". */
export function roomLabel(room: LodgingReservationRoom): string {
  return `${room.unit_type.name} · ${room.unit?.code ?? 'Sin asignar'}`;
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

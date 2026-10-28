import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, merge, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  QuantityControlComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import { PosCustomer } from '../../../../pos/models/customer.model';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import {
  CreateReservationRequest,
  formatNightBreakdown,
  LodgingReservation,
  ReservationQuote,
  ReservationQuoteRequest,
  RESTRICTION_OVERRIDE_PERMISSION,
} from '../../interfaces/reservation.interface';
import { describePolicy, SellableRatePlan } from '../../../rates/interfaces/rate-plan.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { storeToday } from '../../../../../../../shared/utils/date.util';

interface RoomLineForm {
  unit_type_id: FormControl<number | null>;
  /** H2.1 — rate plan id; `BASE_PRICE` = room type base price. */
  rate_plan_id: FormControl<number>;
  adults: FormControl<number>;
  children: FormControl<number>;
}

/**
 * U6 — a stay started from a free rack cell: that room and that night. The
 * reservation is booked by type and the room is assigned right after.
 */
export interface ReservationPrefill {
  arrival_date: string;
  unit_type_id: number;
  unit_id: number;
  /** Room code as the desk says it ("904"). */
  unit_code: string;
}

/** Plan option value for "no plan": the room type base price. */
const BASE_PRICE = 0;

interface ReservationForm {
  arrival_date: FormControl<string>;
  departure_date: FormControl<string>;
  rooms: FormArray<FormGroup<RoomLineForm>>;
  notes: FormControl<string>;
}

/** One quote per room line, in the order of the lines. */
type QuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; quotes: ReservationQuote[]; requested: Map<number, number> }
  | { kind: 'error'; message: string };

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-10` → `10-nov` (same short date the API uses in its messages). */
export function formatShortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}-${MONTHS[month - 1]}`;
}

/**
 * Hospitality Suite (H1.1/H1.5) — new nightly reservation: dates plus one or
 * more rooms ("Agregar habitación"), each with its type and occupancy, quoted
 * live ("2 disponibles · 3 noches · $750.000"; with several rooms the
 * consolidated total). The holder is picked or created with the shared POS
 * customer selector. The backend sells all the rooms or none.
 * H2.1 — each room picks a rate plan that prices its type (the default plan
 * is preselected) and shows the per-night breakdown
 * ("jue $250.000 · vie $320.000 = $570.000").
 */
@Component({
  selector: 'app-reservation-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    QuantityControlComponent,
    TextareaComponent,
    PosCustomerSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="reset()"
      [size]="'md'"
      [dialog]="true"
      [title]="walkIn() ? 'Llegada sin reserva' : 'Nueva reserva'"
      [subtitle]="
        walkIn()
          ? 'Llega hoy: al guardar se hace el check-in'
          : 'Huésped, fechas, habitación y tarifa'
      "
    >
      <!-- Outside the form: the selector has its own form, and Enter in its
           search only searches, it never submits the booking. -->
      <div class="mb-4 space-y-2" data-testid="reservation-customer">
        <p class="mb-2 block text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--color-text-muted)]">
          Huésped <span class="ml-1 text-[var(--color-destructive)]" aria-hidden="true">*</span>
        </p>
        @if (customer(); as c) {
          <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span class="flex items-center gap-2 text-sm">
              <app-icon name="user-check" [size]="16" />
              {{ c.first_name }} {{ c.last_name ?? '' }}
            </span>
            <app-button variant="ghost" size="sm" (clicked)="clearCustomer()">
              Cambiar
            </app-button>
          </div>
        } @else {
          <app-pos-customer-selector (customerSelected)="customer.set($event)" />
        }
        @if (submitted() && !customer()) {
          <p class="text-xs text-error" role="alert" data-testid="reservation-customer-error">
            Busca o crea el huésped
          </p>
        }
      </div>

      <form
        [formGroup]="form"
        id="reservation-form"
        class="space-y-4"
        novalidate
        (ngSubmit)="onSubmit()"
      >
        <div class="grid grid-cols-2 gap-3">
          <app-input
            formControlName="arrival_date"
            label="Llegada"
            type="date"
            [required]="true"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="departure_date"
            label="Salida"
            type="date"
            [required]="true"
            [error]="datesError()"
            customWrapperClass="mt-0"
          />
        </div>

        <div formArrayName="rooms" class="space-y-3">
          @for (line of form.controls.rooms.controls; track line; let i = $index) {
            <div
              [formGroupName]="i"
              class="grid grid-cols-2 gap-3 rounded-lg border border-border p-3"
              data-testid="reservation-room-line"
            >
              <div class="col-span-2 flex items-end gap-2">
                <app-selector
                  class="flex-1"
                  formControlName="unit_type_id"
                  [label]="lineCount() > 1 ? 'Habitación ' + (i + 1) : 'Habitación'"
                  placeholder="Elige el tipo de habitación"
                  [required]="true"
                  [options]="typeOptions()"
                  [errorText]="roomError(line)"
                  data-testid="reservation-room-type"
                />
                @if (lineCount() > 1) {
                  <app-button
                    variant="ghost"
                    size="sm"
                    [ariaLabel]="'Quitar habitación ' + (i + 1)"
                    (clicked)="removeRoom(i)"
                  >
                    <app-icon name="trash-2" [size]="16" />
                  </app-button>
                }
              </div>
              @if (i === 0 && prefilledRoom(); as room) {
                <p class="col-span-2 -mt-1 flex items-center gap-1 text-xs font-medium text-text-primary" data-testid="reservation-prefilled-room">
                  <app-icon name="door-open" [size]="14" />
                  Habitación {{ room }}: se asigna al crear la reserva
                </p>
              }
              @if (planOptionsFor(line.controls.unit_type_id.value); as plans) {
                <app-selector
                  class="col-span-2"
                  formControlName="rate_plan_id"
                  label="Tarifa"
                  [options]="plans"
                  data-testid="reservation-rate-plan"
                />
              }
              <div data-testid="reservation-adults">
                <p class="mb-2 block text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--color-text-muted)]">
                  Adultos <span class="ml-1 text-[var(--color-destructive)]" aria-hidden="true">*</span>
                </p>
                <app-quantity-control
                  size="md"
                  [min]="1"
                  [max]="maxGuests"
                  [value]="line.controls.adults.value"
                  (valueChange)="line.controls.adults.setValue($event)"
                />
              </div>
              <div data-testid="reservation-children">
                <p class="mb-2 block text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--color-text-muted)]">Niños</p>
                <app-quantity-control
                  size="md"
                  [min]="0"
                  [max]="maxGuests"
                  [value]="line.controls.children.value"
                  (valueChange)="line.controls.children.setValue($event)"
                />
              </div>
              @if (lineBreakdown(i); as breakdown) {
                <p
                  class="col-span-2 text-xs text-text-secondary"
                  data-testid="reservation-night-breakdown"
                >
                  {{ breakdown }}
                </p>
              }
              @if (lineTerms(i); as terms) {
                <p class="col-span-2 text-xs text-text-secondary" data-testid="reservation-line-terms">
                  {{ terms }}
                </p>
              }
            </div>
          }
          <app-button
            variant="outline"
            size="sm"
            [disabled]="lineCount() >= maxRooms"
            (clicked)="addRoom()"
          >
            <app-icon slot="icon" name="plus" [size]="16" />
            Agregar habitación
          </app-button>
        </div>

        <div
          class="rounded-lg border border-border px-3 py-2 text-sm"
          data-testid="reservation-quote"
        >
          @switch (quoteState().kind) {
            @case ('loading') {
              <span class="text-text-secondary">Consultando disponibilidad…</span>
            }
            @case ('error') {
              <span class="text-error" role="alert">{{ quoteMessage() }}</span>
            }
            @case ('ready') {
              <span [class]="canBook() ? 'font-semibold text-text-primary' : 'text-error'">
                {{ quoteMessage() }}
              </span>
              @if (allotmentHint()) {
                <p class="mt-1 text-xs text-text-secondary" data-testid="reservation-allotment">
                  En cupo de agencias o empresas: {{ allotmentHint() }}
                </p>
              }
              @if (restrictionMessages().length) {
                <ul class="mt-1 space-y-0.5 text-xs font-semibold text-error" data-testid="reservation-restrictions">
                  @for (message of restrictionMessages(); track message) {
                    <li>{{ message }}</li>
                  }
                </ul>
              }
              @if (canBook() && overbookingAlert()) {
                <p
                  class="mt-1 text-xs font-semibold text-primary"
                  data-testid="reservation-overbooking"
                >
                  {{ overbookingAlert() }}
                </p>
              }
            }
            @default {
              <span class="text-text-secondary">
                Elige las fechas y la habitación para ver la disponibilidad.
              </span>
            }
          }
        </div>

        @if (canBook() && restrictionMessages().length && !canOverride()) {
          <p class="text-sm text-text-secondary" data-testid="reservation-override-denied">
            Pide a un usuario con permiso de tarifas que fuerce la reserva.
          </p>
        } @else if (canBook() && restrictionMessages().length) {
          <app-input
            [formControl]="overrideControl"
            label="Motivo para forzar la reserva"
            type="text"
            placeholder="Ej. Cliente frecuente, autorizado por gerencia"
            helperText="Requiere permiso para editar tarifas. Queda en el historial de la reserva."
            [required]="true"
            [error]="submitted() && !overrideReason().trim() ? 'Escribe el motivo para forzar la reserva' : ''"
            customWrapperClass="mt-0"
            data-testid="reservation-override-reason"
          />
        }

        <app-textarea
          formControlName="notes"
          label="Notas"
          placeholder="Opcional: hora de llegada, preferencias, celebraciones…"
          [rows]="3"
          customWrapperClass="mt-0"
          data-testid="reservation-notes"
        />
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          type="submit"
          form="reservation-form"
          variant="primary"
          [loading]="saving()"
          data-testid="reservation-submit"
        >
          <app-icon slot="icon" [name]="walkIn() ? 'log-in' : 'calendar-check'" [size]="16" />
          {{ walkIn() ? 'Guardar y hacer check-in' : 'Crear reserva' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ReservationFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  readonly isOpen = input(false);
  /**
   * U1 — "Llegada sin reserva": the stay starts today (store day) and the
   * parent checks the guest in once the reservation is saved.
   */
  readonly walkIn = input(false);
  readonly unitTypes = input<UnitType[]>([]);
  /** U6 — room and arrival chosen on the rack; null = an ordinary booking. */
  readonly prefill = input<ReservationPrefill | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<LodgingReservation>();

  readonly saving = signal(false);
  readonly customer = signal<PosCustomer | null>(null);
  readonly quoteState = signal<QuoteState>({ kind: 'idle' });
  /** H2.1 — active plans with the room types each one prices. */
  readonly ratePlans = signal<SellableRatePlan[]>([]);
  /** Number of room lines (the FormArray length is not a signal). */
  readonly lineCount = signal(1);
  /** Same cap as the API (`MAX_ROOMS_PER_RESERVATION`). */
  readonly maxRooms = 30;
  /** Guests per room the +/− control allows. */
  readonly maxGuests = 20;
  /** U5 — a submit attempt shows every missing field under it. */
  readonly submitted = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  /** Line values as a signal (the form is not), for the prefilled room hint. */
  private readonly formValue = signal(this.emptyFormValue());

  /**
   * U6 — code of the rack room this booking takes, while the first line still
   * asks for its type and the stay is a single room.
   */
  readonly prefilledRoom = computed(() => {
    const prefill = this.prefill();
    const rooms = this.formValue().rooms;
    return prefill && rooms.length === 1 && Number(rooms[0]?.unit_type_id) === prefill.unit_type_id
      ? prefill.unit_code
      : null;
  });

  readonly typeOptions = computed<SelectorOption[]>(() =>
    this.unitTypes()
      .filter((t) => t.is_active)
      .map((t) => ({ value: t.id, label: t.name })),
  );

  /**
   * Plan options per room type: plans that price it (default first) plus
   * the base price. Types no plan prices get none (the selector hides).
   */
  private readonly planOptionsByType = computed(() => {
    const byType = new Map<number, SelectorOption[]>();
    for (const type of this.unitTypes()) {
      const plans = this.ratePlans().filter((p) => p.unit_type_ids.includes(type.id));
      if (plans.length === 0) continue;
      byType.set(type.id, [
        ...plans.map((p) => ({ value: p.id, label: p.name })),
        { value: BASE_PRICE, label: 'Precio base del tipo' },
      ]);
    }
    return byType;
  });

  /** First type (by id, like the API) asking more rooms than are free. */
  private readonly shortage = computed(() => {
    const state = this.quoteState();
    if (state.kind !== 'ready') return null;
    for (const [typeId, requested] of [...state.requested].sort((a, b) => a[0] - b[0])) {
      const quote = state.quotes.find((q) => q.unit_type.id === typeId);
      if (quote && quote.available < requested) return quote;
    }
    return null;
  });

  readonly canBook = computed(
    () => this.quoteState().kind === 'ready' && this.shortage() === null,
  );

  /** H2.3 — restrictions the stay breaks, once per message across the rooms. */
  readonly restrictionMessages = computed(() => {
    const state = this.quoteState();
    if (state.kind !== 'ready') return [];
    return [...new Set(state.quotes.flatMap((q) => q.restrictions ?? []))];
  });

  /** H2.3 — only owners or users with rates:write may force restrictions. */
  readonly canOverride = computed(
    () =>
      this.authFacade.ownerFlag() ||
      this.authFacade.userPermissions().includes(RESTRICTION_OVERRIDE_PERMISSION),
  );

  /** Free rooms, and a reason from a user who may force a broken restriction. */
  readonly canConfirm = computed(
    () =>
      this.canBook() &&
      (this.restrictionMessages().length === 0 ||
        (this.canOverride() && this.overrideReason().trim().length > 0)),
  );

  /**
   * H1.6 — the sale fits only thanks to the type's overbooking allowance:
   * "Sobreventa: 3/2 Doble estándar" (rooms sold after it / active rooms).
   */
  readonly overbookingAlert = computed(() => {
    const state = this.quoteState();
    if (state.kind !== 'ready') return '';
    return [...state.requested]
      .sort((a, b) => a[0] - b[0])
      .flatMap(([typeId, requested]) => {
        const quote = state.quotes.find((q) => q.unit_type.id === typeId);
        if (!quote || quote.sold + requested <= quote.units) return [];
        return [`Sobreventa: ${quote.sold + requested}/${quote.units} ${quote.unit_type.name}`];
      })
      .join(' · ');
  });

  /** H2.5 — "3 Doble estándar en cupo de agencias" (not for this holder). */
  readonly allotmentHint = computed(() => {
    const state = this.quoteState();
    if (state.kind !== 'ready') return '';
    return state.quotes
      .filter((q, i, all) => q.held > 0 && all.findIndex((x) => x.unit_type.id === q.unit_type.id) === i)
      .map((q) => `${q.held} ${q.unit_type.name}`)
      .join(', ');
  });

  readonly quoteMessage = computed(() => {
    const state = this.quoteState();
    if (state.kind === 'error') return state.message;
    if (state.kind !== 'ready') return '';
    const short = this.shortage();
    if (short) {
      const raw = this.form.getRawValue();
      const left = short.available > 0 ? ` (quedan ${short.available})` : '';
      return `Sin disponibilidad de ${short.unit_type.name} para el ${formatShortDate(raw.arrival_date)} al ${formatShortDate(raw.departure_date)}${left}`;
    }
    const [first] = state.quotes;
    const nights = `${first.nights} ${first.nights === 1 ? 'noche' : 'noches'}`;
    const total = state.quotes.reduce((sum, q) => sum + Number(q.total_amount), 0);
    const amount = this.currency.format(total, 0);
    if (state.quotes.length === 1) {
      const available = `${first.available} ${first.available === 1 ? 'disponible' : 'disponibles'}`;
      return `${available} · ${nights} · ${amount}`;
    }
    return `${state.quotes.length} habitaciones · ${nights} · ${amount}`;
  });

  readonly form: FormGroup<ReservationForm> = this.fb.group<ReservationForm>({
    arrival_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    departure_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    rooms: this.fb.array([this.roomLine(null)]),
    notes: this.fb.nonNullable.control('', { validators: [Validators.maxLength(1000)] }),
  });

  /**
   * H2.3 — reason to force a stay that breaks restrictions. Outside the form
   * on purpose: typing it must not quote the stay again.
   */
  readonly overrideControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(300)],
  });
  readonly overrideReason = toSignal(this.overrideControl.valueChanges, { initialValue: '' });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.formValue.set(this.form.getRawValue()));
    // H2.5 — the holder matters too: an agency also sees its allotment rooms.
    merge(this.form.valueChanges, toObservable(this.customer))
      .pipe(
        map(() => this.quoteRequest()),
        tap((request) =>
          this.quoteState.set(request ? { kind: 'loading' } : { kind: 'idle' }),
        ),
        debounceTime(300),
        switchMap((request) =>
          request
            ? forkJoin(request.map((line) => this.reservationsService.quote(line))).pipe(
                map((quotes): QuoteState => ({
                  kind: 'ready',
                  quotes,
                  requested: countByType(request),
                })),
                catchError((message: unknown) =>
                  of<QuoteState>({
                    kind: 'error',
                    message:
                      typeof message === 'string'
                        ? message
                        : 'No se pudo consultar la disponibilidad',
                  }),
                ),
              )
            : of<QuoteState>({ kind: 'idle' }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.quoteState.set(state));
  }

  reset(): void {
    const rooms = this.form.controls.rooms;
    rooms.clear({ emitEvent: false });
    rooms.push(this.roomLine(null), { emitEvent: false });
    this.lineCount.set(1);
    // U5 — arrival today and departure tomorrow (a walk-in always arrives today).
    // U6 — from a rack cell: that night and that room's type instead.
    const prefill = this.walkIn() ? null : this.prefill();
    const arrival = prefill?.arrival_date ?? storeToday(this.settingsFacade.timezone());
    this.form.reset({
      arrival_date: arrival,
      departure_date: nextDay(arrival),
      rooms: [
        {
          unit_type_id: prefill?.unit_type_id ?? this.defaultTypeId(),
          rate_plan_id: BASE_PRICE,
          adults: 1,
          children: 0,
        },
      ],
      notes: '',
    });
    this.formValue.set(this.form.getRawValue());
    this.submitted.set(false);
    if (!prefill) this.pickFirstFreeType(arrival, nextDay(arrival));
    this.focusCustomerSoon();
    // A walk-in arrives today: only the departure is chosen.
    if (this.walkIn()) this.form.controls.arrival_date.disable({ emitEvent: false });
    else this.form.controls.arrival_date.enable({ emitEvent: false });
    this.overrideControl.reset('');
    this.customer.set(null);
    this.customerSelector()?.reset();
    this.quoteState.set({ kind: 'idle' });
    // Plans may have changed since the last opening: reload, then preselect.
    this.reservationsService
      .sellableRatePlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plans) => {
          this.ratePlans.set(plans);
          for (const line of this.form.controls.rooms.controls) {
            line.controls.rate_plan_id.setValue(this.defaultPlanFor(line.controls.unit_type_id.value));
          }
        },
        error: () => this.ratePlans.set([]),
      });
  }

  planOptionsFor(unitTypeId: number | null): SelectorOption[] | null {
    return unitTypeId == null ? null : (this.planOptionsByType().get(unitTypeId) ?? null);
  }

  addRoom(): void {
    const rooms = this.form.controls.rooms;
    if (rooms.length >= this.maxRooms) return;
    // A new line repeats the last type: groups usually book several alike.
    const last = rooms.at(rooms.length - 1)?.controls.unit_type_id.value ?? null;
    rooms.push(this.roomLine(last ?? this.defaultTypeId()));
    this.lineCount.set(rooms.length);
  }

  removeRoom(index: number): void {
    const rooms = this.form.controls.rooms;
    if (rooms.length < 2) return;
    rooms.removeAt(index);
    this.lineCount.set(rooms.length);
  }

  /**
   * Per-night breakdown of a line once quoted (H2.1), e.g. "Con desayuno ·
   * jue $250.000 · vie $320.000 = $570.000"; with several rooms it starts
   * with the type.
   */
  lineBreakdown(index: number): string | null {
    const state = this.quoteState();
    if (state.kind !== 'ready') return null;
    const quote = state.quotes[index];
    if (!quote) return null;
    const nights = formatNightBreakdown(quote.night_rates, (amount) =>
      this.currency.format(amount, 0),
    );
    return [
      state.quotes.length > 1 ? quote.unit_type.name : null,
      quote.rate_plan?.name ?? 'Precio base',
      nights,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * H2.4 — what the guest agrees to with the line's plan: "Cancelación:
   * Flexible (gratis hasta 48 h antes, luego 1 noche…) · Depósito 30 %".
   */
  lineTerms(index: number): string | null {
    const state = this.quoteState();
    if (state.kind !== 'ready') return null;
    const quote = state.quotes[index];
    if (!quote?.rate_plan) return null;
    const policy = quote.cancellation_policy;
    const deposit = Number(quote.deposit_percent ?? 0);
    return [
      `Cancelación: ${policy ? `${policy.name} (${describePolicy(policy)})` : 'gratis'}`,
      deposit > 0 ? `Depósito ${deposit} %` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  clearCustomer(): void {
    this.customer.set(null);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  /** "La salida debe ser después de la llegada" under the departure. */
  datesError(): string {
    const { arrival_date, departure_date } = this.form.getRawValue();
    return arrival_date && departure_date && departure_date <= arrival_date
      ? 'La salida debe ser después de la llegada'
      : '';
  }

  /** "Elige una habitación" under a room line left without a type. */
  roomError(line: FormGroup<RoomLineForm>): string {
    const control = line.controls.unit_type_id;
    // The emptied selector gives '' rather than null.
    return !control.value && (control.touched || this.submitted())
      ? 'Elige una habitación'
      : '';
  }

  onSubmit(): void {
    if (this.saving()) return;
    const request = this.quoteRequest();
    const customer = this.customer();
    if (!request || !customer || !this.canConfirm() || this.datesError()) {
      // R-FORM-02 — mark what is missing under each field and go to the first.
      this.submitted.set(true);
      this.form.markAllAsTouched();
      this.focusFirstError();
      return;
    }

    this.saving.set(true);
    const raw = this.form.getRawValue();
    const payload: CreateReservationRequest = {
      arrival_date: raw.arrival_date,
      departure_date: raw.departure_date,
      rooms: request.map(({ unit_type_id, adults, children, rate_plan_id }) => ({
        unit_type_id,
        adults,
        children,
        rate_plan_id,
      })),
      customer_id: Number(customer.id),
      notes: raw.notes.trim() || undefined,
      restriction_override_reason: this.restrictionMessages().length
        ? this.overrideControl.value.trim()
        : undefined,
    };
    this.reservationsService
      .create(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reservation) => {
          const room = this.prefilledRoom();
          if (room && !this.walkIn()) {
            this.assignPrefilledRoom(reservation, room);
            return;
          }
          this.saving.set(false);
          // A walk-in gets the check-in toast instead, once the parent checks in.
          if (!this.walkIn()) {
            this.toastService.success(`Reserva ${reservation.reservation_number} confirmada`);
          }
          this.saved.emit(reservation);
          this.isOpenChange.emit(false);
        },
        error: (message: unknown) => {
          this.saving.set(false);
          const text =
            typeof message === 'string' ? message : 'No se pudo crear la reserva';
          this.quoteState.set({ kind: 'error', message: text });
          this.toastService.error(text);
        },
      });
  }

  /**
   * U6 — puts the booked room in the rack room it was started from. Same
   * type and dates, so nothing is repriced; if the room was taken meanwhile
   * the booking stays confirmed without a room and the desk is told.
   */
  private assignPrefilledRoom(reservation: LodgingReservation, code: string): void {
    const prefill = this.prefill();
    const room = reservation.rooms.find((r) => !r.cancelled_at);
    const finish = (saved: LodgingReservation) => {
      this.saving.set(false);
      this.saved.emit(saved);
      this.isOpenChange.emit(false);
    };
    if (!prefill || !room) {
      this.toastService.success(`Reserva ${reservation.reservation_number} confirmada`);
      finish(reservation);
      return;
    }
    this.reservationsService
      .changeRoom(room.id, { unit_id: prefill.unit_id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.toastService.success(
            `Reserva ${reservation.reservation_number} confirmada en la ${code}`,
          );
          finish(updated);
        },
        error: (message: unknown) => {
          this.toastService.warning(
            `Reserva ${reservation.reservation_number} confirmada sin habitación: ` +
              (typeof message === 'string' ? message : `no se pudo asignar la ${code}`) +
              '. Asígnala desde el detalle.',
            undefined,
            6000,
          );
          finish(reservation);
        },
      });
  }

  /** One quote request per room line, or null while the stay is incomplete. */
  private quoteRequest(): ReservationQuoteRequest[] | null {
    const raw = this.form.getRawValue();
    if (
      !raw.arrival_date ||
      !raw.departure_date ||
      raw.rooms.length === 0 ||
      raw.rooms.some((room) => !room.unit_type_id)
    ) {
      return null;
    }
    return raw.rooms.map((room) => ({
      unit_type_id: Number(room.unit_type_id),
      arrival_date: raw.arrival_date,
      departure_date: raw.departure_date,
      adults: Number(room.adults) || 0,
      children: Number(room.children) || 0,
      rate_plan_id: this.planIdFor(room.unit_type_id, room.rate_plan_id),
      customer_id: this.customer()?.id,
    }));
  }

  /** The line's plan when it prices the type; otherwise base price (none). */
  private planIdFor(unitTypeId: number | null, planId: number): number | undefined {
    if (planId === BASE_PRICE || unitTypeId == null) return undefined;
    const plan = this.ratePlans().find((p) => p.id === planId);
    return plan?.unit_type_ids.includes(unitTypeId) ? planId : undefined;
  }

  /** Default plan when it prices the type; otherwise the base price. */
  private defaultPlanFor(unitTypeId: number | null): number {
    const plan = this.ratePlans().find((p) => p.is_default);
    return plan && unitTypeId != null && plan.unit_type_ids.includes(unitTypeId)
      ? plan.id
      : BASE_PRICE;
  }

  private roomLine(unitTypeId: number | null): FormGroup<RoomLineForm> {
    const line = this.fb.group<RoomLineForm>({
      unit_type_id: this.fb.control<number | null>(unitTypeId, {
        validators: [Validators.required],
      }),
      rate_plan_id: this.fb.nonNullable.control(this.defaultPlanFor(unitTypeId)),
      adults: this.fb.nonNullable.control(1, { validators: [Validators.min(1)] }),
      children: this.fb.nonNullable.control(0, { validators: [Validators.min(0)] }),
    });
    // A new type preselects the default plan again (or the base price).
    line.controls.unit_type_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((typeId) => line.controls.rate_plan_id.setValue(this.defaultPlanFor(typeId)));
    return line;
  }

  /**
   * U5 — the first room type with a free room for the default stay, while the
   * receptionist has not changed the single line yet.
   */
  private pickFirstFreeType(arrival: string, departure: string): void {
    const types = this.typeOptions().map((option) => Number(option.value));
    if (types.length < 2) return;
    const line = this.form.controls.rooms.at(0);
    const initial = line.controls.unit_type_id.value;
    forkJoin(
      types.map((unit_type_id) =>
        this.reservationsService
          .quote({ unit_type_id, arrival_date: arrival, departure_date: departure, adults: 1, children: 0 })
          .pipe(catchError(() => of(null))),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((quotes) => {
        const free = quotes.find((quote) => quote && quote.available > 0);
        const untouched =
          this.lineCount() === 1 &&
          line.controls.unit_type_id.value === initial &&
          !line.controls.unit_type_id.dirty;
        if (free && untouched && free.unit_type.id !== initial) {
          line.controls.unit_type_id.setValue(free.unit_type.id);
        }
      });
  }

  /**
   * R-FORM-05 — the form opens on "Huésped" (the customer search), after the
   * modal moved the focus to its own container.
   */
  private focusCustomerSoon(): void {
    setTimeout(() => {
      const block = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="reservation-customer"]',
      );
      const search = block?.querySelector<HTMLInputElement>('input');
      if (search) {
        search.focus();
        return;
      }
      // The shared selector resets to its summary: open its search first.
      block?.querySelector<HTMLButtonElement>('button')?.click();
      setTimeout(() => block?.querySelector<HTMLInputElement>('input')?.focus());
    }, 250);
  }

  /** Moves to the first field that says what is missing. */
  private focusFirstError(): void {
    setTimeout(() => {
      const root = this.host.nativeElement;
      const roomIndex = this.form.controls.rooms.controls.findIndex((line) => this.roomError(line));
      const target = !this.customer()
        ? root.querySelector<HTMLElement>('[data-testid="reservation-customer"] input')
        : (root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
          (roomIndex >= 0
            ? root.querySelectorAll<HTMLElement>('[data-testid="reservation-room-type"]')[roomIndex]
                ?.querySelector<HTMLElement>('select, button')
            : null) ??
          root.querySelector<HTMLElement>('[data-testid="reservation-quote"]'));
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target?.focus?.();
    });
  }

  private emptyFormValue(): ReturnType<FormGroup<ReservationForm>['getRawValue']> {
    return { arrival_date: '', departure_date: '', rooms: [], notes: '' };
  }

  private defaultTypeId(): number | null {
    return (this.typeOptions()[0]?.value as number | undefined) ?? null;
  }
}

/** `2026-11-10` → `2026-11-11`. */
function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Rooms asked per type id. */
function countByType(lines: ReservationQuoteRequest[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const line of lines) {
    counts.set(line.unit_type_id, (counts.get(line.unit_type_id) ?? 0) + 1);
  }
  return counts;
}

import {
  Component,
  computed,
  DestroyRef,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
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
} from '../../interfaces/reservation.interface';
import { SellableRatePlan } from '../../../rates/interfaces/rate-plan.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface RoomLineForm {
  unit_type_id: FormControl<number | null>;
  /** H2.1 — rate plan id; `BASE_PRICE` = room type base price. */
  rate_plan_id: FormControl<number>;
  adults: FormControl<number>;
  children: FormControl<number>;
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
      title="Nueva reserva"
      subtitle="Fechas, habitaciones y huésped titular"
    >
      <form [formGroup]="form" class="space-y-4">
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
                  [label]="lineCount() > 1 ? 'Habitación ' + (i + 1) : 'Tipo de habitación'"
                  placeholder="Selecciona un tipo"
                  [required]="true"
                  [options]="typeOptions()"
                />
                @if (lineCount() > 1) {
                  <app-button
                    variant="ghost"
                    size="sm"
                    [attr.aria-label]="'Quitar habitación ' + (i + 1)"
                    (clicked)="removeRoom(i)"
                  >
                    <app-icon name="trash-2" [size]="16" />
                  </app-button>
                }
              </div>
              @if (planOptionsFor(line.controls.unit_type_id.value); as plans) {
                <app-selector
                  class="col-span-2"
                  formControlName="rate_plan_id"
                  label="Plan tarifario"
                  [options]="plans"
                  data-testid="reservation-rate-plan"
                />
              }
              <app-input
                formControlName="adults"
                label="Adultos"
                type="number"
                [min]="1"
                [required]="true"
                customWrapperClass="mt-0"
              />
              <app-input
                formControlName="children"
                label="Niños"
                type="number"
                [min]="0"
                customWrapperClass="mt-0"
              />
              @if (lineBreakdown(i); as breakdown) {
                <p
                  class="col-span-2 text-xs text-text-secondary"
                  data-testid="reservation-night-breakdown"
                >
                  {{ breakdown }}
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
              <span class="text-red-600">{{ quoteMessage() }}</span>
            }
            @case ('ready') {
              <span [class]="canBook() ? 'font-semibold text-text-primary' : 'text-red-600'">
                {{ quoteMessage() }}
              </span>
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
                Elige las fechas y el tipo para ver la disponibilidad.
              </span>
            }
          }
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium text-text-primary">Huésped titular</p>
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
        </div>

        <app-input
          formControlName="notes"
          label="Notas"
          type="text"
          placeholder="Opcional"
          customWrapperClass="mt-0"
        />
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="saving()"
          [disabled]="!canBook() || !customer()"
          (clicked)="onSubmit()"
        >
          <app-icon slot="icon" name="calendar-check" [size]="16" />
          Confirmar
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

  readonly isOpen = input(false);
  readonly unitTypes = input<UnitType[]>([]);

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
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

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

  constructor() {
    this.form.valueChanges
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
    this.form.reset({
      arrival_date: '',
      departure_date: '',
      rooms: [{ unit_type_id: this.defaultTypeId(), rate_plan_id: BASE_PRICE, adults: 2, children: 0 }],
      notes: '',
    });
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

  clearCustomer(): void {
    this.customer.set(null);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    const request = this.quoteRequest();
    const customer = this.customer();
    if (!request || !customer || !this.canBook()) return;

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
    };
    this.reservationsService
      .create(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reservation) => {
          this.saving.set(false);
          this.toastService.success(
            `Reserva ${reservation.reservation_number} confirmada`,
          );
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

  /** One quote request per room line, or null while the stay is incomplete. */
  private quoteRequest(): ReservationQuoteRequest[] | null {
    const raw = this.form.getRawValue();
    if (
      !raw.arrival_date ||
      !raw.departure_date ||
      raw.rooms.length === 0 ||
      raw.rooms.some((room) => room.unit_type_id == null)
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
      adults: this.fb.nonNullable.control(2, { validators: [Validators.min(1)] }),
      children: this.fb.nonNullable.control(0, { validators: [Validators.min(0)] }),
    });
    // A new type preselects the default plan again (or the base price).
    line.controls.unit_type_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((typeId) => line.controls.rate_plan_id.setValue(this.defaultPlanFor(typeId)));
    return line;
  }

  private defaultTypeId(): number | null {
    return (this.typeOptions()[0]?.value as number | undefined) ?? null;
  }
}

/** Rooms asked per type id. */
function countByType(lines: ReservationQuoteRequest[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const line of lines) {
    counts.set(line.unit_type_id, (counts.get(line.unit_type_id) ?? 0) + 1);
  }
  return counts;
}

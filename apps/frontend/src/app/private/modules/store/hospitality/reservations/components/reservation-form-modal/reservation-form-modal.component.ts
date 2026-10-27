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
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
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
  LodgingReservation,
  ReservationQuote,
  ReservationQuoteRequest,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface ReservationForm {
  unit_type_id: FormControl<number | null>;
  arrival_date: FormControl<string>;
  departure_date: FormControl<string>;
  adults: FormControl<number>;
  children: FormControl<number>;
  notes: FormControl<string>;
}

type QuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: ReservationQuote }
  | { kind: 'error'; message: string };

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-10` → `10-nov` (same short date the API uses in its messages). */
export function formatShortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}-${MONTHS[month - 1]}`;
}

/**
 * Hospitality Suite (H1.1) — new nightly reservation: room type, dates and
 * occupancy are quoted live ("2 disponibles · 3 noches · $750.000"), then the
 * holder is picked or created with the shared POS customer selector.
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
      subtitle="Fechas, tipo de habitación y huésped titular"
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
          <app-selector
            class="col-span-2"
            formControlName="unit_type_id"
            label="Tipo de habitación"
            placeholder="Selecciona un tipo"
            [required]="true"
            [options]="typeOptions()"
          />
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
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  readonly typeOptions = computed<SelectorOption[]>(() =>
    this.unitTypes()
      .filter((t) => t.is_active)
      .map((t) => ({ value: t.id, label: t.name })),
  );

  readonly canBook = computed(() => {
    const state = this.quoteState();
    return state.kind === 'ready' && state.quote.available > 0;
  });

  readonly quoteMessage = computed(() => {
    const state = this.quoteState();
    if (state.kind === 'error') return state.message;
    if (state.kind !== 'ready') return '';
    const { quote } = state;
    if (quote.available < 1) {
      const raw = this.form.getRawValue();
      return `Sin disponibilidad de ${quote.unit_type.name} para el ${formatShortDate(raw.arrival_date)} al ${formatShortDate(raw.departure_date)}`;
    }
    const nights = `${quote.nights} ${quote.nights === 1 ? 'noche' : 'noches'}`;
    const available = `${quote.available} ${quote.available === 1 ? 'disponible' : 'disponibles'}`;
    return `${available} · ${nights} · ${this.currency.format(Number(quote.total_amount), 0)}`;
  });

  readonly form: FormGroup<ReservationForm> = this.fb.group<ReservationForm>({
    unit_type_id: this.fb.control<number | null>(null, {
      validators: [Validators.required],
    }),
    arrival_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    departure_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    adults: this.fb.nonNullable.control(2, { validators: [Validators.min(1)] }),
    children: this.fb.nonNullable.control(0, { validators: [Validators.min(0)] }),
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
            ? this.reservationsService.quote(request).pipe(
                map((quote): QuoteState => ({ kind: 'ready', quote })),
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
    this.form.reset({
      unit_type_id: (this.typeOptions()[0]?.value as number | undefined) ?? null,
      arrival_date: '',
      departure_date: '',
      adults: 2,
      children: 0,
      notes: '',
    });
    this.customer.set(null);
    this.customerSelector()?.reset();
    this.quoteState.set({ kind: 'idle' });
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
    this.reservationsService
      .create({
        ...request,
        customer_id: Number(customer.id),
        notes: this.form.controls.notes.value.trim() || undefined,
      })
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

  /** Request to quote, or null while the stay is incomplete. */
  private quoteRequest(): ReservationQuoteRequest | null {
    const raw = this.form.getRawValue();
    if (raw.unit_type_id == null || !raw.arrival_date || !raw.departure_date) {
      return null;
    }
    return {
      unit_type_id: Number(raw.unit_type_id),
      arrival_date: raw.arrival_date,
      departure_date: raw.departure_date,
      adults: Number(raw.adults) || 0,
      children: Number(raw.children) || 0,
    };
  }
}

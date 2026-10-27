import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
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
import { LodgingUnit } from '../../../rooms/interfaces/unit.interface';
import { LodgingUnitsService } from '../../../rooms/services/units.service';
import {
  LodgingReservation,
  RoomChangeQuote,
  RoomChangeRequest,
  RoomChangeSide,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

/** Room of a reservation to change, with an optional proposal from the rack. */
export interface RoomChangeTarget {
  reservation_room_id: number;
  reservation_number: string;
  guest: string;
  unit_id: number | null;
  arrival_date: string;
  departure_date: string;
  /** Change already chosen by dragging, with its validated quote. */
  proposal?: RoomChangeRequest;
  quote?: RoomChangeQuote;
}

type QuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: RoomChangeQuote }
  | { kind: 'error'; message: string };

const shortDate = (date: string) => format(parseISO(date), 'd MMM', { locale: es });

/**
 * Hospitality Suite (H1.4) — confirm a room change: assign or move to a
 * physical room and/or change the stay dates. The rack opens it after a drag
 * with the change already quoted; on mobile the "Mover" button opens it to
 * pick the room and dates by hand. Shows current vs new and the price
 * difference before confirming.
 */
@Component({
  selector: 'app-room-change-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="target() !== null"
      (isOpenChange)="!$event && close()"
      (cancel)="close()"
      [size]="'md'"
      [dialog]="true"
      title="Mover o cambiar fechas"
      [subtitle]="subtitle()"
    >
      <form [formGroup]="form" class="space-y-4 text-sm" data-testid="room-change">
        <div class="grid grid-cols-2 gap-3">
          <app-selector
            class="col-span-2"
            formControlName="unit_id"
            label="Habitación"
            placeholder="Selecciona una habitación"
            [options]="unitOptions()"
          />
          <app-input
            formControlName="arrival_date"
            label="Llegada"
            type="date"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="departure_date"
            label="Salida"
            type="date"
            customWrapperClass="mt-0"
          />
        </div>

        @switch (quoteState().kind) {
          @case ('loading') {
            <p class="text-text-secondary">Validando el cambio…</p>
          }
          @case ('error') {
            <p class="font-medium text-error" data-testid="room-change-error">{{ errorMessage() }}</p>
          }
          @case ('ready') {
            <div class="rounded-lg border border-border" data-testid="room-change-quote">
              <div class="grid grid-cols-3 gap-x-3 border-b border-border px-3 py-2 text-xs text-text-secondary">
                <span></span><span>Actual</span><span>Nuevo</span>
              </div>
              @for (row of compareRows(); track row.label) {
                <div
                  class="grid grid-cols-3 gap-x-3 px-3 py-1.5"
                  [class.font-semibold]="row.changed"
                >
                  <span class="text-text-secondary">{{ row.label }}</span>
                  <span>{{ row.current }}</span>
                  <span [class.text-primary]="row.changed">{{ row.proposed }}</span>
                </div>
              }
              <p class="border-t border-border px-3 py-2 font-semibold" data-testid="room-change-difference">
                {{ differenceLabel() }}
              </p>
            </div>
          }
          @default {
            <p class="text-text-secondary">Elige otra habitación o cambia las fechas.</p>
          }
        }
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="close()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="saving()"
          [disabled]="quoteState().kind !== 'ready'"
          (clicked)="confirm()"
        >
          <app-icon slot="icon" name="check" [size]="16" />
          Confirmar cambio
        </app-button>
      </div>
    </app-modal>
  `,
})
export class RoomChangeModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly unitsService = inject(LodgingUnitsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Room to change; `null` keeps the modal closed. */
  readonly target = input<RoomChangeTarget | null>(null);
  readonly closed = output<void>();
  /** Emitted with the updated reservation after confirming. */
  readonly changed = output<LodgingReservation>();

  readonly saving = signal(false);
  readonly quoteState = signal<QuoteState>({ kind: 'idle' });
  private readonly units = signal<LodgingUnit[] | null>(null);

  readonly form = this.fb.group({
    unit_id: this.fb.control<number | null>(null),
    arrival_date: this.fb.nonNullable.control(''),
    departure_date: this.fb.nonNullable.control(''),
  });

  readonly subtitle = computed(() => {
    const t = this.target();
    return t ? `${t.reservation_number} · ${t.guest}` : '';
  });

  readonly unitOptions = computed<SelectorOption[]>(() =>
    (this.units() ?? [])
      .filter((u) => u.is_active || u.id === this.target()?.unit_id)
      .map((u) => ({ value: u.id, label: `${u.code} · ${u.unit_type.name}` })),
  );

  readonly errorMessage = computed(() => {
    const state = this.quoteState();
    return state.kind === 'error' ? state.message : '';
  });

  readonly compareRows = computed(() => {
    const state = this.quoteState();
    if (state.kind !== 'ready') return [];
    const { current, proposed } = state.quote;
    const unit = (s: RoomChangeSide) => s.unit?.code ?? 'Sin asignar';
    const dates = (s: RoomChangeSide) => `${shortDate(s.arrival_date)} → ${shortDate(s.departure_date)}`;
    const money = (s: RoomChangeSide) => this.currency.format(Number(s.total_amount), 0);
    return [
      { label: 'Habitación', current: unit(current), proposed: unit(proposed) },
      { label: 'Tipo', current: current.unit_type.name, proposed: proposed.unit_type.name },
      { label: 'Fechas', current: dates(current), proposed: dates(proposed) },
      { label: 'Noches', current: String(current.nights), proposed: String(proposed.nights) },
      { label: 'Total', current: money(current), proposed: money(proposed) },
    ].map((row) => ({ ...row, changed: row.current !== row.proposed }));
  });

  readonly differenceLabel = computed(() => {
    const state = this.quoteState();
    if (state.kind !== 'ready') return '';
    const difference = Number(state.quote.difference);
    if (difference === 0) return 'Sin diferencia de precio';
    const amount = this.currency.format(Math.abs(difference), 0);
    return difference > 0 ? `Diferencia: +${amount}` : `Diferencia: −${amount}`;
  });

  constructor() {
    effect(() => {
      const target = this.target();
      if (target) untracked(() => this.open(target));
    });

    this.form.valueChanges
      .pipe(
        map(() => this.request()),
        tap((request) => this.quoteState.set(request ? { kind: 'loading' } : { kind: 'idle' })),
        debounceTime(300),
        switchMap((request) => {
          const target = this.target();
          if (!request || !target) return of<QuoteState>({ kind: 'idle' });
          return this.reservationsService.changeQuote(target.reservation_room_id, request).pipe(
            map((quote): QuoteState => ({ kind: 'ready', quote })),
            catchError((message: unknown) =>
              of<QuoteState>({
                kind: 'error',
                message: typeof message === 'string' ? message : 'No se pudo validar el cambio',
              }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.quoteState.set(state));
  }

  private open(target: RoomChangeTarget): void {
    if (this.units() === null) this.loadUnits();
    const proposal = target.proposal ?? {};
    this.form.setValue(
      {
        unit_id: proposal.unit_id ?? target.unit_id,
        arrival_date: proposal.arrival_date ?? target.arrival_date,
        departure_date: proposal.departure_date ?? target.departure_date,
      },
      { emitEvent: false },
    );
    this.quoteState.set(target.quote ? { kind: 'ready', quote: target.quote } : { kind: 'idle' });
  }

  private loadUnits(): void {
    this.unitsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (units) => this.units.set(units),
        error: () => this.units.set([]),
      });
  }

  /** Only the fields that differ from the current stay; null = no change. */
  private request(): RoomChangeRequest | null {
    const target = this.target();
    if (!target) return null;
    const { unit_id, arrival_date, departure_date } = this.form.getRawValue();
    const change: RoomChangeRequest = {};
    if (unit_id !== null && unit_id !== target.unit_id) change.unit_id = Number(unit_id);
    if (arrival_date && arrival_date !== target.arrival_date) change.arrival_date = arrival_date;
    if (departure_date && departure_date !== target.departure_date) {
      change.departure_date = departure_date;
    }
    return Object.keys(change).length > 0 ? change : null;
  }

  confirm(): void {
    const target = this.target();
    const request = this.request();
    if (!target || !request || this.quoteState().kind !== 'ready') return;
    this.saving.set(true);
    this.reservationsService
      .changeRoom(target.reservation_room_id, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reservation) => {
          this.saving.set(false);
          this.toastService.success('Reserva actualizada');
          this.changed.emit(reservation);
          this.close();
        },
        error: (message: unknown) => {
          this.saving.set(false);
          const text = typeof message === 'string' ? message : 'No se pudo actualizar la reserva';
          this.quoteState.set({ kind: 'error', message: text });
          this.toastService.error(text);
        },
      });
  }

  close(): void {
    this.quoteState.set({ kind: 'idle' });
    this.closed.emit();
  }
}

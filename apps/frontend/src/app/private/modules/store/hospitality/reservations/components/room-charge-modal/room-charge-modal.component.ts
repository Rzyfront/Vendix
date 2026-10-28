import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { combineLatest, of } from 'rxjs';
import { catchError, debounceTime, filter, startWith, switchMap, tap } from 'rxjs/operators';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { InHouseRoom } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Hospitality Suite (H3.6) — "Cargo a habitación" picker shared by the POS
 * checkout and the table bill. Lists only rooms with a guest in house; a room
 * with "Cargos bloqueados" shows but cannot be picked. The parent performs the
 * charge on `confirmed` and closes the modal when it succeeds.
 */
@Component({
  selector: 'app-room-charge-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ModalComponent, ButtonComponent, IconComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="!$event && closed.emit()"
      (cancel)="closed.emit()"
      [size]="'md'"
      [dialog]="true"
      title="Cargo a habitación"
      [subtitle]="amount() != null ? 'Total ' + money(amount()!) + ' · sin cobrar ahora' : 'Sin cobrar ahora'"
    >
      <div class="space-y-3 text-sm" data-testid="room-charge-modal">
        <app-input
          [formControl]="searchControl"
          label="Buscar habitación"
          placeholder="101 o nombre del huésped"
          customWrapperClass="mt-0"
          data-testid="room-charge-search"
        />
        @if (loading()) {
          <p class="text-text-secondary">Buscando habitaciones en casa…</p>
        } @else if (error()) {
          <p class="font-medium text-error">{{ error() }}</p>
        } @else if (rooms().length === 0) {
          <p class="text-text-secondary" data-testid="room-charge-empty">No hay habitaciones con huésped en casa.</p>
        } @else {
          <ul class="divide-y divide-border rounded-lg border border-border">
            @for (room of rooms(); track room.reservation_room_id) {
              <li>
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  [class.bg-primary/10]="selected()?.reservation_room_id === room.reservation_room_id"
                  [disabled]="room.charges_blocked"
                  (click)="selected.set(room)"
                  data-testid="room-charge-option"
                >
                  <span>
                    <span class="font-semibold">{{ room.room_code }}</span>
                    · {{ room.guest_name }}
                    <span class="block text-xs text-text-secondary">
                      {{ room.unit_type_name }} · {{ room.reservation_number }} · sale {{ departureLabel(room.departure_date) }}
                    </span>
                  </span>
                  @if (room.charges_blocked) {
                    <span class="text-xs font-medium text-error">Cargos bloqueados</span>
                  } @else if (selected()?.reservation_room_id === room.reservation_room_id) {
                    <app-icon name="check" [size]="16" />
                  }
                </button>
              </li>
            }
          </ul>
        }
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="closed.emit()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="busy()"
          [disabled]="!selected()"
          (clicked)="confirm()"
          data-testid="room-charge-confirm"
        >
          <app-icon slot="icon" name="bed-double" [size]="16" />
          {{ selected() ? 'Cargar a ' + selected()!.room_code : 'Cargar' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class RoomChargeModalComponent {
  private readonly reservations = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input<boolean>(false);
  /** Amount being charged, shown in the subtitle. */
  readonly amount = input<number | null>(null);
  /** The parent is charging (draft save + room charge). */
  readonly busy = input<boolean>(false);
  readonly confirmed = output<InHouseRoom>();
  readonly closed = output<void>();

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly rooms = signal<InHouseRoom[]>([]);
  readonly selected = signal<InHouseRoom | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    combineLatest([
      toObservable(this.isOpen),
      this.searchControl.valueChanges.pipe(startWith(''), debounceTime(250)),
    ])
      .pipe(
        filter(([open]) => open),
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap(([, search]) =>
          this.reservations.getInHouseRooms(search).pipe(
            catchError((message: string) => {
              this.error.set(typeof message === 'string' ? message : 'No se pudieron cargar las habitaciones');
              return of([] as InHouseRoom[]);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rooms) => {
        this.rooms.set(rooms);
        this.loading.set(false);
        const current = untracked(this.selected);
        if (current && !rooms.some((r) => r.reservation_room_id === current.reservation_room_id)) {
          this.selected.set(null);
        }
      });

    // A fresh picker every time it opens.
    effect(() => {
      if (!this.isOpen()) {
        untracked(() => {
          this.selected.set(null);
          this.searchControl.setValue('', { emitEvent: false });
        });
      }
    });
  }

  confirm(): void {
    const room = this.selected();
    if (room && !room.charges_blocked && !this.busy()) this.confirmed.emit(room);
  }

  money(value: number): string {
    return this.currency.format(value, 0);
  }

  /** Civil date `2026-10-28` → `28-oct`, same label as the front desk. */
  departureLabel(date: string): string {
    const [, month, day] = date.slice(0, 10).split('-').map(Number);
    return `${day}-${MONTHS[month - 1]}`;
  }
}

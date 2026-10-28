import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { LodgingReservation, LodgingReservationRoom } from '../../interfaces/reservation.interface';
import { LodgingGuest } from '../../interfaces/guest.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import {
  GuestFormModalComponent,
  GuestFormTarget,
  roomLabel,
} from '../guest-form-modal/guest-form-modal.component';

/** Statuses whose guest register can still change. */
const EDITABLE_STATUSES = ['tentative', 'confirmed', 'checked_in'];

interface RoomGuests {
  room: LodgingReservationRoom | null;
  label: string;
  guests: LodgingGuest[];
}

/**
 * Hospitality Suite (H3.1) — "Huéspedes" section of the reservation detail:
 * who sleeps in each room, holder first, with "Reporta SIRE" on foreigners.
 */
@Component({
  selector: 'app-guest-register',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BadgeComponent, ButtonComponent, IconComponent, GuestFormModalComponent],
  template: `
    <div data-testid="guest-register">
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="font-medium text-text-primary">Huéspedes registrados</p>
        @if (editable()) {
          <app-button variant="outline" size="sm" (clicked)="add(null)" data-testid="guest-add">
            <app-icon slot="icon" name="user-plus" [size]="14" />
            {{ hasHolder() ? 'Agregar acompañante' : 'Registrar titular' }}
          </app-button>
        }
      </div>
      @if (loading()) {
        <p class="text-xs text-text-secondary">Cargando huéspedes…</p>
      } @else {
        <div class="space-y-2">
          @for (group of groups(); track group.label) {
            <div class="rounded-lg border border-border" data-testid="guest-room">
              <p class="border-b border-border px-3 py-1.5 text-xs font-medium text-text-secondary">
                {{ group.label }}
              </p>
              <ul class="divide-y divide-border">
                @for (guest of group.guests; track guest.id) {
                  <li class="flex items-center justify-between gap-2 px-3 py-2" data-testid="guest-row">
                    <div>
                      <p class="flex flex-wrap items-center gap-1 font-medium">
                        {{ guest.first_name }} {{ guest.last_name }}
                        @if (guest.is_primary) {
                          <app-badge variant="primary" size="xs">Titular</app-badge>
                        }
                        @if (guest.reports_sire) {
                          <app-badge variant="warning" size="xs" data-testid="guest-sire">Reporta SIRE</app-badge>
                        }
                      </p>
                      <p class="text-xs text-text-secondary">
                        {{ guest.document_type }} {{ guest.document_number }} ·
                        {{ countryName(guest.nationality_country_code) }} ·
                        {{ guest.origin_city }} · {{ guest.travel_purpose_label }}
                      </p>
                    </div>
                    @if (editable()) {
                      <div class="flex gap-1">
                        <app-button variant="ghost" size="sm" ariaLabel="Editar huésped" (clicked)="edit(guest)">
                          <app-icon slot="icon" name="pencil" [size]="14" />
                        </app-button>
                        <app-button variant="ghost" size="sm" ariaLabel="Quitar huésped" (clicked)="remove(guest)">
                          <app-icon slot="icon" name="trash-2" [size]="14" />
                        </app-button>
                      </div>
                    }
                  </li>
                } @empty {
                  <li class="px-3 py-2 text-xs text-text-secondary">Sin huéspedes registrados</li>
                }
              </ul>
              @if (editable() && group.room && hasHolder() && groups().length > 1) {
                <div class="border-t border-border px-2 py-1">
                  <app-button variant="ghost" size="sm" (clicked)="add(group.room.id)">
                    <app-icon slot="icon" name="plus" [size]="14" />
                    Agregar acompañante
                  </app-button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    <app-guest-form-modal
      [target]="formTarget()"
      (closed)="formTarget.set(null)"
      (saved)="onSaved()"
    />
  `,
})
export class GuestRegisterComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly countryNames = new Intl.DisplayNames(['es'], { type: 'region' });

  readonly reservation = input.required<LodgingReservation>();

  readonly guests = signal<LodgingGuest[]>([]);
  readonly loading = signal(false);
  readonly formTarget = signal<GuestFormTarget | null>(null);

  readonly editable = computed(() => EDITABLE_STATUSES.includes(this.reservation().status));
  readonly hasHolder = computed(() => this.guests().some((guest) => guest.is_primary));
  /** Guests by active room (plus any left without a room). */
  readonly groups = computed<RoomGuests[]>(() => {
    const guests = this.guests();
    const rooms = this.reservation().rooms.filter((room) => !room.cancelled_at);
    const groups: RoomGuests[] = rooms.map((room) => ({
      room,
      label: roomLabel(room),
      guests: guests.filter((guest) => guest.reservation_room_id === room.id),
    }));
    const roomIds = new Set(rooms.map((room) => room.id));
    const loose = guests.filter(
      (guest) => guest.reservation_room_id === null || !roomIds.has(guest.reservation_room_id),
    );
    if (loose.length) groups.push({ room: null, label: 'Sin habitación', guests: loose });
    return groups;
  });

  constructor() {
    effect(() => {
      const id = this.reservation().id;
      untracked(() => this.load(id));
    });
  }

  countryName(code: string): string {
    return this.countryNames.of(code) ?? code;
  }

  add(roomId: number | null): void {
    this.formTarget.set({
      reservation: this.reservation(),
      guest: null,
      holder: !this.hasHolder(),
      room_id: roomId,
    });
  }

  edit(guest: LodgingGuest): void {
    this.formTarget.set({
      reservation: this.reservation(),
      guest,
      holder: guest.is_primary,
      room_id: guest.reservation_room_id,
    });
  }

  remove(guest: LodgingGuest): void {
    this.reservationsService
      .removeGuest(this.reservation().id, guest.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Huésped quitado');
          this.load(this.reservation().id);
        },
        error: (message: unknown) =>
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo quitar el huésped',
          ),
      });
  }

  onSaved(): void {
    this.formTarget.set(null);
    this.load(this.reservation().id);
  }

  private load(id: number): void {
    this.loading.set(true);
    this.reservationsService
      .listGuests(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (guests) => {
          this.guests.set(guests);
          this.loading.set(false);
        },
        error: () => {
          this.guests.set([]);
          this.loading.set(false);
        },
      });
  }
}

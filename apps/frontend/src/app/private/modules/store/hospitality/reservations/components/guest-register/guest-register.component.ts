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
  DialogService,
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
 * H8.1 adds the online check-in link and "Pre-registro completo ✓".
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
      @if (reservation().precheckin_completed_at || editable()) {
        <div
          class="mb-3 space-y-2 rounded-lg border border-border px-3 py-2"
          data-testid="precheckin"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="flex flex-wrap items-center gap-1 text-sm font-medium text-text-primary">
                Pre-registro en línea
                @if (reservation().precheckin_completed_at) {
                  <app-badge variant="success" size="xs" data-testid="precheckin-complete">
                    Pre-registro completo ✓
                  </app-badge>
                }
              </p>
              <p class="text-xs text-text-secondary">
                El huésped llena sus datos y los de sus acompañantes desde un enlace, sin crear
                cuenta. El enlace deja de funcionar después del check-out.
              </p>
            </div>
            @if (editable()) {
              <app-button
                variant="outline"
                size="sm"
                [loading]="linkLoading()"
                (clicked)="shareLink()"
                data-testid="precheckin-link"
              >
                <app-icon slot="icon" name="link" [size]="14" />
                Copiar enlace de pre-registro
              </app-button>
            }
          </div>
          @if (link(); as url) {
            <div class="flex flex-wrap items-center gap-2" data-testid="precheckin-url">
              <p class="min-w-0 flex-1 break-all rounded bg-background px-2 py-1 text-xs text-text-secondary">
                {{ url }}
              </p>
              <a
                class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary sm:min-h-0"
                [href]="whatsappUrl(url)"
                target="_blank"
                rel="noopener"
              >
                <app-icon name="message-circle" [size]="14" />
                Enviar por WhatsApp
              </a>
            </div>
          }
        </div>
      }
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
                          <app-badge variant="warning" size="xs" data-testid="guest-sire">Reporta a Migración (SIRE)</app-badge>
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
                        <app-button
                          variant="ghost"
                          size="sm"
                          customClasses="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
                          [ariaLabel]="'Editar a ' + guest.first_name"
                          (clicked)="edit(guest)"
                        >
                          <app-icon slot="icon" name="pencil" [size]="14" />
                        </app-button>
                        <app-button
                          variant="ghost"
                          size="sm"
                          customClasses="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
                          [ariaLabel]="'Quitar a ' + guest.first_name"
                          data-testid="guest-remove"
                          (clicked)="remove(guest)"
                        >
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
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly countryNames = new Intl.DisplayNames(['es'], { type: 'region' });

  readonly reservation = input.required<LodgingReservation>();

  readonly guests = signal<LodgingGuest[]>([]);
  readonly loading = signal(false);
  readonly formTarget = signal<GuestFormTarget | null>(null);
  /** H8.1 — online check-in link, shown once the desk asks for it. */
  readonly link = signal<string | null>(null);
  readonly linkLoading = signal(false);

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
      untracked(() => {
        this.link.set(null);
        this.load(id);
      });
    });
  }

  /** H8.1 — gets the online check-in link, copies it and shows it to share. */
  shareLink(): void {
    if (this.linkLoading()) return;
    this.linkLoading.set(true);
    this.reservationsService
      .getPrecheckinLink(this.reservation().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ url }) => {
          this.linkLoading.set(false);
          this.link.set(url);
          navigator.clipboard
            ?.writeText(url)
            .then(() => this.toastService.success('Enlace copiado: envíalo al huésped'))
            .catch(() => this.toastService.info('Copia el enlace y envíalo al huésped'));
        },
        error: (message: unknown) => {
          this.linkLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo crear el enlace de pre-registro',
          );
        },
      });
  }

  whatsappUrl(url: string): string {
    const text = `Hola, completa tu pre-registro de la reserva ${this.reservation().reservation_number} aquí: ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
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

  async remove(guest: LodgingGuest): Promise<void> {
    const name = `${guest.first_name} ${guest.last_name}`.trim();
    const confirmed = await this.dialogService.confirm({
      title: 'Quitar huésped',
      message: `${name} dejará de figurar en el registro de esta reserva y no se incluirá en los reportes de huéspedes.`,
      confirmText: 'Quitar huésped',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
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

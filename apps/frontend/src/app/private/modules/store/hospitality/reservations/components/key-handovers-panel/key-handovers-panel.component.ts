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
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import { LodgingReservation } from '../../interfaces/reservation.interface';
import { LodgingKeyHandover } from '../../interfaces/key-handover.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { roomLabel } from '../guest-form-modal/guest-form-modal.component';

type KeyField = 'key_label' | 'guest_name' | 'reservation_room_id';

/**
 * Hospitality Suite (H8.4, replaced by owner decision D12) — "Llaves" tab of
 * the reservation detail: which key or access card each guest has, who
 * handed it and when, and its return. Keys are handed once the guest is in
 * house; a key out is returned from its row at any time.
 */
@Component({
  selector: 'app-key-handovers-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
  ],
  template: `
    <div data-testid="key-handovers">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="font-medium text-text-primary">Llaves y tarjetas</p>
          <p class="text-xs text-text-secondary">
            {{ outCount() === 0 ? 'Ninguna llave con el huésped' : outCount() === 1 ? '1 llave con el huésped' : outCount() + ' llaves con el huésped' }}
          </p>
        </div>
        @if (canDeliver()) {
          <app-button
            variant="primary"
            size="sm"
            customClasses="min-h-11 sm:min-h-0"
            (clicked)="open()"
            data-testid="key-deliver"
          >
            <app-icon slot="icon" name="plus" [size]="14" />
            Entregar llave
          </app-button>
        }
      </div>

      @if (loading()) {
        <p class="text-xs text-text-secondary">Cargando llaves…</p>
      } @else if (loadError()) {
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <p class="text-error">{{ loadError() }}</p>
          <app-button
            variant="outline"
            size="sm"
            customClasses="min-h-11 sm:min-h-0"
            (clicked)="load(reservation().id)"
          >
            Reintentar
          </app-button>
        </div>
      } @else if (keys().length === 0) {
        <div class="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm" data-testid="key-empty">
          <p class="text-text-secondary">
            {{ canDeliver() ? 'Aún no has entregado llaves en esta reserva.' : 'Las llaves se entregan después del check-in.' }}
          </p>
          @if (canDeliver()) {
            <app-button variant="outline" size="sm" customClasses="mt-2 min-h-11 sm:min-h-0" (clicked)="open()">
              <app-icon slot="icon" name="key-round" [size]="14" />
              Entregar la primera llave
            </app-button>
          }
        </div>
      } @else {
        <ul class="divide-y divide-border rounded-lg border border-border">
          @for (key of keys(); track key.id) {
            <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="key-row">
              <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-1 font-medium">
                  <app-icon name="key-round" [size]="14" />
                  {{ key.key_label }}
                  @if (key.room_code) {
                    <span class="text-xs font-normal text-text-secondary">· Habitación {{ key.room_code }}</span>
                  }
                  @if (key.returned_at) {
                    <app-badge variant="neutral" size="xs">Devuelta</app-badge>
                  } @else {
                    <app-badge variant="warning" size="xs" data-testid="key-out">Con el huésped</app-badge>
                  }
                </p>
                <p class="text-xs text-text-secondary">
                  Entregada a {{ key.guest_name }} · {{ key.delivered_at | date: 'dd/MM/yyyy HH:mm' }}
                  @if (key.delivered_by_name) { · por {{ key.delivered_by_name }} }
                </p>
                @if (key.returned_at) {
                  <p class="text-xs text-text-secondary">
                    Devuelta el {{ key.returned_at | date: 'dd/MM/yyyy HH:mm' }}
                    @if (key.returned_by_name) { · recibió {{ key.returned_by_name }} }
                  </p>
                }
                @if (key.notes) {
                  <p class="text-xs text-text-secondary">{{ key.notes }}</p>
                }
              </div>
              @if (!key.returned_at) {
                <app-button
                  variant="outline"
                  size="sm"
                  customClasses="min-h-11 sm:min-h-0"
                  [loading]="returningId() === key.id"
                  (clicked)="returnKey(key)"
                  data-testid="key-return"
                >
                  <app-icon slot="icon" name="corner-down-left" [size]="14" />
                  Registrar devolución
                </app-button>
              }
            </li>
          }
        </ul>
      }
    </div>

    <app-modal
      [isOpen]="formOpen()"
      (isOpenChange)="!$event && formOpen.set(false)"
      (cancel)="formOpen.set(false)"
      (opened)="focusFirst()"
      [size]="'md'"
      [dialog]="true"
      title="Entregar llave"
      [subtitle]="reservation().reservation_number"
    >
      <form
        [formGroup]="form"
        id="key-deliver-form"
        class="space-y-4"
        novalidate
        data-testid="key-deliver-form"
        (ngSubmit)="submit()"
      >
        <app-input
          formControlName="key_label"
          label="Llave o tarjeta"
          placeholder="Ej.: 101-A o Tarjeta 7"
          helperText="Como la identifica el hotel: el número en el llavero o en la tarjeta."
          [required]="true"
          [maxlength]="60"
          [error]="errors().key_label ?? ''"
          customWrapperClass="mt-0"
          data-testid="key-label"
        />
        <div>
          <app-input
            formControlName="guest_name"
            label="Huésped que la recibe"
            [required]="true"
            [maxlength]="150"
            [error]="errors().guest_name ?? ''"
            customWrapperClass="mt-0"
            data-testid="key-guest"
          />
          @if (guestNames().length > 1) {
            <div class="mt-2 flex flex-wrap gap-1">
              @for (name of guestNames(); track name) {
                <app-button
                  variant="ghost"
                  size="sm"
                  customClasses="min-h-11 sm:min-h-0"
                  (clicked)="form.controls.guest_name.setValue(name)"
                >
                  {{ name }}
                </app-button>
              }
            </div>
          }
        </div>
        @if (roomOptions().length > 1) {
          <app-selector
            formControlName="reservation_room_id"
            label="Habitación"
            placeholder="Elige la habitación"
            [required]="true"
            [options]="roomOptions()"
            [errorText]="errors().reservation_room_id ?? ''"
          />
        }
        <app-input
          formControlName="notes"
          label="Nota (opcional)"
          placeholder="Ej.: llave del parqueadero incluida"
          [maxlength]="300"
          customWrapperClass="mt-0"
        />
        @if (serverError()) {
          <p class="text-sm font-medium text-error" data-testid="key-server-error">{{ serverError() }}</p>
        }
      </form>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="formOpen.set(false)">Cancelar</app-button>
        <app-button
          type="submit"
          form="key-deliver-form"
          variant="primary"
          [loading]="saving()"
          data-testid="key-deliver-save"
        >
          <app-icon slot="icon" name="key-round" [size]="16" />
          Registrar entrega
        </app-button>
      </div>
    </app-modal>
  `,
})
export class KeyHandoversPanelComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservation = input.required<LodgingReservation>();
  /** Keys out changed: the parent refreshes what shows the count. */
  readonly changed = output<void>();

  readonly keys = signal<LodgingKeyHandover[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly returningId = signal<number | null>(null);
  readonly errors = signal<Partial<Record<KeyField, string>>>({});
  readonly serverError = signal('');

  readonly form = new FormGroup({
    key_label: new FormControl('', { nonNullable: true }),
    guest_name: new FormControl('', { nonNullable: true }),
    reservation_room_id: new FormControl<number | null>(null),
    notes: new FormControl('', { nonNullable: true }),
  });

  /** Keys are handed to a guest in house (the API applies the same rule). */
  readonly canDeliver = computed(() => this.reservation().status === 'checked_in');
  readonly outCount = computed(() => this.keys().filter((key) => !key.returned_at).length);
  readonly activeRooms = computed(() =>
    this.reservation().rooms.filter((room) => !room.cancelled_at),
  );
  readonly roomOptions = computed<SelectorOption[]>(() =>
    this.activeRooms().map((room) => ({ value: room.id, label: roomLabel(room) })),
  );
  /** Holder plus registered guests, to fill "Huésped que la recibe" in one tap. */
  readonly guestNames = signal<string[]>([]);

  constructor() {
    effect(() => {
      const id = this.reservation().id;
      untracked(() => this.load(id));
    });
  }

  open(): void {
    const rooms = this.activeRooms();
    const room = rooms.length === 1 ? rooms[0] : null;
    const customer = this.reservation().customer;
    const holder = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
    this.form.reset({
      key_label: room?.unit?.code ?? '',
      guest_name: holder,
      reservation_room_id: room?.id ?? null,
      notes: '',
    });
    this.errors.set({});
    this.serverError.set('');
    this.formOpen.set(true);
    this.reservationsService
      .listGuests(this.reservation().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (guests) => {
          const names = guests.map((guest) => `${guest.first_name} ${guest.last_name}`.trim());
          this.guestNames.set([...new Set([holder, ...names].filter(Boolean))]);
        },
        error: () => this.guestNames.set([]),
      });
  }

  /** R-FORM — the cursor lands on "Llave o tarjeta", ready to type. */
  focusFirst(): void {
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLInputElement>('[data-testid="key-label"] input');
      field?.focus();
      field?.select();
    });
  }

  submit(): void {
    if (this.saving()) return;
    const raw = this.form.getRawValue();
    const errors: Partial<Record<KeyField, string>> = {};
    if (!raw.key_label.trim()) errors.key_label = 'Escribe qué llave o tarjeta entregas';
    if (!raw.guest_name.trim()) errors.guest_name = 'Indica a qué huésped le entregas la llave';
    if (this.roomOptions().length > 1 && raw.reservation_room_id == null) {
      errors.reservation_room_id = 'Elige la habitación';
    }
    this.errors.set(errors);
    this.serverError.set('');
    if (Object.keys(errors).length) return;

    this.saving.set(true);
    this.reservationsService
      .deliverKey(this.reservation().id, {
        key_label: raw.key_label.trim(),
        guest_name: raw.guest_name.trim(),
        ...(raw.reservation_room_id != null ? { reservation_room_id: Number(raw.reservation_room_id) } : {}),
        ...(raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (key) => {
          this.saving.set(false);
          this.formOpen.set(false);
          this.toastService.success(`Llave ${key.key_label} entregada a ${key.guest_name}`);
          this.load(this.reservation().id);
          this.changed.emit();
        },
        error: (message: unknown) => {
          this.saving.set(false);
          this.serverError.set(
            typeof message === 'string' ? message : 'No se pudo registrar la entrega',
          );
        },
      });
  }

  async returnKey(key: LodgingKeyHandover): Promise<void> {
    if (this.returningId() !== null) return;
    const confirmed = await this.dialogService.confirm({
      title: 'Registrar devolución',
      message: `¿${key.guest_name} devolvió la llave ${key.key_label}? Quedará registrado que la recibiste ahora y la llave quedará libre para entregarla de nuevo.`,
      confirmText: 'Sí, la devolvió',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;
    this.returningId.set(key.id);
    this.reservationsService
      .returnKey(this.reservation().id, key.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.returningId.set(null);
          this.toastService.success(`Llave ${key.key_label} devuelta`);
          this.load(this.reservation().id);
          this.changed.emit();
        },
        error: (message: unknown) => {
          this.returningId.set(null);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo registrar la devolución',
          );
          this.load(this.reservation().id);
        },
      });
  }

  load(id: number): void {
    this.loading.set(true);
    this.loadError.set('');
    this.reservationsService
      .listKeys(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (keys) => {
          this.keys.set(keys);
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.keys.set([]);
          this.loading.set(false);
          this.loadError.set(typeof message === 'string' ? message : 'No se pudieron cargar las llaves');
        },
      });
  }
}

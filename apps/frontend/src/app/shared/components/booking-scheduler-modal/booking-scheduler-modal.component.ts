import {
  Component,
  computed,
  inject,
  output,
  signal,
  input,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';
import { ModalComponent as AppModalComponent } from '../modal/modal.component';
import { ToastService } from '../toast/toast.service';
import { toLocalDateString } from '../../utils/date.util';

/**
 * CP-POS-SVC-PERF-001 — single bifunctional booking scheduler modal.
 *
 * Replaces the previous pair of modals (POS cart's
 * `pos-cart-service-scheduler-modal` and the reservations module's
 * `reschedule-modal`) with one component that handles BOTH creating a
 * new booking and editing an existing one. Callers pick the mode via
 * which input they bind:
 *
 *  - **POS cart (create / re-agendar inside the cart):** bind
 *    `[cartItem]` only. The modal emits `(scheduled)` with the booking
 *    block; the parent (cart) attaches it to the matching line and
 *    forwards it to the order editor's atomic booking on Actualizar /
 *    Cobrar.
 *
 *  - **Reservations module (admin re-agendar):** bind
 *    `[existingBooking]` (the row being rescheduled). The modal still
 *    emits `(scheduled)` with the same payload shape; the parent
 *    (reservations page) fires PUT /api/store/reservations/:id
 *    directly because it has the booking id and doesn't go through
 *    the order editor.
 *
 *  - **Standalone create** (any other consumer): bind nothing. The
 *    modal still works; the emitted payload has no booking_id so the
 *    parent can decide how to persist it.
 *
 * Per user feedback: when the cashier chooses "Sin personal" the
 * modal MUST still offer slots (default = current round-up to next
 * quarter + service_duration_minutes). It focuses on the hour input
 * automatically and submits client-side slots when the provider is
 * absent. This is also true for re-agendamiento.
 */
@Component({
  selector: 'app-booking-scheduler-modal',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ButtonComponent,
    AppModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="modalTitle()"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <div class="flex flex-col gap-4 p-2 min-w-[420px]">
        <!-- Paso 1: Personal (opcional) -->
        <section class="space-y-2">
          <label
            class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
            >Personal (opcional)</label
          >
          <div class="flex gap-2">
            <select
              class="flex-1 px-3 py-2 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              [(ngModel)]="providerIdText"
              (change)="onProviderChange($any($event.target).value)"
              aria-label="Seleccionar personal"
            >
              <option value="">Sin personal (default ahora)</option>
              @for (p of providers(); track p.id) {
                <option [value]="p.id">
                  {{ p.display_name || p.employee?.first_name }}
                </option>
              }
            </select>
          </div>
          @if (providers().length === 0) {
            <p class="text-[11px] text-text-secondary">
              Sin personal configurado para este servicio. Se propone
              hora actual + duración del servicio.
            </p>
          }
        </section>

        <!-- Paso 2: Fecha y hora -->
        <section class="space-y-2">
          <label
            class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
            >Fecha</label
          >
          <input
            type="date"
            class="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            [(ngModel)]="date"
            [min]="today()"
            (change)="onDateChange()"
            aria-label="Fecha de la cita"
          />

          <label
            class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
            >Hora de inicio</label
          >
          <input
            #hourInput
            type="time"
            class="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            [(ngModel)]="startTime"
            (change)="onTimeChange()"
            aria-label="Hora de inicio"
            step="300"
            autofocus
          />

          <label
            class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
            >Hora de fin</label
          >
          <input
            type="time"
            class="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            [(ngModel)]="endTime"
            aria-label="Hora de fin"
            step="300"
          />

          @if (providerId() === null && date() === today()) {
            <p class="text-[11px] text-violet-700">
              Sin personal y día = hoy → el default es la hora actual
              redondeada al próximo cuarto + duración del servicio.
            </p>
          }
        </section>

        <!-- Resumen inline -->
        <section
          class="rounded-md bg-violet-50 border border-violet-200 p-3 text-xs text-violet-900"
        >
          <strong>Resumen:</strong>
          {{ date }} · {{ startTime }} – {{ endTime }} ·
          {{
            providerId()
              ? providerName()
              : 'Sin personal (default ahora)'
          }}
        </section>

        <!-- Submit -->
        <div class="flex items-center justify-end gap-2 pt-1">
          <app-button variant="outline" (clicked)="onCancel()"
            >Cancelar</app-button
          >
          <app-button
            variant="primary"
            (clicked)="onConfirm()"
            [disabled]="!canSubmit()"
            >{{ existingBooking() ? 'Re-agendar' : 'Agendar' }}</app-button
          >
        </div>
      </div>
    </app-modal>
  `,
})
export class BookingSchedulerModalComponent {
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  /**
   * POS cart use: bind the cart line so we can stamp
   * `cart_item_id="cart-<id>"` on the emitted block. Optional — when
   * omitted the modal still works for the reservations / standalone
   * use cases.
   */
  cartItem = input<any>(null);
  /**
   * Bind an existing booking row to switch the modal into
   * re-agendamiento mode (title, defaults, button label, and the
   * emitted block carries `booking_id` so the parent can PUT
   * /api/store/reservations/:id instead of POST).
   */
  existingBooking = input<any>(null);
  /**
   * Optional override of the modal title. When omitted, the modal
   * falls back to the cart item's product name (POS) or the existing
   * booking's product name (admin).
   */
  modalTitleOverride = input<string | null>(null);

  /** Emits the booking payload. The parent decides where to persist. */
  scheduled = output<any>();
  /** Modal closed without scheduling. */
  cancelled = output<void>();

  // -- state --
  providers = signal<any[]>([]);
  providerIdText = signal<string>('');
  date = signal<string>(toLocalDateString(new Date()));
  startTime = signal<string>(roundUpToNextQuarter(currentHHmm()));
  endTime = signal<string>(
    addMinutes(roundUpToNextQuarter(currentHHmm()), 30),
  );

  /** CP-POS-SVC-PERF-001 / Annotation-1 — preset to current time so the
   *  inputs are correct the instant the modal mounts, before bootstrap. */

  providerId = computed<number | null>(() => {
    const v = this.providerIdText();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
  providerName = computed<string>(
    () =>
      this.providers().find((p) => p.id === this.providerId())?.display_name ||
      '',
  );

  /** Resolves the modal title from the override or the bound context. */
  modalTitle = computed<string>(() => {
    if (this.modalTitleOverride()) return this.modalTitleOverride()!;
    const productName =
      this.cartItem()?.product?.name ??
      this.existingBooking()?.product?.name ??
      this.existingBooking()?.product_name ??
      'servicio';
    const isEdit = !!this.existingBooking();
    return isEdit
      ? `Re-agendar ${productName}`
      : `Agendar ${productName}`;
  });

  canSubmit = computed(() => {
    return (
      !!this.date() &&
      !!this.startTime() &&
      !!this.endTime() &&
      this.startTime() < this.endTime()
    );
  });

  constructor() {
    queueMicrotask(() => this.bootstrap());
  }

  private bootstrap(): void {
    const productId =
      this.cartItem()?.product?.id ?? this.existingBooking()?.product_id;
    if (productId) this.loadProviders(productId);

    if (this.existingBooking()) {
      const b = this.existingBooking();
      this.date.set((b.date ?? '').slice(0, 10) || this.date());
      this.startTime.set(b.start_time || this.startTime());
      this.endTime.set(b.end_time || this.endTime());
      this.providerIdText.set(b.provider_id ? String(b.provider_id) : '');
      return;
    }

    // New booking — refine end time when the product declares a longer
    // duration. The signals already carry current+30 defaults from
    // declaration, so we only override when the duration differs.
    const item = this.cartItem();
    const duration =
      item?.product?.service_duration_minutes ??
      item?.product?.duration_minutes ??
      30;
    if (duration !== 30) {
      this.endTime.set(addMinutes(this.startTime(), duration));
    }
  }

  private loadProviders(productId: number | undefined): void {
    if (!productId) {
      this.providers.set([]);
      return;
    }
    this.http
      .get<any>(`/api/store/reservations/providers/for-service/${productId}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => this.providers.set(resp?.data ?? resp ?? []),
        error: () => this.providers.set([]),
      });
  }

  onProviderChange(value: string): void {
    this.providerIdText.set(value);
  }

  onDateChange(): void {
    // no-op for now; backend availability fetched lazily on confirm
  }

  onTimeChange(): void {
    if (!this.endTime() || this.endTime() <= this.startTime()) {
      this.endTime.set(addMinutes(this.startTime(), 30));
    }
  }

  today(): string {
    return toLocalDateString(new Date());
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  onConfirm(): void {
    if (!this.canSubmit()) {
      this.toast.warning('Completa fecha, hora inicio y hora fin.');
      return;
    }

    const existing = this.existingBooking();
    const item = this.cartItem();
    // CP-POS-SVC-PERF-001 / D.2 — emit a single payload shape regardless of
    // caller. The parent decides how to persist:
    //  - POS cart → attach to cart line + forward to editor atomic on
    //    Actualizar / Cobrar, or fire POST /reservations on Guardar
    //    with the freshly-created order_id.
    //  - Reservations page → PUT /api/store/reservations/:id when
    //    `booking_id` is set.
    const payload: any = {
      booking_id: existing?.id ?? undefined,
      provider_id: this.providerId(),
      date: this.date(),
      start_time: this.startTime(),
      end_time: this.endTime(),
      notes: existing?.notes ?? '',
      service_location_type: existing?.service_location_type ?? 'shop',
      cart_item_id: item?.id ? `cart-${item.id}` : undefined,
      product_id:
        item?.product?.id ?? existing?.product_id ?? undefined,
      product_variant_id:
        item?.product_variant_id ??
        existing?.product_variant_id ??
        undefined,
      customer_id:
        item?.customer_id ??
        (item as any)?.customer?.id ??
        existing?.customer_id ??
        null,
      is_update: !!existing,
      is_create: !existing,
    };

    this.toast.success(
      existing ? 'Reserva re-agendada' : 'Reserva agendada',
    );
    this.scheduled.emit(payload);
  }
}

/** Current local time as HH:mm (zero-padded). */
function currentHHmm(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Round an HH:mm string up to the next 15-min boundary (HH:mm). */
function roundUpToNextQuarter(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const add = (15 - (m % 15)) % 15;
  const total = h * 60 + m + add;
  const wrap = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrap / 60)).padStart(2, '0');
  const mm = String(wrap % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const wrap = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrap / 60)).padStart(2, '0');
  const mm = String(wrap % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
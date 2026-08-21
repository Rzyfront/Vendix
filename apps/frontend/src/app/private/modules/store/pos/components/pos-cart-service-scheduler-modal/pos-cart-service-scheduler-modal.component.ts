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
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ModalComponent as AppModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

/**
 * * CP-POS-SVC-PERF-001 / C.2 + C.3 — POS cart row scheduler modal.
 *
 * Triggered by the calendar icon next to a service/prepared item in
 * the POS cart. Picks (or skips) staff, picks day + start time, and
 * emits a `booking` payload to the parent so the cart can accumulate
 * it. The booking is NOT posted to /api/store/reservations from this
 * component — instead, the cart forwards it to the order editor's
 * atomic booking block (`UpdateOrderEditorItemDto.booking`) and the
 * backend creates or updates the `bookings` row inside the same
 * $transaction that persists the order_items on Actualizar / Cobrar.
 *
 * Why: re-agendar was throwing `POST /api/store/reservations 404`
 * because that endpoint is not the canonical path for the POS flow —
 * it doesn't know about cart lines and can't update an existing
 * booking tied to an order. The editor path is.
 *
 * Per user feedback: when the cashier chooses "Sin personal" the
 * modal MUST still offer slots (default = current round-up to next
 * quarter + service_duration_minutes). It focuses on the hour input
 * automatically and submits client-side slots when the provider is
 * absent. This is also true for re-agendamiento (re-opening with an
 * existingBooking input).
 */
@Component({
  selector: 'app-pos-cart-service-scheduler-modal',
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
      [title]="
        existingBooking() ? 'Re-agendar ' + cartItem()?.product?.name : 'Agendar ' + cartItem()?.product?.name
      "
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <div class="flex flex-col gap-4 p-2 min-w-[420px]">
        <!-- Paso 1: Personal (opcional) -->
        <section class="space-y-2">
          <label class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
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
          <label class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
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

          <label class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
            >Hora de inicio</label
          >
          <!-- focused via autofocus; no-validate keeps the cashier in
               control when the slot they want isn't in the preset list. -->
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

          <label class="text-xs font-semibold text-text-secondary uppercase tracking-wider"
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
export class PosCartServiceSchedulerModalComponent {
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  /** CP-POS-SVC-PERF-001 / C.3 — the cart line being scheduled. */
  cartItem = input<any>(null);
  /** Pre-fill when re-agendamiento. */
  existingBooking = input<any>(null);
  /** Output: emits the booking payload to attach to the cart line. */
  scheduled = output<any>();
  /** Output: closes the modal without scheduling. */
  cancelled = output<void>();

  // -- state --
  providers = signal<any[]>([]);
  providerIdText = signal<string>(''); // ngModel binding (string)
  date = signal<string>(toLocalDateString(new Date()));
  // CP-POS-SVC-PERF-001 / Annotation-1 — preset start/end to current time
  // rounded up to the next 15-min boundary + 30 min. The previous
  // hardcoded "09:00"/"10:00" left the cashier staring at static
  // defaults if the bootstrap() microtask didn't fire in time.
  // Initialising at declaration means the inputs are correct the
  // instant the modal mounts, before any async work.
  startTime = signal<string>(roundUpToNextQuarter(currentHHmm()));
  endTime = signal<string>(
    addMinutes(roundUpToNextQuarter(currentHHmm()), 30),
  );

  /** Parse providerId from the string-signal (avoid number casts in template). */
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

  canSubmit = computed(() => {
    return (
      !!this.date() &&
      !!this.startTime() &&
      !!this.endTime() &&
      this.startTime() < this.endTime()
    );
  });

  constructor() {
    // When the cartItem changes (modal mount), load providers + default
    // duration.
    queueMicrotask(() => this.bootstrap());
  }

  private bootstrap(): void {
    const item = this.cartItem();
    if (!item) return;
    this.loadProviders(item.product?.id);
    this.applyDefaultsForItem(item);
    if (this.existingBooking()) {
      const b = this.existingBooking();
      this.date.set((b.date ?? '').slice(0, 10) || this.date());
      this.startTime.set(b.start_time || this.startTime());
      this.endTime.set(b.end_time || this.endTime());
      this.providerIdText.set(b.provider_id ? String(b.provider_id) : '');
    } else {
      // CP-POS-SVC-PERF-001 — user feedback: default = current time +
      // service duration. Compute duration from variant/product.
      // The signals already carry current+30 defaults from declaration,
      // so this branch only refines the end time when the product
      // declares a longer duration.
      const duration =
        item.product?.service_duration_minutes ??
        item.product?.duration_minutes ??
        30;
      if (duration !== 30) {
        this.endTime.set(addMinutes(this.startTime(), duration));
      }
    }
  }

  private applyDefaultsForItem(_item: any): void {
    // Date defaults to today (already set). No further work.
  }

  private loadProviders(productId: number | undefined): void {
    if (!productId) {
      this.providers.set([]);
      return;
    }
    this.http
      .get<any>(
        `/api/store/reservations/providers/for-service/${productId}`,
      )
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
    // If the cashier cleared end_time, default to start + 30 min.
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
    const item = this.cartItem();
    if (!item) return;

    // CP-POS-SVC-PERF-001 / D.2 — emit the booking block to the parent.
    // The cart attaches this to the matching cart line; the order editor
    // (`UpdateOrderEditorItemDto.booking`) consumes it on Actualizar /
    // Cobrar. NO direct HTTP call here — `/api/store/reservations` is
    // not the canonical POS path and was 404'ing on edit-mode re-agendar.
    const existing = this.existingBooking();
    const payload: any = {
      // If the booking already exists, we send booking_id so the editor
      // UPDATEs the row in place; otherwise the editor creates a new
      // `bookings` row inside the order's $transaction.
      booking_id: existing?.id ?? undefined,
      provider_id: this.providerId(),
      date: this.date(),
      start_time: this.startTime(),
      end_time: this.endTime(),
      notes: existing?.notes ?? '',
      service_location_type: existing?.service_location_type ?? 'shop',
      // Stamp the booking's cart_item_id so the editor can match it
      // back to the cart line during Actualizar / Cobrar.
      cart_item_id: `cart-${item.id}`,
      // Echo the product context for the parent to associate the block
      // with the right order_item when the editor persists.
      product_id: item.product?.id,
      product_variant_id:
        item.product?.product_variants?.find?.(
          (v: any) => v.id === item.product_variant_id,
        )?.id ?? item.product_variant_id,
      customer_id:
        item.customer_id ??
        (item as any)?.customer?.id ??
        null,
      is_update: !!existing,
      is_create: !existing,
    };

    this.toast.success(
      existing ? 'Reserva re-agendada' : 'Reserva agendada',
    );
    // Emit so the cart can collect the block; the editor will validate
    // and persist on Actualizar / Cobrar.
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
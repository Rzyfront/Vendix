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
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { ModalComponent as AppModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

/**
 * * CP-POS-SVC-PERF-001 / C.2 + C.3 — POS cart row scheduler modal.
 *
 * Triggered by the calendar icon next to a service/prepared item in
 * the POS cart. Picks (or skips) staff, picks day + start time, and
 * confirms a booking against `POST /api/store/reservations` so the
 * order has its reservation ready before Actualizar / Cobrar.
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
    SpinnerComponent,
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
            [loading]="submitting()"
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
  startTime = signal<string>('09:00');
  endTime = signal<string>('10:00');
  submitting = signal(false);

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
      const duration =
        item.product?.service_duration_minutes ??
        item.product?.duration_minutes ??
        30;
      const nowHHmm = `${String(new Date().getHours()).padStart(2, '0')}:${String(
        new Date().getMinutes(),
      ).padStart(2, '0')}`;
      const start = roundUpToNextQuarter(nowHHmm);
      this.startTime.set(start);
      this.endTime.set(addMinutes(start, duration));
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

    // Build payload. Provider is OPTIONAL — backend accepts null.
    const payload: any = {
      product_id: item.product?.id,
      product_variant_id: item.product?.product_variants?.find?.(
        (v: any) => v.id === item.product_variant_id,
      )?.id ?? item.product_variant_id,
      customer_id:
        item.customer_id ??
        (this.cartItem as any)?.customer?.id ??
        null,
      provider_id: this.providerId(),
      date: this.date(),
      start_time: this.startTime(),
      end_time: this.endTime(),
      notes: '',
      service_location_type: 'shop',
      channel: 'pos',
      cart_item_id: `cart-${item.id}`,
      // link this booking back to the cart line via a stable id.
      // Backend stores it on bookings.cart_item_id (CP-POS-SVC-PERF-001).
    };

    this.submitting.set(true);
    this.http
      .post<any>('/api/store/reservations', payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          this.submitting.set(false);
          const booking = resp?.data ?? resp;
          this.toast.success(
            this.existingBooking()
              ? 'Reserva re-agendada'
              : 'Reserva creada',
          );
          this.scheduled.emit(booking);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(
            err?.error?.message ??
              'No se pudo agendar la cita. Intenta de nuevo.',
          );
        },
      });
  }
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
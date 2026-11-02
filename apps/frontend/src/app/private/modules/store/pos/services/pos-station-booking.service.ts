import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { CartItem, CartState } from '../models/cart.model';

/** localStorage key for the ids of orderless station bookings this POS created. */
const POS_CREATED_STATION_BOOKINGS_KEY = 'vendix_pos_station_bookings';

/**
 * Station-required bookings must exist (with a live allocation) BEFORE
 * the POS payment runs: the payments gate rejects station orders whose
 * bookings are missing or have no allocation (QUI-970). Regular
 * bookings are still created after payment; only `requires_station`
 * lines are persisted at schedule time, without an order (the gate
 * links them via `booking_ids`).
 */
@Injectable({ providedIn: 'root' })
export class PosStationBookingService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Orderless station bookings created by this POS for the current cart.
   * Only these may be cancelled when the cashier drops the line or
   * empties the cart: bookings adopted from an existing order or
   * reservation are real appointments and are never touched. Persisted
   * so a reload with the cart still in localStorage keeps the link.
   */
  private readonly posCreatedIds = new Set<number>(readStoredIds());

  /**
   * Creates (or reschedules, when the block already carries a booking
   * id) the reservation for a station line scheduled in the POS.
   * `skip_order_creation` keeps the booking orderless until the gate
   * links it at pay time. Emits the created/updated booking row.
   *
   * Update path uses PATCH `:id/reschedule` (there is no PUT route;
   * PATCH `:id` is notes-only). It moves date/time/station and the
   * specialist (`provider_id`, RescheduleBookingDto since QUI-972);
   * the customer stays create-only on this path.
   */
  persistScheduledStationBooking(
    block: Record<string, any>,
    fallbackCustomerId?: number | null,
  ): Observable<any> {
    const payload: Record<string, any> = {
      customer_id: block['customer_id'] ?? fallbackCustomerId ?? null,
      product_id: Number(block['product_id']),
      product_variant_id: block['product_variant_id'] ?? null,
      provider_id: block['provider_id'] ?? null,
      station_id: block['station_id'] ?? null,
      date: block['date'],
      start_time: block['start_time'],
      end_time: block['end_time'],
      channel: 'pos',
      notes: block['notes'] ?? '',
      service_location_type: block['service_location_type'] ?? 'shop',
      cart_item_id: block['cart_item_id'] ?? null,
      skip_order_creation: true,
    };
    const existingId = Number(block['booking_id'] ?? block['id'] ?? 0);
    if (Number.isFinite(existingId) && existingId > 0) {
      const reschedule: Record<string, any> = {
        station_id: block['station_id'] ?? null,
        date: block['date'],
        start_time: block['start_time'],
        end_time: block['end_time'],
      };
      // A specialist change must reach the booking, not only the cart.
      const providerId = Number(block['provider_id'] ?? 0);
      if (Number.isFinite(providerId) && providerId > 0) {
        reschedule['provider_id'] = providerId;
      }
      return this.http
        .patch<any>(
          `${this.apiUrl}/store/reservations/${existingId}/reschedule`,
          reschedule,
        )
        .pipe(map((resp: any) => resp?.data ?? resp));
    }
    return this.http
      .post<any>(`${this.apiUrl}/store/reservations`, payload)
      .pipe(
        map((resp: any) => resp?.data ?? resp),
        tap((created: any) => {
          const id = Number(created?.id ?? created?.booking_id ?? 0);
          if (Number.isFinite(id) && id > 0) {
            this.posCreatedIds.add(id);
            this.persistIds();
          }
        }),
      );
  }

  /**
   * Ids of the orderless station bookings this POS created for the
   * given cart lines (the ones that would be orphaned if the lines
   * leave the cart without being charged).
   */
  posCreatedBookingIds(items: ReadonlyArray<CartItem>): number[] {
    const ids: number[] = [];
    for (const item of items) {
      if (item?.product?.requires_station !== true) continue;
      const id = Number(item?.booking?.booking_id ?? 0);
      if (Number.isFinite(id) && id > 0 && this.posCreatedIds.has(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Cancels orderless station bookings whose line left the cart without
   * payment, so they stop holding the station and the specialist.
   * Failures are logged, never thrown: the cashier is not blocked and
   * the booking can still be cancelled from the agenda. `ids` must come
   * from `posCreatedBookingIds` (read before the cart reset, which may
   * already have forgotten them).
   */
  cancelOrphanBookings(ids: ReadonlyArray<number>): Observable<void> {
    const targets = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
    if (targets.length === 0) return of(undefined);
    for (const id of targets) this.posCreatedIds.delete(id);
    this.persistIds();
    return forkJoin(
      targets.map((id) =>
        this.http
          .patch<any>(`${this.apiUrl}/store/reservations/${id}/cancel`, {})
          .pipe(
            catchError((err) => {
              // eslint-disable-next-line no-console
              console.warn('[pos-station-booking] cancel failed', {
                bookingId: id,
                error: err?.message ?? err,
              });
              return of(null);
            }),
          ),
      ),
    ).pipe(map(() => undefined));
  }

  /**
   * Stops tracking every POS-created booking: called whenever the cart
   * resets (sale charged, cart sent to a table/station, or abandoned
   * after its cancellations were issued). Charged bookings are linked
   * to their order and must never be cancelled later.
   */
  forgetAll(): void {
    if (this.posCreatedIds.size === 0) return;
    this.posCreatedIds.clear();
    this.persistIds();
  }

  private persistIds(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (this.posCreatedIds.size === 0) {
        localStorage.removeItem(POS_CREATED_STATION_BOOKINGS_KEY);
      } else {
        localStorage.setItem(
          POS_CREATED_STATION_BOOKINGS_KEY,
          JSON.stringify([...this.posCreatedIds]),
        );
      }
    } catch {
      // Storage full or blocked: tracking stays in memory.
    }
  }
}

function readStoredIds(): number[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(
      localStorage.getItem(POS_CREATED_STATION_BOOKINGS_KEY) ?? '[]',
    );
    return Array.isArray(raw)
      ? raw.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
  } catch {
    return [];
  }
}

/**
 * Pre-pay guard for station services (QUI-970, criterion 4). Returns
 * an actionable message when a `requires_station` line cannot be
 * charged yet, or null when every station line is scheduled with a
 * persisted booking. Pure: safe to call from any pay path.
 */
export function findUnscheduledStationLine(
  cartState: CartState | null | undefined,
): string | null {
  const items = cartState?.items ?? [];
  const pending = cartState?.pendingBookings ?? [];
  // Each persisted pending booking satisfies exactly one cart line
  // (two lines of the same product need two bookings).
  const consumedPending = new Set<object>();
  for (const item of items) {
    if (item?.product?.requires_station !== true) continue;
    const name = item?.product?.name || 'El servicio';
    const productId = Number(item?.product?.id ?? 0);
    const variantId = (item as any)?.variant_id ?? null;
    const quantity = Number(item?.quantity ?? 1);
    if (Number.isFinite(quantity) && quantity > 1) {
      return `${name} usa estación y se cobra por unidad: déjalo en cantidad 1 por línea y agenda cada línea.`;
    }
    // A persisted booking for this line (scheduled here or adopted from
    // an existing reservation) satisfies the payments gate, which
    // matches bookings to lines by product+variant units.
    const persisted = pending.find(
      (pb: any) =>
        !consumedPending.has(pb) &&
        Number(pb?.id ?? 0) > 0 &&
        Number(pb?.product_id ?? 0) === productId &&
        (pb?.product_variant_id ?? null) === (variantId ?? null),
    );
    if (persisted) {
      consumedPending.add(persisted);
      continue;
    }
    const booking: any = (item as any)?.booking;
    if (!booking || !booking.date || !booking.start_time) {
      return `Agenda "${name}" y elige una estación antes de cobrar.`;
    }
    if (booking.station_id == null) {
      return `"${name}" quedó agendado sin estación: reabre Agendar y elige una estación libre.`;
    }
    const bookingId = Number(booking.booking_id ?? booking.id ?? 0);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return `"${name}" aún no tiene reserva creada: reabre Agendar y confirma el horario con su estación.`;
    }
  }
  return null;
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { CartState } from '../models/cart.model';

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
   * Creates (or updates, when the block already carries a booking id)
   * the reservation for a station line scheduled in the POS.
   * `skip_order_creation` keeps the booking orderless until the gate
   * links it at pay time. Emits the created/updated booking row.
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
    const request$ =
      Number.isFinite(existingId) && existingId > 0
        ? this.http.put<any>(
            `${this.apiUrl}/store/reservations/${existingId}`,
            payload,
          )
        : this.http.post<any>(`${this.apiUrl}/store/reservations`, payload);
    return request$.pipe(map((resp: any) => resp?.data ?? resp));
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
    const persisted = pending.some(
      (pb: any) =>
        Number(pb?.id ?? 0) > 0 &&
        Number(pb?.product_id ?? 0) === productId &&
        (pb?.product_variant_id ?? null) === (variantId ?? null),
    );
    if (persisted) continue;
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

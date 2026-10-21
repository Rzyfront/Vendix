import { Injectable, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { getModulesHiddenByIndustries } from '../../../../../shared/constants/industry-modules.constant';
import type { CartItem } from '../models/cart.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Estados en los que una atención de estación acepta cargos a su cuenta. */
export const ACTIVE_SERVICE_SESSION_STATUSES = [
  'open',
  'in_progress',
  'paused',
] as const;

export interface PosServiceSessionOrder {
  id: number;
  order_number: string;
  grand_total: number;
  subtotal_amount: number;
  remaining_balance: number;
}

export interface PosServiceSessionSubject {
  id?: number;
  subject_type?: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Fila de `GET /store/service-sessions` (lo que el POS necesita). */
export interface PosServiceSession {
  id: number;
  status: string;
  station_id: number;
  station_name: string;
  product_name: string;
  opened_at?: string | null;
  subject?: PosServiceSessionSubject | null;
  order: PosServiceSessionOrder | null;
}

/** Línea del contrato `POST /store/service-sessions/:id/items/bulk`. */
export interface PosServiceSessionItemLine {
  product_id: number;
  quantity: number;
  unit_price?: number;
  description?: string;
}

export interface ChargeCartToSessionResult {
  order_id: number;
  grand_total: number;
  items?: unknown[];
}

/** Resultado de traducir el carrito del POS a líneas de la cuenta de estación. */
export interface StationCartMapping {
  lines: PosServiceSessionItemLine[];
  /** Líneas que NO se pueden cargar a la estación, con el motivo legible. */
  blocked: Array<{ name: string; reason: string }>;
  /** Suma (antes de impuestos) de lo que se cargará: qty × unit_price. */
  amount: number;
}

/** Máximo de líneas por llamada que acepta el endpoint bulk. */
export const SERVICE_SESSION_BULK_MAX_LINES = 50;

/**
 * Puente POS ↔ Estaciones de servicio.
 *
 * Gemelo del flujo de mesas (`PosRestaurantIntegrationService`): en un
 * taller / lavadero el vehículo está en una estación con una atención abierta
 * (`service_sessions` + orden borrador `SVC-{id}`); el cajero arma en el POS
 * lo que se le agrega (cambio de aceite, filtro…) y en vez de cobrarlo ahora
 * lo carga a la cuenta de esa estación.
 *
 * Gating: visible solo cuando el módulo `orders_service_stations` NO queda
 * oculto por las industrias de la tienda (misma regla que el sidebar —
 * `getModulesHiddenByIndustries`). La autorización real la hace el backend.
 */
@Injectable({ providedIn: 'root' })
export class PosServiceStationIntegrationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthFacade);
  private readonly apiUrl = environment.apiUrl;

  /** `true` cuando la tienda usa estaciones de servicio (industria `service`). */
  readonly isServiceStationsMode = computed(() => {
    const industries = this.auth.storeIndustries();
    if (!industries || industries.length === 0) return false;
    return !getModulesHiddenByIndustries(industries).includes(
      'orders_service_stations',
    );
  });

  /** Atenciones activas (open / in_progress / paused) de la tienda. */
  listActiveSessions(): Observable<PosServiceSession[]> {
    return this.http
      .get<
        ApiResponse<{ items: PosServiceSession[]; next_cursor: number | null }>
      >(`${this.apiUrl}/store/service-sessions`)
      .pipe(
        map((res) => {
          const items = res?.data?.items ?? [];
          return items.filter((s) =>
            (ACTIVE_SERVICE_SESSION_STATUSES as readonly string[]).includes(
              s.status,
            ),
          );
        }),
      );
  }

  /** Carga las líneas a la cuenta de la atención en una sola transacción. */
  chargeCartToSession(
    sessionId: number,
    lines: PosServiceSessionItemLine[],
  ): Observable<ChargeCartToSessionResult> {
    if (lines.length === 0) {
      return throwError(() => new Error('El carrito no tiene líneas para cargar'));
    }
    if (lines.length > SERVICE_SESSION_BULK_MAX_LINES) {
      return throwError(
        () =>
          new Error(
            `Máximo ${SERVICE_SESSION_BULK_MAX_LINES} líneas por carga a estación`,
          ),
      );
    }
    return this.http
      .post<ApiResponse<ChargeCartToSessionResult>>(
        `${this.apiUrl}/store/service-sessions/${sessionId}/items/bulk`,
        { items: lines },
      )
      .pipe(
        map((res) => res.data),
        catchError((err) => throwError(() => err)),
      );
  }

  /**
   * Traduce las líneas del carrito al contrato de la cuenta de estación.
   *
   * La cuenta de estación (AddSessionItemDto) solo conoce
   * `product_id + quantity(int) + unit_price + description`: no hay variante,
   * empaque, peso legado ni ítems libres. Esas líneas se BLOQUEAN con motivo
   * en lugar de cargarse con datos perdidos (ej. cargar el producto padre sin
   * la variante elegida).
   *
   * `unit_price` viaja como el precio unitario antes de impuestos del carrito
   * (`CartItem.unitPrice`), que ya refleja tarifa aplicada y precio manual; es
   * la misma base que usa el backend cuando lo omite (`products.base_price`).
   */
  mapCartToLines(items: CartItem[]): StationCartMapping {
    const lines: PosServiceSessionItemLine[] = [];
    const blocked: StationCartMapping['blocked'] = [];
    let amount = 0;

    for (const it of items) {
      const name = it.variant_display_name || it.product?.name || 'Ítem';
      if (it.itemType === 'custom') {
        blocked.push({ name, reason: 'los ítems libres no se pueden cargar a una estación' });
        continue;
      }
      const productId = Number(it.product?.id);
      if (!Number.isFinite(productId) || productId <= 0) {
        blocked.push({ name, reason: 'producto sin identificador' });
        continue;
      }
      if (it.variant_id != null) {
        blocked.push({ name, reason: 'la cuenta de estación aún no admite variantes' });
        continue;
      }
      if ((it.units_per_package ?? 1) > 1) {
        blocked.push({ name, reason: 'las presentaciones por empaque no se pueden cargar a una estación' });
        continue;
      }
      if (it.is_weight_product && it.weight != null) {
        blocked.push({ name, reason: 'los productos por peso no se pueden cargar a una estación' });
        continue;
      }
      const quantity = Number(it.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        blocked.push({ name, reason: 'la cantidad debe ser un número entero' });
        continue;
      }
      const unitPrice = Math.max(0, Math.round(Number(it.unitPrice ?? 0) * 100) / 100);
      const line: PosServiceSessionItemLine = {
        product_id: productId,
        quantity,
        unit_price: unitPrice,
      };
      const note = it.notes?.trim();
      if (note) line.description = note.slice(0, 255);
      lines.push(line);
      amount += unitPrice * quantity;
    }

    return { lines, blocked, amount: Math.round(amount * 100) / 100 };
  }
}

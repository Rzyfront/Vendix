import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { OrdersService } from '../../orders/services/orders.service';
import { Order } from '../../orders/interfaces/order.interface';

/**
 * BUSCAR EL PEDIDO QUE SE VA A FACTURAR, POR SU NÚMERO.
 *
 * ─── EL PROBLEMA QUE CIERRA ─────────────────────────────────────────────────
 *
 * «Crear desde pedido» pedía el ID —la clave primaria— en un `<input
 * type="number">`. Ese número no aparece en ninguna pantalla que el comerciante
 * use: la lista, el ticket y el WhatsApp muestran `order_number` (`ORD-000142`).
 * Es decir, el campo obligatorio del formulario pedía un dato que el usuario no
 * tiene forma de conocer, y escribir el número visible producía un 404 sobre un
 * pedido ajeno o inexistente.
 *
 * ─── LAS DOS BÚSQUEDAS, Y POR QUÉ SON DOS ───────────────────────────────────
 *
 * `GET /store/orders?search=` busca por `order_number`, nombre y correo del
 * cliente (`orders.service.ts`, `findAll`) — NO por `id`. Así que quien SÍ
 * conoce el id (soporte, un enlace, la barra de direcciones) escribía «142» y no
 * encontraba nada, porque «142» sólo coincide con `ORD-000142` si la cadena lo
 * contiene. Cuando el término es puramente numérico se pregunta ADEMÁS por
 * `GET /store/orders/:id`, y el resultado va primero: es una coincidencia exacta
 * y las otras son parciales.
 *
 * ─── DEGRADACIÓN ────────────────────────────────────────────────────────────
 *
 * Ningún método lanza. Un pedido inexistente por id no es un error del usuario
 * —es la mitad normal de una búsqueda numérica—, y un fallo de red devuelve
 * lista vacía en vez de tumbar el modal de facturación.
 */

export interface InvoiceOrderOption {
  /** Clave primaria: es lo ÚNICO que viaja a `POST /invoicing/from-order/:id`. */
  id: number;
  /** Lo que el comerciante reconoce (`ORD-000142`). */
  orderNumber: string;
  state: string;
  customerName: string;
  total: number;
  createdAt: string;
}

const DEFAULT_LIMIT = 10;

@Injectable({ providedIn: 'root' })
export class InvoiceOrderLookupService {
  private readonly orders = inject(OrdersService);

  search(term: string, limit = DEFAULT_LIMIT): Observable<InvoiceOrderOption[]> {
    const trimmed = (term ?? '').trim();

    const byText = this.orders
      .getOrders({
        limit,
        ...(trimmed ? { search: trimmed } : {}),
      })
      .pipe(
        map((response) => (response?.data ?? []).map(toOption)),
        catchError(() => of([] as InvoiceOrderOption[])),
      );

    // Un término puramente numérico PUEDE ser el id. Se pregunta también por él.
    if (!/^\d+$/.test(trimmed)) {
      return byText;
    }

    const byId = this.orders.getOrderById(Number(trimmed)).pipe(
      map((order) => (order?.id ? [toOption(order)] : [])),
      catchError(() => of([] as InvoiceOrderOption[])),
    );

    return forkJoin([byId, byText]).pipe(
      map(([exact, matches]) => {
        const seen = new Set(exact.map((option) => option.id));
        return [
          ...exact,
          ...matches.filter((option) => !seen.has(option.id)),
        ].slice(0, limit);
      }),
    );
  }

  /** Resuelve un id ya elegido, para poder pintar su etiqueta. */
  getById(id: number): Observable<InvoiceOrderOption | null> {
    if (!Number.isFinite(id) || id <= 0) {
      return of(null);
    }
    return this.orders.getOrderById(id).pipe(
      map((order) => (order?.id ? toOption(order) : null)),
      catchError(() => of(null)),
    );
  }
}

function toOption(order: Order): InvoiceOrderOption {
  const user = order.users;
  const customerName =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    user?.email ||
    'Sin cliente';

  return {
    id: order.id,
    orderNumber: order.order_number || `#${order.id}`,
    state: order.state ?? '',
    customerName,
    total: Number(order.grand_total) || 0,
    createdAt: order.created_at ?? '',
  };
}

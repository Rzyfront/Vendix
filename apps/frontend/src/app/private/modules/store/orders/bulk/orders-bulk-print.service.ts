/**
 * Orquestador de la impresión masiva de órdenes (QUI-599).
 *
 * ## Qué compone
 *
 * ```
 * OrdersBulkService.fetchPrintableOrdersInBatches()   ← datos (HTTP)
 *        │
 * OrderTicketService.toTicketData(order)              ← dominio → tiquete
 *        │
 * PosTicketService.printTicketsBatch(tickets, { … })  ← papel + iframe + diálogo
 * ```
 *
 * `printTicketsBatch` es el MISMO renderer que dibuja el tiquete post-venta del
 * POS y la previsualización de Ajustes → Recibos, así que la paridad de formato
 * que pedía el ticket queda garantizada por construcción y no por convenio.
 *
 * ## Por qué es un servicio y no un método del componente
 *
 * `orders-bulk-page.component.ts` ya pasa de las 1000 líneas. Esta composición
 * son tres colaboradores y una traducción de errores; meterla ahí la mezclaría
 * con la selección, la paginación y los permisos.
 *
 * ## Por qué devuelve `Observable` y no `Promise`
 *
 * Para que `runPrint()` conserve su forma actual y su
 * `takeUntilDestroyed(this.destroyRef)`: si el operador navega fuera mientras el
 * lote se está pidiendo, la suscripción se cancela sola. Una `Promise` no se
 * cancela y el `next` correría sobre un componente ya destruido.
 *
 * ## El diálogo de impresión bloquea
 *
 * `printTicketsBatch` resuelve DESPUÉS de que el operador cierre el diálogo del
 * navegador (`window.print()` es bloqueante). `onProgress` cubre solo la fase de
 * render (0→N tiquetes dibujados). Por eso `renderProgress` distingue las dos
 * fases: mientras `done < total` se está dibujando; cuando `done === total` el
 * documento ya está armado y lo que queda es el diálogo abierto.
 *
 * ## Un render fallido NO se traga
 *
 * Las órdenes que `printTicketsBatch` no pudo resolver o imprimir vuelven en
 * `failedOrderIds` y se suman a `failedIds` del desenlace: nunca se omiten en
 * silencio. Si NADA llegó al papel, `printTicketsBatch` rechaza; el
 * `catchError` de aquí convierte ese rechazo en un desenlace con el mensaje y
 * los ids afectados — nunca en un "listo" mentiroso.
 *
 * ## Formatos mezclados ⇒ varias tandas
 *
 * El backend decide el formato de cada orden (factura electrónica o tiquete
 * POS, cada uno con su papel). Lo que no cabe en un solo documento sale en
 * tandas separadas, un diálogo por tanda; `printJobs` / `printJobLabels` le
 * permiten al componente explicarle al operador por qué vio más de un diálogo.
 */

import { Injectable, inject, signal } from '@angular/core';
import {
  Observable,
  catchError,
  finalize,
  from,
  map,
  of,
  switchMap,
} from 'rxjs';

import type { PrintFormatType } from '../../../../../core/models/print-formats.model';
import {
  PosTicketService,
  TicketBatchPrintError,
  type TicketBatchPrintResult,
} from '../../pos/services/pos-ticket.service';
import { OrderTicketService } from '../services/order-ticket.service';
import { OrdersBulkService } from './orders-bulk.service';
import type {
  BulkPrintOutcome,
  BulkPrintPayload,
} from './orders-bulk.interface';

/** Avance del render, en tiquetes dibujados. `total === 0` ⇒ no hay render en curso. */
export interface BulkPrintRenderProgress {
  done: number;
  total: number;
}

const IDLE_RENDER_PROGRESS: BulkPrintRenderProgress = { done: 0, total: 0 };

/** Nombre que ve el operador para cada formato que puede resolver una orden. */
const PRINT_JOB_LABELS: Partial<Record<PrintFormatType, string>> = {
  pos_sale_ticket: 'tiquete POS',
  pos_electronic_invoice: 'factura electrónica',
  fiscal_electronic_invoice: 'factura electrónica',
  sales_order_invoice: 'factura de venta',
};

/** Mensaje cuando el render cae por algo que no es un error de dominio. */
const GENERIC_RENDER_FAILURE =
  'No se pudieron dibujar los tiquetes de la selección, así que no se envió nada a la impresora. ' +
  'Vuelve a intentarlo; si persiste, imprime en grupos más pequeños para aislar la orden que falla.';

@Injectable({ providedIn: 'root' })
export class OrdersBulkPrintService {
  private readonly bulkService = inject(OrdersBulkService);
  private readonly orderTicket = inject(OrderTicketService);
  private readonly posTicket = inject(PosTicketService);

  private readonly renderProgressState = signal<BulkPrintRenderProgress>(
    IDLE_RENDER_PROGRESS,
  );

  /**
   * Avance del render, como señal, para que la barra sea reactiva sin que el
   * componente se suscriba a nada.
   *
   * Es una señal aparte de `OrdersBulkService.progress` porque mide otra cosa:
   * esa cuenta lotes HTTP pedidos, esta cuenta tiquetes dibujados. Fundirlas
   * dejaría la barra en 100% durante todo el render.
   */
  readonly renderProgress = this.renderProgressState.asReadonly();

  /**
   * Trae, mapea e imprime los tiquetes POS de las órdenes seleccionadas.
   *
   * Nunca emite error: todo fallo (HTTP o render) se traduce a un
   * {@link BulkPrintOutcome} con `rendered: 0`, `failureMessage` y `failedIds`,
   * porque el operador necesita saber QUÉ pasó, y un `error` del stream dejaría
   * al componente mostrando un mensaje genérico.
   */
  printSelection(ids: readonly number[]): Observable<BulkPrintOutcome> {
    this.renderProgressState.set(IDLE_RENDER_PROGRESS);

    return this.bulkService
      .fetchPrintableOrdersInBatches({ ids: [...ids] })
      .pipe(
        switchMap((payload) => this.renderPayload(payload)),
        // `finalize` y no un reset por rama: cubre también la CANCELACIÓN. Si el
        // operador navega fuera mientras el diálogo está abierto, el
        // `takeUntilDestroyed` del componente corta la suscripción y ni `map` ni
        // `catchError` llegan a correr; sin esto la señal de un servicio `root`
        // se quedaría clavada en "Dibujando 47/300" para la siguiente visita.
        finalize(() => this.renderProgressState.set(IDLE_RENDER_PROGRESS)),
      );
  }

  /** Vuelve el avance del render a cero (al cerrar la vista, p. ej.). */
  resetRenderProgress(): void {
    this.renderProgressState.set(IDLE_RENDER_PROGRESS);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  private renderPayload(
    payload: BulkPrintPayload,
  ): Observable<BulkPrintOutcome> {
    const orders = payload.orders ?? [];

    // Sin órdenes imprimibles no se abre ningún diálogo. El desenlace lleva el
    // mensaje REAL del backend si hubo uno (`ORD_BULK_PRINT_001` cuando nada es
    // imprimible, o el fallo del lote); el componente decide el texto por
    // defecto cuando no hay ninguno.
    if (orders.length === 0) {
      return of(this.emptyOutcome(payload));
    }

    // El mapper no recibe `cashier`: en el masivo `getCurrentUser()` nombraría
    // al operador que imprime, no a quien vendió. Un tiquete que afirma un hecho
    // falso ×300 es peor que uno que dice 'Administrador'.
    const tickets = orders.map((order) => this.orderTicket.toTicketData(order));

    this.renderProgressState.set({ done: 0, total: tickets.length });

    return from(
      this.posTicket.printTicketsBatch(tickets, {
        onProgress: (done, total) =>
          this.renderProgressState.set({ done, total }),
      }),
    ).pipe(
      // El reset del avance lo hace el `finalize` de `printSelection`, que cubre
      // también la cancelación; repetirlo aquí solo daría dos dueños del mismo
      // estado.
      map((result) => this.toOutcome(payload, result)),
      catchError((error: unknown) => {
        // El detalle técnico va a la consola y NO al toast. Solo un
        // `TicketBatchPrintError` trae un mensaje redactado para el operador;
        // cualquier otro (un `TypeError` del render) se cambia por el genérico,
        // porque "Cannot read properties of undefined…" no le dice nada a quien
        // está en el mostrador.
        console.error(
          '[orders-bulk-print] el render del lote falló; no se imprimió nada',
          error,
          error instanceof TicketBatchPrintError ? error.detail : undefined,
        );
        // Si `printTicketsBatch` rechazó, NADA llegó al papel, así que los ids
        // de las órdenes que sí eran imprimibles pasan a fallidos. El mensaje
        // del render pisa el del backend: es el fallo que el operador acaba de
        // ver, y el otro ya quedó en la consola.
        return of({
          rendered: 0,
          pages: 0,
          skipped: payload.skipped ?? [],
          failureMessage:
            error instanceof TicketBatchPrintError
              ? error.message
              : GENERIC_RENDER_FAILURE,
          failedIds: [
            ...(payload.failedIds ?? []),
            ...orders.map((order) => order.id),
          ],
        } satisfies BulkPrintOutcome);
      }),
    );
  }

  /**
   * Funde el resultado del render con lo que ya traía el payload. Las órdenes
   * que no llegaron al papel se suman a `failedIds`; el mensaje del backend
   * (lote HTTP caído) va primero porque ocurrió antes.
   */
  private toOutcome(
    payload: BulkPrintPayload,
    result: TicketBatchPrintResult,
  ): BulkPrintOutcome {
    const failureMessage =
      [payload.failureMessage, result.failureMessage]
        .filter((message): message is string => !!message)
        .join(' ') || undefined;
    const labels = [
      ...new Set(
        result.groupFormats
          .map((format) => PRINT_JOB_LABELS[format])
          .filter((label): label is string => !!label),
      ),
    ];

    return {
      rendered: result.rendered,
      pages: result.pages,
      skipped: payload.skipped ?? [],
      failureMessage,
      failedIds: [...(payload.failedIds ?? []), ...result.failedOrderIds],
      printJobs: result.groups,
      printJobLabels: labels,
    };
  }

  private emptyOutcome(payload: BulkPrintPayload): BulkPrintOutcome {
    return {
      rendered: 0,
      pages: 0,
      skipped: payload.skipped ?? [],
      failureMessage: payload.failureMessage,
      failedIds: payload.failedIds ?? [],
    };
  }
}

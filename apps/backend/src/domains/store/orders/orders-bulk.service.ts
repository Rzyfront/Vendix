import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { OrderFlowService } from './order-flow/order-flow.service';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { DispatchRoutesService } from '../dispatch-routes/dispatch-routes.service';
import {
  PRINT_FORMATS,
  PrintFormat,
} from '../settings/interfaces/store-settings.interface';
import { order_state_enum } from '@prisma/client';
import { VALID_TRANSITIONS } from './order-flow/order-flow.service';
import {
  BulkAssignRouteDto,
  BulkPrintOrdersDto,
  BulkTransitionOrdersDto,
  BulkOrderItemStatus,
  BulkOrderPreviewItemDto,
  BulkOrderResultItemDto,
  BulkOrdersPreviewResultDto,
  BulkOrdersResultDto,
  BulkPrintResultDto,
  BulkPrintSkippedOrderDto,
} from './dto/bulk-orders.dto';

/**
 * Etiquetas en español de los estados de orden, para los mensajes del dry-run.
 * Duplica a propósito el mapa que el frontend tiene en `formatStatus`: el
 * backend redacta el motivo completo (el modal solo lo pinta), así que no puede
 * depender de que el cliente sepa traducir el enum.
 */
/**
 * Formas de fila de los dos dry-runs.
 *
 * Los delegates de `StorePrismaService` no propagan la inferencia de `select`
 * (el resultado sale como `{}`), así que hay que declarar la forma esperada a
 * mano. Se hace con un tipo local y no con `any` a propósito: el compilador
 * sigue verificando cada acceso contra lo que el `select` realmente pide, y si
 * alguien quita un campo del `select` sin quitarlo de aquí, el error aparece en
 * el sitio de uso en vez de propagarse como `undefined` en runtime.
 */
interface PreviewOrderRow {
  id: number;
  order_number: string;
  state: order_state_enum;
}

interface PreviewDispatchOrderRow extends PreviewOrderRow {
  delivery_type: string | null;
  shipping_address_snapshot: unknown;
  shipping_address_id: number | null;
  order_items: Array<{ id: number; quantity: unknown }>;
}

/**
 * Estados cuya orden NO entra en la impresión masiva.
 *
 * Son estados terminales negativos: la venta se anuló (`cancelled`) o se
 * devolvió el dinero (`refunded`). Imprimir su comprobante es peor que no
 * imprimirlo — en mostrador un papel con productos y totales se lee como una
 * venta viva.
 *
 * `draft` NO está aquí a propósito: un borrador es una orden en construcción y
 * el operador legítimamente imprime su picking para armarla.
 */
const NON_PRINTABLE_ORDER_STATES: ReadonlySet<order_state_enum> = new Set([
  order_state_enum.cancelled,
  order_state_enum.refunded,
]);

const STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  created: 'Creada',
  pending_payment: 'Pago Pendiente',
  processing: 'Procesando',
  shipped: 'Enviada',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
  refunded: 'Reembolsada',
  finished: 'Finalizada',
};

/**
 * Orquestación de operaciones masivas sobre órdenes (QUI-599).
 *
 * Tres acciones, un mismo contrato de resultado parcial (`BulkOrdersResultDto`):
 *
 * 1. `bulkTransition` — delega en `OrderFlowService.forceOrderState` por id.
 *    El carril forzado ya ejecuta los efectos (cancelar pagos, liberar reservas,
 *    emitir `order.shipped` / `order.status_changed`, commit de inventario) y
 *    audita la forzada, así que este método NO escribe `orders.state` en crudo
 *    ni duplica la cadena de efectos. `failed > 0` sigue siendo HTTP 200
 *    (calque de QUI-567).
 *
 * 2. `bulkAssignRoute` — orquesta dos seams existentes en orden: crea las
 *    remisiones vía `DispatchNotesService.createFromOrdersBatch` (que ya
 *    validaba estado / stock / duplicados y devuelve `results[]` por orden) y
 *    luego llama una sola vez a `DispatchRoutesService.addStops` con todas las
 *    remisiones generadas. Las remisiones que no se crearon se reportan como
 *    `failed` en el resultado por orden; las que se crearon pero cuyo stop
 *    falló al asignarse se reportan como `ok` con un mensaje advirtiendo que la
 *    remisión existe pero no está en la planilla (la asignación manual queda
 *    como remedio).
 *
 * 3. `bulkPrint` — NO dibuja nada. Devuelve las órdenes imprimibles hidratadas
 *    con lo que el tiquete POS lee, más el `pos_ticket_format` de la tienda, y
 *    el render lo hace `PosTicketService` en el frontend: el MISMO servicio que
 *    dibuja el tiquete post-venta del POS y la previsualización de
 *    Ajustes → Recibos. Antes había aquí un segundo renderer (PDFKit, layout de
 *    factura) cuyo resultado no se parecía al tiquete configurado; la paridad
 *    con dos renderers es un convenio que se rompe solo, con uno es una
 *    propiedad estructural.
 *
 * El tope de ids por lote lo impone el DTO (`@ArrayMaxSize`); el service no
 * re-valida.
 */
@Injectable()
export class OrdersBulkService {
  private readonly logger = new Logger(OrdersBulkService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly orderFlowService: OrderFlowService,
    private readonly dispatchNotesService: DispatchNotesService,
    private readonly dispatchRoutesService: DispatchRoutesService,
  ) {}

  // ─── Transition ────────────────────────────────────────────────────

  /**
   * Transiciona N órdenes al mismo estado destino. Cada orden delega en
   * `forceOrderState`, que es idempotente y audita. Un fallo en una orden no
   * aborta las demás.
   */
  async bulkTransition(
    dto: BulkTransitionOrdersDto,
  ): Promise<BulkOrdersResultDto> {
    const reason =
      dto.reason?.trim() || `Operación masiva QUI-599 (${dto.targetState})`;

    const results: BulkOrderResultItemDto[] = [];
    let successful = 0;
    let failed = 0;

    for (const id of dto.ids) {
      try {
        await this.orderFlowService.forceOrderState(id, dto.targetState, {
          reason,
        });
        results.push({ id, status: 'ok', message: `Orden ${id} → ${dto.targetState}` });
        successful++;
      } catch (error: any) {
        failed++;
        const code = error?.code ?? 'ORD_BULK_TRANSITION_FAIL';
        const message =
          error?.message ??
          `No se pudo transicionar la orden ${id} a ${dto.targetState}`;
        results.push({ id, status: 'error', code, message });
        this.logger.warn(
          `bulkTransition falló para orden ${id} → ${dto.targetState}: ${message}`,
        );
      }
    }

    return { total: dto.ids.length, successful, failed, results };
  }

  // ─── Preview de transición (dry-run) ───────────────────────────────

  /**
   * Dry-run de `bulkTransition`. NO escribe nada: clasifica cada orden contra
   * la misma máquina de estados que va a usar `forceOrderState`, así que lo que
   * el modal promete es lo que va a pasar.
   *
   * Un solo `findMany` para las N órdenes — no `getValidTransitions(id)` por
   * orden, que haría N consultas para leer un mapa constante. El mapa se
   * importa de `order-flow.service` en vez de copiarse: una copia local
   * quedaría desactualizada en cuanto se abra una arista nueva allá.
   *
   * Los ids que el `findMany` no devuelve son `error`: o no existen, o son de
   * otra tienda y el scope del `StorePrismaService` los filtró. Se reportan
   * igual para que el operador vea que su selección traía ids inválidos.
   */
  async previewTransition(
    dto: BulkTransitionOrdersDto,
  ): Promise<BulkOrdersPreviewResultDto> {
    const orders = (await this.prisma.orders.findMany({
      where: { id: { in: dto.ids } },
      select: { id: true, order_number: true, state: true },
    })) as PreviewOrderRow[];
    // `as const` para que el callback devuelva una TUPLA y no `(number | T)[]`:
    // sin él, `new Map` infiere `Map<number | T, number | T>` y el valor que
    // sale de `.get()` pierde la forma de la orden.
    const byId = new Map(orders.map((o) => [o.id, o] as const));

    const items: BulkOrderPreviewItemDto[] = dto.ids.map((id) => {
      const order = byId.get(id);
      if (!order) {
        return {
          id,
          order_number: `#${id}`,
          current_state: 'desconocido',
          status: 'error' as const,
          code: 'ORD_BULK_NOT_FOUND',
          message: 'La orden no existe o no pertenece a esta tienda',
        };
      }

      const from = order.state as order_state_enum;
      const base = {
        id,
        order_number: order.order_number,
        current_state: from,
      };

      // Idempotencia: `forceOrderState` hace no-op cuando ya está en destino.
      // Es el caso "seleccioné 100 y 30 ya estaban finalizadas": no es un
      // fallo, simplemente no se toca.
      if (from === dto.targetState) {
        return {
          ...base,
          status: 'skipped' as const,
          code: 'ORD_BULK_ALREADY_IN_STATE',
          message: `Ya está en ${STATE_LABELS[dto.targetState] ?? dto.targetState}`,
        };
      }

      const canonical = (VALID_TRANSITIONS[from] ?? []).includes(
        dto.targetState as order_state_enum,
      );
      if (canonical) {
        return {
          ...base,
          status: 'ok' as const,
          message: `${STATE_LABELS[from] ?? from} → ${STATE_LABELS[dto.targetState] ?? dto.targetState}`,
        };
      }

      // Se APLICARÁ, pero por el carril forzado: el destino no es una arista
      // válida desde el estado actual. Se avisa como warning en vez de error
      // porque el backend sí lo va a ejecutar y auditar como forzada — decir
      // "error" aquí mentiría sobre el resultado.
      return {
        ...base,
        status: 'warning' as const,
        code: 'ORD_BULK_FORCED_TRANSITION',
        message: `Transición forzada: ${STATE_LABELS[from] ?? from} → ${STATE_LABELS[dto.targetState] ?? dto.targetState} no es un paso válido y quedará auditada como forzada`,
      };
    });

    return this.summarize(items);
  }

  // ─── Preview de asignación a ruta (dry-run) ────────────────────────

  /**
   * Dry-run de `bulkAssignRoute`. Replica las cuatro compuertas que
   * `DispatchNotesService.createFromOrder` aplica antes de crear la remisión
   * (`dispatch-notes.service.ts:1985-2020`), en el mismo orden, para que el
   * modal anticipe exactamente los rechazos que produciría la ejecución real:
   *
   * 1. estado debe ser `processing` o `pending_payment`
   * 2. `direct_delivery` no pasa por el ciclo de remisión
   * 3. sin dirección de envío no hay dónde entregar (salvo `pickup`)
   * 4. si todo lo remitible ya se remitió, no hay nada que crear
   *
   * Es una réplica de reglas, no la ejecución: si `createFromOrder` gana una
   * compuerta nueva, este preview se queda corto y hay que actualizarlo — el
   * resultado real sigue siendo la autoridad, y por eso la aplicación real
   * también reporta por orden.
   */
  async previewAssignRoute(
    dto: BulkAssignRouteDto,
  ): Promise<BulkOrdersPreviewResultDto> {
    const orders = (await this.prisma.orders.findMany({
      where: { id: { in: dto.ids } },
      select: {
        id: true,
        order_number: true,
        state: true,
        delivery_type: true,
        shipping_address_snapshot: true,
        shipping_address_id: true,
        order_items: { select: { id: true, quantity: true } },
      },
    })) as PreviewDispatchOrderRow[];
    // `as const` para que el callback devuelva una TUPLA y no `(number | T)[]`:
    // sin él, `new Map` infiere `Map<number | T, number | T>` y el valor que
    // sale de `.get()` pierde la forma de la orden.
    const byId = new Map(orders.map((o) => [o.id, o] as const));

    // Cantidades ya remitidas por ítem, en UNA consulta para todo el lote.
    const notes = await this.prisma.dispatch_notes.findMany({
      where: { order_id: { in: dto.ids }, status: { not: 'voided' } },
      select: {
        order_id: true,
        dispatch_note_items: {
          select: { sales_order_item_id: true, dispatched_quantity: true },
        },
      },
    });
    const dispatchedByItem = new Map<number, number>();
    for (const note of notes) {
      for (const it of note.dispatch_note_items) {
        if (it.sales_order_item_id == null) continue;
        dispatchedByItem.set(
          it.sales_order_item_id,
          (dispatchedByItem.get(it.sales_order_item_id) ?? 0) +
            Number(it.dispatched_quantity ?? 0),
        );
      }
    }

    const items: BulkOrderPreviewItemDto[] = dto.ids.map((id) => {
      const order = byId.get(id);
      if (!order) {
        return {
          id,
          order_number: `#${id}`,
          current_state: 'desconocido',
          status: 'error' as const,
          code: 'ORD_BULK_NOT_FOUND',
          message: 'La orden no existe o no pertenece a esta tienda',
        };
      }

      const base = {
        id,
        order_number: order.order_number,
        current_state: order.state as string,
      };

      if (order.state !== 'processing' && order.state !== 'pending_payment') {
        return {
          ...base,
          status: 'error' as const,
          code: 'DSP_ORDER_STATE_001',
          message: `Solo se remiten órdenes en Procesando o Pago Pendiente (está en ${STATE_LABELS[order.state] ?? order.state})`,
        };
      }

      if (order.delivery_type === 'direct_delivery') {
        return {
          ...base,
          status: 'error' as const,
          code: 'DSP_ORDER_DELIVERY_001',
          message:
            'Entrega directa en mostrador: no pasa por el ciclo de remisión',
        };
      }

      // `pickup` está exento: el cliente retira en tienda, la remisión
      // documenta el handover y no necesita dirección de entrega.
      if (
        order.delivery_type !== 'pickup' &&
        !this.hasShippingAddress(order)
      ) {
        return {
          ...base,
          status: 'error' as const,
          code: 'DISPATCH_NOTE_NO_SHIPPING_ADDRESS',
          message: 'La orden no tiene dirección de envío',
        };
      }

      const pending = order.order_items.reduce((acc, oi) => {
        const already = dispatchedByItem.get(oi.id) ?? 0;
        return acc + Math.max(0, Number(oi.quantity) - already);
      }, 0);
      if (pending <= 0) {
        return {
          ...base,
          status: 'skipped' as const,
          code: 'ORD_BULK_ALREADY_DISPATCHED',
          message: 'Ya tiene remisión por todas sus unidades',
        };
      }

      return {
        ...base,
        status: 'ok' as const,
        message: `Se creará la remisión (${pending} ${pending === 1 ? 'unidad' : 'unidades'} pendientes) y se asignará a la planilla`,
      };
    });

    return this.summarize(items);
  }

  /**
   * ¿La orden tiene a dónde entregar? Acepta el snapshot JSON o la relación
   * poblada, igual que `createFromOrder`. Aquí basta con saber si existe
   * alguno de los dos — construir el snapshot completo es trabajo de la
   * ejecución real, no del preview.
   */
  private hasShippingAddress(order: {
    shipping_address_snapshot: unknown;
    shipping_address_id: number | null;
  }): boolean {
    if (order.shipping_address_id != null) return true;
    const snap = order.shipping_address_snapshot as Record<
      string,
      unknown
    > | null;
    return !!snap && Object.keys(snap).length > 0;
  }

  /** Cuenta las cuatro categorías. Un solo lugar para no descuadrar la cabecera. */
  private summarize(
    items: BulkOrderPreviewItemDto[],
  ): BulkOrdersPreviewResultDto {
    return {
      total: items.length,
      ok: items.filter((i) => i.status === 'ok').length,
      warnings: items.filter((i) => i.status === 'warning').length,
      skipped: items.filter((i) => i.status === 'skipped').length,
      errors: items.filter((i) => i.status === 'error').length,
      items,
    };
  }

  // ─── Assign route ──────────────────────────────────────────────────

  /**
   * Crea remisiones desde cada orden y las asigna como stops a la planilla
   * `route_id` en una sola llamada a `addStops`. El resultado es por orden,
   * tolerante a fallos: si una orden no produce remisión, se reporta como
   * `failed` y las demás siguen.
   */
  async bulkAssignRoute(
    dto: BulkAssignRouteDto,
  ): Promise<BulkOrdersResultDto> {
    const results: BulkOrderResultItemDto[] = [];
    let successful = 0;
    let failed = 0;

    // 1. Crear remisiones en lote reutilizando el seam existente.
    let batchResult;
    try {
      batchResult = await this.dispatchNotesService.createFromOrdersBatch({
        orders: dto.ids,
        target_status: 'confirmed',
      } as any);
    } catch (error: any) {
      // Si el batch entero falla (p. ej. store context ausente), todas las
      // órdenes se reportan como failed con el mismo code/mensaje.
      return {
        total: dto.ids.length,
        successful: 0,
        failed: dto.ids.length,
        results: dto.ids.map((id) => ({
          id,
          status: 'error' as BulkOrderItemStatus,
          code: error?.code ?? 'ORD_BULK_CREATE_NOTES_FAIL',
          message: error?.message ?? 'No se pudieron crear las remisiones',
        })),
      };
    }

    // 2. Mapear el resultado del batch a nuestro contrato por orden.
    const createdNotes: Array<{ order_id: number; dispatch_note_id: number }> =
      [];
    for (const row of batchResult.results ?? []) {
      if (row.status === 'created') {
        createdNotes.push({
          order_id: row.order_id,
          dispatch_note_id: row.dispatch_note_id,
        });
        successful++;
        results.push({
          id: row.order_id,
          status: 'ok',
          message: `Remisión ${row.dispatch_number} creada y asignada a planilla ${dto.route_id}`,
        });
      } else if (row.status === 'skipped') {
        // Idempotente: ya estaba aplicado (batch_key). Lo contamos como ok.
        successful++;
        results.push({
          id: row.order_id,
          status: 'ok',
          message: row.reason ?? 'Remisión ya existía (batch_key aplicado)',
        });
      } else {
        failed++;
        results.push({
          id: row.order_id,
          status: 'error',
          code: row.error_code ?? 'ORD_BULK_CREATE_NOTE_FAIL',
          message: row.message ?? 'No se pudo crear la remisión',
        });
      }
    }

    // 3. Asignar todas las remisiones generadas a la planilla en una sola
    //    llamada. Si falla, las remisiones ya existen (efecto deseado: la
    //    orden está remitida) pero el operador debe agregarlas manualmente a
    //    la planilla. Se marca la fila como ok con advertencia para no
    //    contradecir que la remisión se creó.
    if (createdNotes.length > 0) {
      try {
        await this.dispatchRoutesService.addStops(dto.route_id, {
          stops: createdNotes.map((n) => ({
            dispatch_note_id: n.dispatch_note_id,
          })),
        } as any);
      } catch (error: any) {
        this.logger.warn(
          `bulkAssignRoute: remisiones creadas pero addStops a planilla ${dto.route_id} falló: ${error?.message}`,
        );
        // Las remisiones ya existen (efecto deseado: la orden está remitida),
        // pero NO quedaron en la planilla. Se advierte en cada fila ok para que
        // el operador sepa que debe agregarlas manualmente.
        const okOrderIds = new Set(createdNotes.map((n) => n.order_id));
        for (const r of results) {
          if (r.status === 'ok' && okOrderIds.has(r.id)) {
            r.message =
              (r.message ?? '') +
              ` | ADVERTENCIA: no se pudo asignar a la planilla ${dto.route_id}: ${error?.message ?? 'error desconocido'}`;
          }
        }
      }
    }

    return { total: dto.ids.length, successful, failed, results };
  }

  // ─── Print ─────────────────────────────────────────────────────────

  /**
   * Devuelve las órdenes imprimibles de la selección, hidratadas con
   * exactamente lo que el tiquete POS lee, más el formato de papel de la
   * tienda. **No genera ningún documento**: el render lo hace
   * `PosTicketService` en el frontend.
   *
   * ## Por qué el backend ya no dibuja
   *
   * Dibujar aquí obligaba a mantener un segundo renderer (PDFKit, layout de
   * factura) en paralelo al que ya pinta el tiquete post-venta del POS y la
   * previsualización de Ajustes → Recibos. Dos renderers del mismo documento
   * divergen: el masivo salía sin `receipt_header`/`receipt_footer`, sin
   * `pos_ticket_copies`, con otra tipografía y otro orden de bloques, y encima
   * resolvía el papel con `invoice_format ?? pos_ticket_format` — y como
   * `invoice_format` tiene default `'letter'`, `pos_ticket_format` nunca se
   * aplicaba. Con un solo renderer la paridad deja de ser un convenio.
   *
   * ## Tolerancia por orden (regla de negocio)
   *
   * Una selección de 100 órdenes casi nunca es homogénea: hay canceladas,
   * reembolsadas, e ids que ya no están en la tienda. Que una sola de ellas
   * tumbe el lote entero obliga al operador a depurar la selección a mano
   * antes de poder imprimir nada, que es exactamente lo que la operación
   * masiva viene a evitar.
   *
   * Por eso el método NUNCA falla por una orden: la omite, la reporta, y sigue
   * con el resto. El backend emite dos de los tres carriles de
   * `BulkPrintSkipReason`:
   *
   * 1. `not_found` — el id no volvió del `findMany`. El scope de tienda de
   *    `StorePrismaService` ya excluye lo ajeno, así que esto cubre tanto ids
   *    borrados como ids de otra tienda.
   * 2. `non_printable_state` — `cancelled` / `refunded`. Se descartan antes de
   *    entregarlas: un comprobante de una venta anulada o devuelta induce a
   *    error en mostrador.
   *
   * El tercero (`render_error`) ahora lo reporta el frontend, que es quien
   * dibuja; `summarizeSkipped` sigue sabiendo redactarlo.
   *
   * El único caso que sí es error HTTP es que NO quede ninguna orden
   * imprimible: devolver una lista vacía ahí le miente al operador, que abriría
   * un diálogo de impresión sin páginas y sin explicación.
   *
   * @returns las órdenes a dibujar, el detalle completo de lo omitido y el
   *   formato de papel canónico de la tienda.
   */
  async bulkPrint(dto: BulkPrintOrdersDto): Promise<BulkPrintResultDto> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // 1. Cargar las órdenes con lo que el tiquete POS lee, y solo con eso. Una
    //    sola consulta con includes (no N queries) para hasta 300 órdenes.
    //
    //    Deliberadamente NO se reutiliza el include de `OrdersService.findOne`:
    //    arrastra `product_images` + `signOrderItemImages` (una firma de S3 por
    //    ítem, N round-trips) y `kitchen_ticket_items` / `promotions` /
    //    `installments`, que el tiquete no lee.
    const orders = await this.prisma.orders.findMany({
      where: { id: { in: dto.ids } },
      include: {
        // `include` sobre `order_items` devuelve TODAS sus columnas escalares,
        // que es justo lo que el tiquete necesita: `product_name`,
        // `variant_sku`, `quantity`, `unit_price`, `total_price`,
        // `tax_amount_item`, `stock_units_consumed` y
        // `applied_price_tier_name_snapshot`.
        //
        // Sin join con `products`: el tiquete imprime `product_name`, que es
        // columna de la LÍNEA (el nombre en el momento de vender), no del
        // catálogo actual — que es además lo correcto en un comprobante.
        order_items: {
          orderBy: { id: 'asc' },
          // carril D / lina — D2: filtrar ítems cancelados. La impresión
          // masiva NO debe imprimir líneas canceladas como si fueran
          // cobrables: el operador quiere ver el tiquete con lo que
          // efectivamente se cobró. (El detalle de orden en pantalla
          // sigue mostrando TODAS las líneas, tachadas, vía
          // `order-detail-page` — son dos consumidores distintos, este
          // filtro aplica solo a la impresión del comprobante.)
          where: { cancelled_at: null },
        },
        // El identificador fiscal del cliente en `users` es `document_number`
        // (+ `document_type`), no `tax_id` — `tax_id` solo existe en
        // `organizations` (schema.prisma). `phone` va porque el bloque de
        // cliente del tiquete lo imprime.
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            document_number: true,
          },
        },
        // Solo la dirección de ENVÍO. La de facturación la consumía el layout
        // de factura de PDFKit, que ya no existe.
        addresses_orders_shipping_address_idToaddresses: true,
        // Sin este include el tiquete perdía las filas "Efectivo recibido" /
        // "Cambio" y el método de pago: el frontend hace
        // `payments.find(p => p.state === 'succeeded')` y de ahí lee
        // `gateway_response.metadata.amount_received` y `.change`.
        //
        // El filtro por `succeeded` va en la consulta y no en memoria para no
        // mandarle al cliente los intentos de pago fallidos de la orden.
        //
        // `store_payment_method` va porque el NOMBRE del método de pago no está
        // en `gateway_response`. El frontend lo lee de
        // `gateway_response.metadata.payment_method`, pero NADIE escribe esa
        // clave: el escritor del cobro POS
        // (`payments.service.ts:3387`) guarda `metadata` con `register_id`,
        // `seller_user_id`, `amount_received` e `is_pos_payment`, y el método
        // viaja como FK en `store_payment_method_id`. Verificado en dev contra
        // 5 órdenes: `metadata.payment_method` es `undefined` en todas. Sin
        // esta relación el tiquete seguiría imprimiendo `Método de pago: N/A`
        // aunque el include de `payments` esté puesto.
        payments: {
          where: { state: 'succeeded' },
          select: {
            id: true,
            state: true,
            gateway_response: true,
            created_at: true,
            store_payment_method: {
              select: {
                display_name: true,
                system_payment_method: {
                  select: { name: true, display_name: true },
                },
              },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        // Solo la factura ACEPTADA por la DIAN, y solo la última.
        //
        // El filtro es `accepted` y no `pending` porque el pie del tiquete
        // afirma literalmente "validada por la DIAN": con `pending`,
        // `rejected` o `error` esa afirmación sería falsa. La AUSENCIA de fila
        // es entonces la señal correcta para que el frontend imprima el
        // desglose de IVA y el pie de "este documento no es una factura
        // electrónica".
        // `dian_status` viaja aunque el `where` ya lo fije a `accepted`: el
        // mapper del tiquete (`OrderTicketService.toTicketData`) también sirve
        // al detalle de orden, cuyo `findOne` NO pre-filtra, así que decide la
        // aceptación leyendo la columna. Mandarla aquí —redundante para esta
        // consulta— es lo que le permite exigirla en vez de tratar su ausencia
        // como "aceptada", que sería afirmar validación DIAN por defecto.
        invoices: {
          where: { dian_status: 'accepted' },
          select: { invoice_number: true, cufe: true, dian_status: true },
          orderBy: { id: 'desc' },
          take: 1,
        },
        // `id` + `name`, nada más. El emisor (razón social, NIT, dirección) y
        // el logo los resuelve `PosTicketService.generateTicketHTML` por su
        // cuenta desde el snapshot de `vendix_auth_state`, así que repetir aquí
        // organización, direcciones y `store_settings` sería payload muerto ×N
        // — y `store_settings.settings` lleva `fiscal_data` completo, que no
        // tiene por qué viajar 300 veces al navegador para imprimir tiquetes.
        stores: { select: { id: true, name: true } },
      },
    });

    // 2. Repartir la selección entre imprimibles y omitidas.
    const { printable, skipped } = this.partitionPrintable(
      dto.ids,
      orders as any[],
    );

    if (printable.length === 0) {
      // Ninguna orden imprimible. Devolver una lista vacía sería un fallo
      // silencioso: el operador abriría un diálogo de impresión sin páginas y
      // sin saber por qué.
      throw new VendixHttpException(
        ErrorCodes.ORD_BULK_PRINT_001,
        this.summarizeSkipped(dto.ids.length, skipped),
      );
    }

    // 3. Formato de papel y copias: de la DB, una vez por lote (son de la
    //    tienda, no de la orden), y en una consulta aparte en vez de un include
    //    en `stores`. El lote NO puede mezclar tiendas — `orders` es un modelo
    //    store-scoped y la extensión de Prisma inyecta `store_id` en el `where`,
    //    así que un id ajeno cae en `not_found` —, luego un solo formato es
    //    correcto para todo el documento.
    const { pos_ticket_format, pos_ticket_copies } =
      await this.resolvePosTicketSettings(store_id);

    return {
      total: dto.ids.length,
      printable: printable.length,
      orders: printable,
      skipped,
      pos_ticket_format,
      pos_ticket_copies,
    };
  }

  /**
   * Reparte los ids pedidos entre las órdenes a imprimir y las omitidas, **en
   * el orden en que el cliente mandó los ids**: `findMany` no garantiza
   * ninguno y el operador espera el taco de tiquetes en el orden en que
   * seleccionó.
   *
   * Genérico en la forma de la fila porque los includes varían según para qué
   * se lea el lote; solo exige lo que la clasificación necesita (`id` para el
   * mapa, `order_number` + `state` para redactar el motivo). Así un `select`
   * más pequeño o más grande sigue sirviendo sin castear.
   *
   * El chequeo de "no quedó nada imprimible" NO vive aquí: es una decisión del
   * llamador (unos querrán 400, otros una lista vacía legítima).
   */
  private partitionPrintable<
    T extends { id: number; order_number: string; state: any },
  >(
    ids: number[],
    orders: T[],
  ): { printable: T[]; skipped: BulkPrintSkippedOrderDto[] } {
    const byId = new Map<number, T>(orders.map((o) => [o.id, o]));
    const skipped: BulkPrintSkippedOrderDto[] = [];
    const printable: T[] = [];

    for (const id of ids) {
      const order = byId.get(id);
      if (!order) {
        skipped.push({
          id,
          reason: 'not_found',
          message: `La orden #${id} no existe o no pertenece a esta tienda`,
        });
        continue;
      }
      if (NON_PRINTABLE_ORDER_STATES.has(order.state)) {
        skipped.push({
          id,
          order_number: order.order_number,
          reason: 'non_printable_state',
          message: `${order.order_number}: ${STATE_LABELS[order.state] ?? order.state} — no se imprime`,
        });
        continue;
      }
      printable.push(order);
    }

    return { printable, skipped };
  }

  /**
   * Resumen legible de por qué no quedó nada que imprimir. Agrupa por motivo en
   * vez de listar 100 ids: el operador necesita saber "todas estaban
   * canceladas", no la enumeración.
   */
  private summarizeSkipped(
    total: number,
    skipped: BulkPrintSkippedOrderDto[],
  ): string {
    const counts = skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {});

    const parts: string[] = [];
    if (counts.non_printable_state) {
      parts.push(`${counts.non_printable_state} canceladas o reembolsadas`);
    }
    if (counts.not_found) {
      parts.push(`${counts.not_found} no encontradas en esta tienda`);
    }
    if (counts.render_error) {
      parts.push(`${counts.render_error} con datos que impiden imprimir`);
    }

    return parts.length > 0
      ? `Ninguna de las ${total} órdenes seleccionadas se puede imprimir: ${parts.join(', ')}.`
      : `Ninguna de las ${total} órdenes seleccionadas se puede imprimir.`;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Formato de papel y número de copias del tiquete POS, leídos de la DB.
   *
   * Lee ÚNICAMENTE `receipts.pos_ticket_format`, con fallback `thermal_80` (el
   * mismo default que `getPersistableDefaultStoreSettings`). El código anterior
   * hacía `invoice_format ?? pos_ticket_format` y su comentario declaraba la
   * intención opuesta a lo que ejecutaba: `invoice_format` tiene default
   * `'letter'`, así que SIEMPRE existe y siempre ganaba — `pos_ticket_format`
   * nunca se aplicaba. Aquí no hay cascada porque no hay ambigüedad: lo que se
   * imprime es el tiquete POS, luego el setting que manda es el del tiquete POS.
   *
   * Ambos valores viajan al frontend porque allí se leerían del snapshot de
   * `vendix_auth_state`, que solo se rehidrata al re-loguear: un comerciante que
   * acaba de cambiar formato o copias imprimiría con los valores viejos hasta
   * cerrar sesión. Devolverlos aquí los hace canónicos para esta impresión.
   *
   * `copies` se acota a [1, 5]: `pos_ticket_copies` admite 0 en settings con el
   * significado "no imprimir automáticamente tras la venta", pero quien pulsa
   * "Imprimir" pidió papel explícitamente, así que 0 copias sería obedecer el
   * setting equivocado. El techo de 5 es el mismo del DTO de settings.
   *
   * Se consulta `store_settings` aparte en vez de incluirlo en `stores`: son un
   * par de valores por lote y el include repetiría el JSON completo de settings
   * (con `fiscal_data` dentro) una vez por orden, en una respuesta que puede
   * llevar 300.
   */
  private async resolvePosTicketSettings(
    store_id: number,
  ): Promise<{ pos_ticket_format: PrintFormat; pos_ticket_copies: number }> {
    const row = await this.prisma.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });
    const receipts = (row?.settings as any)?.receipts;

    const format = receipts?.pos_ticket_format;
    const raw_copies = Number(receipts?.pos_ticket_copies);

    return {
      pos_ticket_format: PRINT_FORMATS.includes(format as PrintFormat)
        ? (format as PrintFormat)
        : 'thermal_80',
      pos_ticket_copies: Number.isFinite(raw_copies)
        ? Math.min(5, Math.max(1, Math.trunc(raw_copies)))
        : 1,
    };
  }
}
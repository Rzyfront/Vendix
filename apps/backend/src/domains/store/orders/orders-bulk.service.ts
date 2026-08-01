import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { S3Service } from '@common/services/s3.service';
import { OrderFlowService } from './order-flow/order-flow.service';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { DispatchRoutesService } from '../dispatch-routes/dispatch-routes.service';
import { SettingsService } from '../settings/settings.service';
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
} from './dto/bulk-orders.dto';
import {
  OrderPdfBuilder,
  OrderPdfData,
  OrderPdfItem,
} from './orders-pdf.builder';

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
 * 3. `bulkPrint` — genera un PDF multi-página con `OrderPdfBuilder`, una
 *    página por orden, respetando `store_settings.receipts.invoice_format` (o
 *    `pos_ticket_format`). El emisor se resuelve desde `fiscal_data` del scope
 *    que posee la habilitación (igual que `InvoicePdfService.resolveIssuer`).
 *
 * El tope de 100 ids por lote lo impone el DTO (`@ArrayMaxSize`); el service no
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
    private readonly settingsService: SettingsService,
    private readonly s3Service: S3Service,
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
   * Genera un PDF multi-página con todas las órdenes seleccionadas. El
   * formato de papel se resuelve desde `store_settings.receipts` (la tienda,
   * no el cliente). Devuelve un Buffer listo para mandar como
   * `application/pdf`.
   */
  async bulkPrint(dto: BulkPrintOrdersDto): Promise<Buffer> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // 1. Cargar las órdenes con todo lo que el builder necesita. Una sola
    //    consulta con includes (no N queries) para 100 órdenes.
    const orders = await this.prisma.orders.findMany({
      where: { id: { in: dto.ids } },
      include: {
        // `applied_price_tier_id` / `applied_price_tier_name_snapshot` viven en
        // `order_items` (schema.prisma:1181-1182), NO en `products`: son el
        // snapshot de la tarifa aplicada a ESA línea, no un atributo del
        // producto. Pedirlos en el select de `products` era el 400 de Prisma
        // ("Unknown field applied_price_tier_id ... on model products").
        //
        // No hace falta listarlos: `include` sobre `order_items` ya devuelve
        // todas sus columnas escalares. De `products` solo se necesita el
        // nombre, como fallback cuando la línea no trae `product_name`.
        order_items: {
          include: {
            products: { select: { name: true } },
          },
        },
        // El identificador fiscal del cliente en `users` es `document_number`
        // (+ `document_type`), no `tax_id` — `tax_id` solo existe en
        // `organizations` (schema.prisma). Es el mismo campo que selecciona
        // `DispatchNotesService.createFromOrder`.
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            document_number: true,
          },
        },
        addresses_orders_billing_address_idToaddresses: true,
        addresses_orders_shipping_address_idToaddresses: true,
        stores: {
          select: {
            id: true,
            name: true,
            legal_name: true,
            logo_url: true,
            addresses: {
              orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
              take: 1,
            },
            store_settings: { select: { settings: true } },
            // La relación en `stores` se llama `organizations`, en PLURAL
            // (schema.prisma:39) aunque sea a-uno. El schema es snake_case y
            // nombra las relaciones por el modelo destino, no por cardinalidad.
            organizations: {
              select: {
                id: true,
                name: true,
                legal_name: true,
                tax_id: true,
                phone: true,
                email: true,
                logo_url: true,
                fiscal_scope: true,
                addresses: { take: 1 },
                organization_settings: { select: { settings: true } },
              },
            },
          },
        },
      },
    });

    if (orders.length === 0) {
      // Sin órdenes válidas: devolver un PDF vacío para que el controller
      // siempre tenga un Buffer.
      return OrderPdfBuilder.generate([], 'letter');
    }

    // 2. Resolver emisor + formato UNA vez (son de la tienda, no de la orden).
    const store = orders[0].stores as any;
    const org = store?.organizations;
    const issuer = await this.resolveIssuer(org, store);
    const format = this.resolvePrintFormat(store);

    // Logo opcional: descargar una sola vez (la tienda es la misma para todas).
    let logoBuffer: Buffer | undefined;
    if (issuer.logo_url) {
      try {
        logoBuffer = await this.s3Service.downloadImage(issuer.logo_url);
      } catch {
        this.logger.warn(
          'bulkPrint: no se pudo descargar el logo del emisor; se omite',
        );
      }
    }

    // 3. Mapear cada orden a OrderPdfData.
    const pdfData: OrderPdfData[] = orders.map((order: any) => {
      const customer = order.users;
      // `orders` no tiene columna `customer_name` — la venta anónima simplemente
      // no trae `users`, así que el fallback es la etiqueta directa.
      const customerName = customer
        ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
          'Consumidor Final'
        : 'Consumidor Final';

      const items: OrderPdfItem[] = (order.order_items ?? []).map((it: any) => ({
        description:
          it.product_name ||
          it.products?.name ||
          `Producto #${it.product_id ?? '?'}`,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        total_amount: Number(it.total_price),
        // La columna de `order_items` es `applied_price_tier_name_snapshot`;
        // `applied_price_tier_name` (sin sufijo) solo existe en `invoice_items`
        // (schema.prisma:4902), que es de donde viene el nombre del campo en la
        // interfaz del builder. Leer el nombre equivocado no rompía nada: dejaba
        // la tarifa en `null` en TODAS las líneas y el PDF salía sin la línea
        // "Tarifa: …" — un fallo silencioso, no un error.
        applied_price_tier_name: it.applied_price_tier_name_snapshot ?? null,
      }));

      return {
        company_name: issuer.legal_name,
        company_nit: issuer.nit,
        company_address: issuer.address_line,
        company_phone: issuer.phone,
        company_email: issuer.email,
        company_logo_buffer: logoBuffer,
        company_trade_name: issuer.trade_name,
        company_tax_regime: issuer.tax_regime,
        company_tax_responsibilities: issuer.tax_responsibilities,
        order_number: order.order_number,
        order_state: String(order.state),
        issue_date: this.formatDate(order.created_at),
        channel: order.channel,
        currency: order.currency ?? undefined,
        notes: order.notes || undefined,
        customer_name: customerName,
        customer_tax_id: customer?.document_number || undefined,
        customer_address: this.formatAddress(
          order.addresses_orders_billing_address_idToaddresses,
        ),
        customer_email: customer?.email || undefined,
        items,
        subtotal_amount: Number(order.subtotal_amount ?? 0),
        discount_amount: Number(order.discount_amount ?? 0),
        tax_amount: Number(order.tax_amount ?? 0),
        shipping_cost: Number(order.shipping_cost ?? 0),
        total_amount: Number(order.grand_total ?? order.total_amount ?? 0),
        format,
      };
    });

    // 4. Aplicar `copies` si vino en el DTO (sobreescribe invoice_copies /
    //    pos_ticket_copies para esta impresión puntual). El builder no repite
    //    páginas por copia: el frontend/navegador se encarga de mandar N
    //    copias al diálogo de impresión. Aquí solo generamos el documento
    //    base de una vez por orden.
    return OrderPdfBuilder.generate(pdfData, format);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Emisor legal. Réplica del `resolveIssuer` de `InvoicePdfService`: prefiere
   * el `fiscal_data` del scope que posee la habilitación (store bajo
   * `fiscal_scope = STORE`, organización si no) y solo cae al row de
   * organización. La identidad impresa no puede diferir de la firmada.
   */
  private async resolveIssuer(org: any, store: any) {
    const scope: string = org?.fiscal_scope ?? 'STORE';
    const scoped_settings =
      scope === 'STORE'
        ? store?.store_settings?.settings
        : org?.organization_settings?.settings;
    const fiscal = ((scoped_settings as any)?.fiscal_data ?? {}) as {
      nit?: string;
      nit_dv?: string;
      legal_name?: string;
      tax_regime?: string;
      tax_responsibilities?: string[];
      fiscal_address?: string;
      city?: string;
      department?: string;
    };

    const owner = scope === 'STORE' ? store : org;
    const address = owner?.addresses?.[0] ?? org?.addresses?.[0];

    const address_line =
      [address?.address_line1, address?.city, address?.state_province]
        .filter(Boolean)
        .join(', ') ||
      [fiscal.fiscal_address, fiscal.city, fiscal.department]
        .filter(Boolean)
        .join(', ') ||
      undefined;

    const nit_base = fiscal.nit || org?.tax_id || store?.legal_name;
    const nit = nit_base
      ? fiscal.nit_dv
        ? `${nit_base}-${fiscal.nit_dv}`
        : nit_base
      : 'N/A';

    const TAX_REGIME_LABELS: Record<string, string> = {
      COMUN: 'Responsable de IVA',
      SIMPLIFICADO: 'No responsable de IVA',
      SIMPLE: 'Regimen Simple de Tributacion (RST)',
      GRAN_CONTRIBUYENTE: 'Gran contribuyente',
      NO_RESPONSABLE: 'No responsable de IVA',
    };
    const regime_key = (fiscal.tax_regime || '').toUpperCase();

    return {
      legal_name:
        fiscal.legal_name || owner?.legal_name || org?.name || 'N/A',
      nit,
      trade_name: owner?.name || undefined,
      address_line,
      phone: address?.phone_number || org?.phone || undefined,
      email: org?.email || undefined,
      logo_url: store?.logo_url || org?.logo_url || undefined,
      tax_regime:
        TAX_REGIME_LABELS[regime_key] || fiscal.tax_regime || undefined,
      tax_responsibilities: Array.isArray(fiscal.tax_responsibilities)
        ? fiscal.tax_responsibilities
        : undefined,
    };
  }

  /**
   * Formato de papel para el PDF. Siempre el setting de la tienda; cae a
   * `letter` (histórico). Prioriza `pos_ticket_format` si la tienda no tiene
   * `invoice_format` configurado (POS receipts), igual que el POS.
   */
  private resolvePrintFormat(store: any): PrintFormat {
    const receipts = (store?.store_settings?.settings as any)?.receipts;
    const format: PrintFormat | undefined =
      receipts?.invoice_format ?? receipts?.pos_ticket_format;
    return PRINT_FORMATS.includes(format as PrintFormat)
      ? (format as PrintFormat)
      : 'letter';
  }

  /** Formatea una fecha como DD/MM/YYYY. */
  private formatDate(date: Date | string): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /** Extrae una dirección imprimible del JSON de addresses. */
  private formatAddress(address: any): string | undefined {
    if (!address) return undefined;
    if (typeof address === 'string') return address;
    if (typeof address === 'object') {
      const parts: string[] = [];
      if (address.address_line1) parts.push(address.address_line1);
      if (address.address_line2) parts.push(address.address_line2);
      if (address.city) parts.push(address.city);
      if (address.state_province) parts.push(address.state_province);
      if (address.country) parts.push(address.country);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    return undefined;
  }
}
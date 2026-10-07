import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import {
  OrdersService,
  SORTABLE_COLUMNS,
} from '../../../domains/store/orders/orders.service';
import { OrderQueryDto } from '../../../domains/store/orders/dto/order-query.dto';
import { CreateOrderDto } from '../../../domains/store/orders/dto/create-order.dto';
import { UpdateOrderItemsDto } from '../../../domains/store/orders/dto/update-order-items.dto';
import {
  PayOrderDto,
  PaymentType,
} from '../../../domains/store/orders/order-flow/dto/pay-order.dto';
import { ShipOrderDto } from '../../../domains/store/orders/order-flow/dto/ship-order.dto';
import { CancelOrderDto } from '../../../domains/store/orders/order-flow/dto/cancel-order.dto';
import { CreateRefundDto } from '../../../domains/store/orders/order-flow/dto/create-refund.dto';
import { DeliverOrderDto } from '../../../domains/store/orders/order-flow/dto/deliver-order.dto';
import {
  FINISHABLE_STATES,
  OrderFlowService,
} from '../../../domains/store/orders/order-flow/order-flow.service';
import { RefundFlowService } from '../../../domains/store/orders/order-flow/services/refund-flow.service';
import { OrdersBulkService } from '../../../domains/store/orders/orders-bulk.service';
import {
  BULK_ORDER_TRANSITION_TARGETS,
  BulkTransitionOrdersDto,
  MAX_BULK_ORDERS_IDS,
} from '../../../domains/store/orders/dto/bulk-orders.dto';
import {
  InsufficientStockItem,
  StockValidatorService,
} from '../../../domains/store/inventory/shared/services/stock-validator.service';
import {
  compactOrder,
  customerName,
  summarizeItems,
  toStockLines,
} from '../_adapters/order.adapter';
import { DispatchNotesService } from '../../../domains/store/dispatch-notes/dispatch-notes.service';
import { SessionsService } from '../../../domains/store/cash-registers/sessions/sessions.service';
import { order_channel_enum, order_state_enum } from '@prisma/client';

export interface OrdersToolDeps {
  ordersService: OrdersService;
  dispatchNotesService: DispatchNotesService;
  sessionsService: SessionsService;
  orderFlowService: OrderFlowService;
  refundFlowService: RefundFlowService;
  stockValidatorService: StockValidatorService;
  ordersBulkService: OrdersBulkService;
}

// Derivados de los enums Prisma generados — nunca copias a mano: si el schema
// gana un estado (como `pending_delivery`), el filtro lo acepta solo.
const ORDER_STATES: readonly order_state_enum[] =
  Object.values(order_state_enum);
const ORDER_CHANNELS: readonly order_channel_enum[] = Object.values(
  order_channel_enum,
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Máximo de renglones que se serializan en get_order antes de truncar. */
const MAX_DETAIL_ITEMS = 30;

function num(value: any): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

/** Las cantidades remisionadas son Decimal(12,4): no las redondees a 2. */
function qty(value: any): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: any, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}



/**
 * Valida contra la lista permitida y devuelve el valor ya tipado: el
 * genérico propaga el tipo del enum Prisma (o de `SORTABLE_COLUMNS`), así el
 * llamante arma el `OrderQueryDto` sin casts.
 */
function validateEnum<const T extends string>(
  value: any,
  allowed: readonly T[],
  field: string,
): T | undefined | { error: string } {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = String(value);
  const match = allowed.find((option) => option === parsed);
  if (match === undefined) {
    return {
      error: `${field} "${parsed}" no existe. Valores válidos: ${allowed.join(', ')}.`,
    };
  }
  return match;
}

function isError(value: any): value is { error: string } {
  return !!value && typeof value === 'object' && 'error' in value;
}

// ─── Writes O-19..O-26: validación, stock y reembolsos ──────────────────────

/** Métodos aceptados por `CreateRefundDto` (`@IsIn` en create-refund.dto.ts). */
const REFUND_METHODS = [
  'original_payment',
  'cash',
  'bank_transfer',
  'store_credit',
] as const;

/** `inventory_action` por renglón (`@IsIn` en CreateRefundItemDto). */
const REFUND_INVENTORY_ACTIONS = ['restock', 'write_off', 'no_return'] as const;

/** Tipos de renglón (`@IsIn` en CreateOrderItemDto). */
const ORDER_ITEM_TYPES = ['product', 'custom', 'physical', 'service'] as const;

const PAYMENT_TYPES: readonly string[] = Object.values(PaymentType);

/** Tolerancia al comparar el techo del preview contra el vigente. */
const REFUND_CEILING_TOLERANCE = 0.01;

/**
 * Estados que nunca aceptan cobro ni cancelación. Todo lo demás lo decide el
 * service dueño al ejecutar; el preview no duplica su máquina de estados.
 */
const TERMINAL_ORDER_STATES = ['cancelled', 'refunded', 'finished'] as const;

/** O-23: acciones de entrega (espejo de los endpoints del flow). */
const DELIVER_ACTIONS = ['deliver', 'deliver_item', 'confirm_delivery'] as const;

/**
 * O-23: estados desde los que `confirmDelivery` cierra la orden. Se importan
 * (`FINISHABLE_STATES`, única fuente en `order-flow.service.ts`), NO se
 * espejan: el preview anticipa el rechazo sin prometer un cierre imposible y
 * sin desincronizarse cuando el dueño abra una arista nueva.
 */

/** O-27: máximo de eventos del timeline que se serializan. */
const MAX_TIMELINE_EVENTS = 50;

/** O-28: cuántas filas del preview masivo viajan en el diff. */
const MAX_BULK_PREVIEW_ROWS = 10;

/**
 * Valida un DTO como el `ValidationPipe` global del HTTP (`whitelist` +
 * `forbidNonWhitelisted`). Mismo helper que `writes.tools.ts`: las tools
 * llaman a los servicios directo, sin pasar por el pipe.
 */
function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

/** Traduce una excepción del dominio a texto narrable (doctrina `{error, next_step}`). */
function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    const message =
      typeof response === 'string'
        ? response
        : (response?.message ?? error.message);
    return { code: error.errorCode, message };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    if (typeof response === 'string') return { message: response };
    const raw = response?.message;
    return {
      message: Array.isArray(raw) ? raw.join('; ') : String(raw ?? error.message),
    };
  }
  return { message: (error as any)?.message ?? 'error desconocido' };
}

function isStockShortage(code?: string): boolean {
  return !!code && code.includes('INV_STOCK');
}

/**
 * Normaliza un renglón del agente al `CreateOrderItemDto` plano: exige nombre,
 * cantidad y precio, y calcula `total_price` cuando no viene. Los errores de
 * tipo (product_id, item_type, tax_rate) los caza el DTO ya validado.
 */
function normalizeOrderItem(
  raw: any,
  index: number,
): Record<string, unknown> | { error: string } {
  const label = `Renglón ${index + 1}`;
  if (!raw || typeof raw !== 'object') {
    return {
      error: `${label}: debe ser un objeto con product_name, quantity y unit_price.`,
    };
  }
  const name = String(raw.product_name ?? '').trim();
  if (!name) {
    return {
      error: `${label}: falta product_name, el nombre del producto tal como lo verá el cliente.`,
    };
  }
  const quantity = Number(raw.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return {
      error: `${label} ("${name}"): quantity debe ser un entero mayor que 0.`,
    };
  }
  const unitPrice = Number(raw.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return {
      error: `${label} ("${name}"): unit_price debe ser un número mayor o igual a 0.`,
    };
  }
  const total =
    raw.total_price === undefined || raw.total_price === null
      ? Math.round(quantity * unitPrice * 100) / 100
      : Number(raw.total_price);
  if (!Number.isFinite(total) || total < 0) {
    return { error: `${label} ("${name}"): total_price inválido.` };
  }
  return {
    ...(raw.product_id !== undefined &&
      raw.product_id !== null && { product_id: Number(raw.product_id) }),
    ...(raw.product_variant_id !== undefined &&
      raw.product_variant_id !== null && {
        product_variant_id: Number(raw.product_variant_id),
      }),
    ...(raw.item_type !== undefined &&
      raw.item_type !== null && { item_type: String(raw.item_type) }),
    product_name: name,
    quantity,
    unit_price: unitPrice,
    total_price: total,
    ...(raw.tax_rate !== undefined &&
      raw.tax_rate !== null && { tax_rate: Number(raw.tax_rate) }),
    ...(raw.description ? { description: String(raw.description) } : {}),
    ...(raw.variant_sku ? { variant_sku: String(raw.variant_sku) } : {}),
    ...(raw.variant_attributes
      ? { variant_attributes: String(raw.variant_attributes) }
      : {}),
  };
}

function formatShortfalls(short: InsufficientStockItem[]): string {
  return short
    .map(
      (item) =>
        `${item.product_name}: pide ${item.requested}, hay ${item.available} disponibles`,
    )
    .join('; ');
}

/**
 * Disponibilidad de métodos de reembolso con las reglas documentadas en
 * `RefundMethodsService.getAvailableMethods` (ese servicio no lo exporta
 * `OrderFlowModule`, pero el `findOne` ya trae pagos y cliente, que es todo
 * lo que las reglas miran). La cuenta bancaria destino se elige al aplicar.
 */
function resolveRefundMethodAvailability(order: any): Array<{
  value: string;
  label: string;
  available: boolean;
  reason_unavailable?: string;
}> {
  const activePayments = (order.payments ?? []).filter((payment: any) =>
    ['succeeded', 'pending', 'partially_refunded'].includes(payment.state),
  );
  const hasPayments = activePayments.length > 0;
  const hasCustomer = !!order.customer_id;
  return [
    {
      value: 'original_payment',
      label: 'Pago original',
      available: hasPayments,
      ...(hasPayments
        ? {}
        : { reason_unavailable: 'La orden no tiene pagos registrados' }),
    },
    { value: 'cash', label: 'Efectivo', available: true },
    { value: 'bank_transfer', label: 'Transferencia', available: true },
    {
      value: 'store_credit',
      label: 'Billetera del cliente',
      available: hasCustomer,
      ...(hasCustomer
        ? {}
        : {
            reason_unavailable:
              'La orden no tiene un cliente asociado para recibir el saldo a favor',
          }),
    },
  ];
}

function methodAvailabilityError(
  order: any,
  method: string,
): { error: string; next_step: string } | null {
  const option = resolveRefundMethodAvailability(order).find(
    (candidate) => candidate.value === method,
  );
  if (option && !option.available) {
    return {
      error: `El método "${method}" no está disponible para esta orden: ${option.reason_unavailable ?? 'no aplica'}.`,
      next_step:
        'Llama preview_refund para ver los métodos disponibles y elige uno de ellos.',
    };
  }
  return null;
}

export function createOrdersTools(deps: OrdersToolDeps): RegisteredTool[] {
  const {
    ordersService,
    dispatchNotesService,
    sessionsService,
    orderFlowService,
    refundFlowService,
    stockValidatorService,
    ordersBulkService,
  } = deps;

  const noStore = (what: string) =>
    JSON.stringify({
      error: `Sin tienda en contexto: ${what} está acotado por tienda.`,
    });

  return [
    // ─── find_order ──────────────────────────────────────────────────
    {
      name: 'find_order',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'Localiza una orden a partir de lo que el usuario dice en voz alta: un número de orden ("la ORD2608030012"), un fragmento de ese número ("la que termina en 12"), o el nombre / correo del cliente ("el pedido de Marcela Ríos"). Es el PRIMER paso de cualquier flujo sobre una orden concreta: devuelve el order_id que get_order y get_dispatch_status necesitan. Si vuelve más de una candidata, muéstrale las opciones al usuario en vez de adivinar. Para listar órdenes por filtros (estado, fecha, canal) y no por nombre, usa list_orders.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Número de orden, fragmento del número, nombre del cliente o su correo. No acepta descripciones libres del pedido.',
          },
          state: {
            type: 'string',
            enum: ORDER_STATES,
            description:
              'Restringe la búsqueda a un estado. Útil para desempatar cuando un cliente tiene varias órdenes.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de candidatas. Por defecto 5, máximo 20.',
          },
        },
        required: ['query'],
      },
      requiredPermissions: ['store:orders:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la búsqueda de órdenes');

        const search = String(args.query ?? '').trim();
        if (!search) {
          return JSON.stringify({
            error:
              'query vacío. Pásale el número de orden o el nombre del cliente.',
          });
        }

        const state = validateEnum(args.state, ORDER_STATES, 'state');
        if (isError(state)) return JSON.stringify(state);

        const limit = clamp(args.limit, 5, 20);

        try {
          const query: OrderQueryDto = {
            page: 1,
            limit,
            search,
            ...(state && { status: state }),
          };
          const result = await ordersService.findAll(query);

          const candidatas = result.data.map((o: any) => compactOrder(o));

          // "La orden 412" suele ser el id interno, que `search` no mira: solo
          // compara contra order_number y contra los datos del cliente. Sin este
          // rescate el flujo se corta justo en el paso de entrada.
          if (/^\d+$/.test(search)) {
            const byId =
              await ordersService.findOrderByIdForAgent(Number(search));
            if (byId && !candidatas.some((c) => c.order_id === byId.id)) {
              candidatas.unshift(compactOrder(byId));
            }
          }

          if (!candidatas.length) {
            return JSON.stringify({
              busqueda: search,
              encontradas: 0,
              candidatas: [],
              nota: 'Ninguna orden coincide. La búsqueda cubre el número de orden y el nombre/correo del cliente registrado; las órdenes de invitado no se encuentran por nombre. Prueba con el número de orden o usa list_orders con un rango de fechas.',
            });
          }

          return JSON.stringify({
            busqueda: search,
            encontradas: candidatas.length,
            total_coincidencias: result.pagination.total,
            hay_mas: result.pagination.total > candidatas.length,
            resolucion:
              candidatas.length === 1
                ? 'Coincidencia única: puedes usar su order_id directamente.'
                : 'Varias coincidencias: confirma con el usuario cuál antes de actuar.',
            candidatas,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo buscar la orden: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── list_orders ─────────────────────────────────────────────────
    {
      name: 'list_orders',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'Lista órdenes de la tienda filtradas por estado, canal, cliente o rango de fechas, con paginación. Úsala para "¿qué órdenes tengo pendientes?", "muéstrame las ventas de ayer", "¿qué falta por despachar?" o "las compras de este cliente". Devuelve filas compactas: para el detalle completo de una de ellas llama después a get_order con su order_id. Si el usuario nombra a un cliente o un número de orden, find_order es más directa.',
      parameters: {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            enum: ORDER_STATES,
            description: 'Filtra por estado de la orden.',
          },
          channel: {
            type: 'string',
            enum: ORDER_CHANNELS,
            description: 'Filtra por canal de venta.',
          },
          customer_id: {
            type: 'number',
            description:
              'Órdenes de un cliente concreto. Obtén el id con find_customer o find_order.',
          },
          search: {
            type: 'string',
            description:
              'Texto libre contra número de orden y nombre/correo del cliente.',
          },
          date_from: {
            type: 'string',
            description:
              'Inicio del rango YYYY-MM-DD. Debe acompañarse de date_to; por sí solo se ignora.',
          },
          date_to: {
            type: 'string',
            description:
              'Fin del rango YYYY-MM-DD. Debe acompañarse de date_from; por sí solo se ignora.',
          },
          dispatchable: {
            type: 'boolean',
            description:
              'Solo lo que está pendiente de despachar: órdenes en processing o pending_payment, con entrega a domicilio o recogida, y aún no remisionadas del todo. Es el filtro "Por enviar".',
          },
          missing_shipping_method: {
            type: 'boolean',
            description:
              'Solo órdenes vivas que necesitan envío pero todavía no tienen método de envío asignado.',
          },
          page: {
            type: 'number',
            description: 'Página, empezando en 1. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Filas por página. Por defecto 10, máximo 50.',
          },
          sort_by: {
            type: 'string',
            enum: SORTABLE_COLUMNS,
            description: 'Columna de ordenamiento. Por defecto created_at.',
          },
          sort_order: {
            type: 'string',
            enum: ['asc', 'desc'],
            description: 'Dirección del orden. Por defecto desc.',
          },
        },
      },
      requiredPermissions: ['store:orders:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el listado de órdenes');

        const state = validateEnum(args.state, ORDER_STATES, 'state');
        if (isError(state)) return JSON.stringify(state);

        const channel = validateEnum(args.channel, ORDER_CHANNELS, 'channel');
        if (isError(channel)) return JSON.stringify(channel);

        const sortBy = validateEnum(args.sort_by, SORTABLE_COLUMNS, 'sort_by');
        if (isError(sortBy)) return JSON.stringify(sortBy);

        const from = args.date_from ? String(args.date_from) : undefined;
        const to = args.date_to ? String(args.date_to) : undefined;
        if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
          return JSON.stringify({
            error: `Las fechas deben venir en formato YYYY-MM-DD. Recibido: date_from="${from ?? ''}", date_to="${to ?? ''}".`,
          });
        }
        if (from && to && from > to) {
          return JSON.stringify({
            error: `El rango está invertido: date_from (${from}) es posterior a date_to (${to}).`,
          });
        }

        const page = clamp(args.page, 1, 1000);
        const limit = clamp(args.limit, 10, 50);

        try {
          const query: OrderQueryDto = {
            page,
            limit,
            ...(state && { status: state }),
            ...(channel && { channel }),
            ...(args.customer_id && { customer_id: Number(args.customer_id) }),
            ...(args.search && { search: String(args.search) }),
            ...(from && to && { date_from: from, date_to: to }),
            ...(args.dispatchable === true && { dispatchable: true }),
            ...(args.missing_shipping_method === true && {
              missing_shipping_method: true,
            }),
            ...(sortBy && {
              sort_by: sortBy,
              sort_order: args.sort_order === 'asc' ? 'asc' : 'desc',
            }),
          };
          const result = await ordersService.findAll(query);

          const data = result.data.map((o: any) => compactOrder(o));
          const { total, totalPages } = result.pagination;

          return JSON.stringify({
            paginacion: {
              total_ordenes: total,
              pagina: page,
              por_pagina: limit,
              total_paginas: totalPages,
              hay_mas: page < totalPages,
            },
            mostrando: data.length,
            ...(page < totalPages && {
              nota: `Se muestran ${data.length} de ${total} órdenes. Pide la página ${page + 1} si necesitas más, pero resume en vez de enumerar todo.`,
            }),
            ...(from && !to && {
              aviso:
                'date_from sin date_to se ignora: el filtro de fechas exige ambos extremos.',
            }),
            ...(to && !from && {
              aviso:
                'date_to sin date_from se ignora: el filtro de fechas exige ambos extremos.',
            }),
            data,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudieron listar las órdenes: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── get_order ───────────────────────────────────────────────────
    {
      name: 'get_order',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'Detalle completo de UNA orden: renglones con cantidades y precios, totales desglosados (subtotal, descuento, impuesto, envío, propina), pagos aplicados y saldo pendiente, cliente, dirección de envío, método de envío y factura electrónica si ya se emitió. Úsala cuando el usuario pregunte "¿qué traía ese pedido?", "¿ya está pagado?", "¿cuánto debe?" o para responder cualquier duda sobre una orden concreta. Requiere el order_id: si solo tienes el número o el nombre del cliente, llama antes a find_order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden, tal como lo devuelve find_order o list_orders. No es el número de orden visible.',
          },
        },
        required: ['order_id'],
      },
      requiredPermissions: ['store:orders:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el detalle de una orden');

        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          });
        }

        try {
          const order: any = await ordersService.findOne(orderId);

          const items = (order.order_items ?? []).slice(0, MAX_DETAIL_ITEMS);
          const truncated = (order.order_items?.length ?? 0) - items.length;

          const shipping =
            order.addresses_orders_shipping_address_idToaddresses ??
            order.shipping_address_snapshot ??
            null;

          return JSON.stringify({
            orden: {
              order_id: order.id,
              numero: order.order_number,
              estado: order.state,
              canal: order.channel,
              tipo_entrega: order.delivery_type,
              cumplimiento_despacho: order.dispatch_fulfillment,
              moneda: order.currency ?? null,
              creada: order.created_at,
              confirmada: order.placed_at,
              completada: order.completed_at,
              notas_cliente: order.notes ?? null,
              notas_internas: order.internal_notes ?? null,
            },
            cliente: {
              customer_id: order.customer_id ?? null,
              nombre: customerName(order),
              email: order.users?.email ?? null,
              telefono: order.users?.phone ?? null,
            },
            totales: {
              subtotal: num(order.subtotal_amount),
              descuento: num(order.discount_amount),
              impuestos: num(order.tax_amount),
              envio: num(order.shipping_cost),
              propina: num(order.tip_amount),
              total: num(order.grand_total),
              pagado: num(order.total_paid),
              saldo_pendiente: num(order.remaining_balance),
            },
            items: items.map((i: any) => ({
              product_id: i.product_id ?? null,
              producto: i.product_name,
              variante: i.variant_attributes ?? null,
              sku: i.variant_sku ?? i.products?.sku ?? null,
              cantidad: i.quantity,
              precio_unitario: num(i.unit_price),
              total_linea: num(i.total_price),
            })),
            ...(truncated > 0 && {
              items_omitidos: truncated,
              items_nota: `La orden tiene ${order.order_items.length} renglones; se muestran los primeros ${MAX_DETAIL_ITEMS}. Dile al usuario que hay más en vez de afirmar que estos son todos.`,
            }),
            pagos: (order.payments ?? []).map((p: any) => ({
              payment_id: p.id,
              metodo:
                p.store_payment_method?.system_payment_method?.name ??
                p.store_payment_method?.name ??
                p.payment_method ??
                null,
              monto: num(p.amount),
              estado: p.state,
              fecha: p.created_at,
            })),
            envio: {
              metodo: order.shipping_method?.name ?? null,
              tipo: order.shipping_method?.type ?? null,
              zona: order.shipping_rate?.shipping_zone?.display_name ?? null,
              direccion: shipping
                ? {
                    linea: shipping.address_line1 ?? shipping.address_line_1 ?? null,
                    ciudad: shipping.city ?? null,
                    departamento: shipping.state ?? shipping.department ?? null,
                    pais: shipping.country ?? null,
                  }
                : null,
            },
            factura_electronica: order.invoices?.[0]
              ? {
                  numero: order.invoices[0].invoice_number,
                  cufe: order.invoices[0].cufe,
                  nota: 'Factura ACEPTADA por la DIAN.',
                }
              : null,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se encontró la orden ${orderId} en esta tienda, o no se pudo leer: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── get_cash_session_status ─────────────────────────────────────
    {
      name: 'get_cash_session_status',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'Estado de la caja registradora: si hay una sesión abierta, quién la abrió, con cuánto base, y el arqueo esperado en el momento (ventas del turno por método de pago, entradas y salidas de efectivo, devoluciones y el efectivo que debería haber en el cajón). Úsala para "¿está abierta la caja?", "¿cuánto llevamos hoy en caja?", "¿cuánto efectivo debería tener?" o antes de que el usuario intente cobrar y se tope con que no hay turno abierto. El efectivo esperado que devuelve es la cifra autoritativa del cierre: no la recalcules.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['me', 'store'],
            description:
              'me (por defecto) mira solo la sesión del usuario actual; store mira todas las sesiones abiertas de la tienda, sin importar quién las abrió.',
          },
          session_id: {
            type: 'number',
            description:
              'Consulta una sesión concreta, incluso ya cerrada. Ignora scope.',
          },
        },
      },
      requiredPermissions: ['store:cash_registers:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el estado de caja');

        const scope = args.scope === 'store' ? 'store' : 'me';

        const summarize = async (sessionId: number) => {
          const s = await sessionsService.getCashSummary(sessionId);
          return {
            base_apertura: num(s.opening),
            ventas_totales: num(s.sales_total),
            ventas_cantidad: s.sales_count,
            ventas_por_metodo: s.sales_by_method.map((m) => ({
              metodo: m.method,
              cantidad: m.count,
              total: num(m.total),
            })),
            ventas_en_efectivo: num(s.cash_sales),
            entradas_efectivo: num(s.cash_in),
            salidas_efectivo: num(s.cash_out),
            devoluciones_efectivo: num(s.cash_refunds),
            efectivo_esperado: num(s.expected_cash_total),
            no_efectivo: num(s.non_cash_total),
          };
        };

        const describeSession = (s: any) => ({
          session_id: s.id,
          caja: s.register?.name ?? `Caja #${s.cash_register_id}`,
          cash_register_id: s.cash_register_id,
          estado: s.status,
          abierta_por: s.opened_by_user
            ? [s.opened_by_user.first_name, s.opened_by_user.last_name]
                .filter(Boolean)
                .join(' ')
            : null,
          abierta_en: s.opened_at,
          cerrada_en: s.closed_at ?? null,
          base_apertura: num(s.opening_amount),
        });

        try {
          if (args.session_id !== undefined && args.session_id !== null) {
            const sessionId = Number(args.session_id);
            if (!Number.isFinite(sessionId) || sessionId < 1) {
              return JSON.stringify({
                error: `session_id inválido: "${args.session_id}".`,
              });
            }
            const session: any = await sessionsService.findOne(sessionId);
            return JSON.stringify({
              alcance: 'sesión específica',
              sesion: describeSession(session),
              movimientos_registrados: session.movements?.length ?? 0,
              arqueo: await summarize(sessionId),
            });
          }

          if (scope === 'store') {
            const abiertas = await sessionsService.findAll({
              status: 'open',
              page: 1,
              limit: 10,
            });

            if (!abiertas.data.length) {
              return JSON.stringify({
                alcance: 'tienda',
                hay_caja_abierta: false,
                sesiones_abiertas: 0,
                nota: 'Ninguna caja de la tienda tiene turno abierto. Cualquier cobro por POS exigirá abrir caja primero.',
              });
            }

            const sesiones = abiertas.data.map((s: any) => describeSession(s));

            return JSON.stringify({
              alcance: 'tienda',
              hay_caja_abierta: true,
              sesiones_abiertas: abiertas.meta.total,
              mostrando: sesiones.length,
              sesiones,
              // Con una sola sesión abierta la pregunta "¿cuánto hay en caja?"
              // tiene una respuesta inequívoca; con varias hay que preguntar.
              ...(sesiones.length === 1
                ? { arqueo: await summarize(sesiones[0].session_id) }
                : {
                    nota: 'Hay más de una caja abierta. Pídele al usuario cuál le interesa y vuelve a llamar con session_id para ver su arqueo.',
                  }),
            });
          }

          const activa: any = await sessionsService.getActiveSession(
            context.user_id,
          );

          if (!activa) {
            const enTienda = await sessionsService.countOpenSessions();
            return JSON.stringify({
              alcance: 'usuario actual',
              hay_caja_abierta: false,
              nota: 'El usuario no tiene ningún turno de caja abierto a su nombre.',
              otras_cajas_abiertas_en_tienda: enTienda.count,
              ...(enTienda.count > 0 && {
                cajas: enTienda.registers,
                sugerencia:
                  'Otro operador sí tiene caja abierta. Usa scope="store" si la pregunta era por la tienda y no por el usuario.',
              }),
            });
          }

          return JSON.stringify({
            alcance: 'usuario actual',
            hay_caja_abierta: true,
            sesion: describeSession(activa),
            arqueo: await summarize(activa.id),
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo leer el estado de caja: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── get_dispatch_status ─────────────────────────────────────────
    {
      name: 'get_dispatch_status',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'En qué va el despacho de una orden: qué remisiones se le generaron, en qué estado está cada una (borrador, confirmada, entregada, facturada) y, renglón por renglón, cuántas unidades ya salieron y cuántas siguen pendientes. Úsala para "¿ya se despachó ese pedido?", "¿qué falta por enviar?" o "¿cuándo se entregó?". Las remisiones anuladas no cuentan. Requiere el order_id — obténlo con find_order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden, tal como lo devuelve find_order o list_orders.',
          },
        },
        required: ['order_id'],
      },
      requiredPermissions: ['store:dispatch_notes:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el estado de despacho');

        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          });
        }

        try {
          const order = await ordersService.findDispatchStatusForAgent(orderId);

          if (!order) {
            return JSON.stringify({
              error: `No existe la orden ${orderId} en esta tienda.`,
            });
          }

          const notas = await dispatchNotesService.getByOrder(orderId);

          // Unidades ya remisionadas por renglón de la orden.
          const despachadoPorItem = new Map<number, number>();
          for (const nota of notas as any[]) {
            for (const item of nota.dispatch_note_items ?? []) {
              if (item.sales_order_item_id === null || item.sales_order_item_id === undefined) {
                continue;
              }
              despachadoPorItem.set(
                item.sales_order_item_id,
                (despachadoPorItem.get(item.sales_order_item_id) ?? 0) +
                  qty(item.dispatched_quantity),
              );
            }
          }

          const renglones = order.order_items.map((i) => {
            const despachadas = despachadoPorItem.get(i.id) ?? 0;
            return {
              producto: i.product_name,
              pedidas: i.quantity,
              remisionadas: despachadas,
              pendientes: Math.max(i.quantity - despachadas, 0),
            };
          });

          const pedidas = renglones.reduce((a, r) => a + r.pedidas, 0);
          const remisionadas = renglones.reduce((a, r) => a + r.remisionadas, 0);
          const pendientes = renglones.filter((r) => r.pendientes > 0);

          return JSON.stringify({
            orden: {
              order_id: order.id,
              numero: order.order_number,
              estado: order.state,
              tipo_entrega: order.delivery_type,
              creada: order.created_at,
            },
            cumplimiento: order.dispatch_fulfillment,
            cumplimiento_nota:
              'none = sin remisionar, partial = remisionada a medias, full = totalmente remisionada.',
            unidades: {
              pedidas,
              remisionadas,
              pendientes: Math.max(pedidas - remisionadas, 0),
            },
            remisiones: (notas as any[]).map((n) => ({
              dispatch_note_id: n.id,
              numero: n.dispatch_number,
              estado: n.status,
              emitida: n.emission_date,
              entregada: n.delivered_at ?? n.actual_delivery_date ?? null,
              renglones: n.dispatch_note_items?.length ?? 0,
            })),
            remisiones_nota:
              notas.length === 0
                ? 'La orden no tiene ninguna remisión viva. Si el tipo de entrega es direct_delivery o dine_in, es lo normal: se entrega en sitio y nunca genera remisión.'
                : 'Las remisiones anuladas quedan excluidas: no consumen unidades pendientes.',
            renglones_pendientes: pendientes.slice(0, 20),
            ...(pendientes.length > 20 && {
              renglones_pendientes_omitidos: pendientes.length - 20,
            }),
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo leer el estado de despacho: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── O-19 create_order ─────────────────────────────────────────────
    {
      name: 'create_order',
      version: '1',
      domain: 'orders',
      description:
        'Crea una orden de venta con sus renglones. Antes de proponerla consulta check_stock_availability (o get_product) para confirmar existencias: por defecto la tienda NO permite sobreventa y la creación se rechaza si falta stock. Los renglones reemplazan nada: es una orden nueva. Si el usuario nombra un cliente, resuelve su customer_id con find_customer; sin cliente la orden queda como venta de mostrador.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'number',
            description:
              'Cliente dueño de la orden. Obténlo con find_customer. Opcional.',
          },
          customer_alias: {
            type: 'string',
            description:
              'Nombre libre del comprador cuando no es un cliente registrado.',
          },
          channel: {
            type: 'string',
            enum: ORDER_CHANNELS,
            description: 'Canal de venta. Por defecto el que use el servicio.',
          },
          delivery_type: {
            type: 'string',
            description:
              'Tipo de entrega (delivery, pickup, direct_delivery, dine_in). Opcional.',
          },
          notes: {
            type: 'string',
            description: 'Notas del cliente para la orden. Opcional.',
          },
          items: {
            type: 'array',
            minItems: 1,
            description:
              'Renglones de la orden, mínimo 1. En productos con variantes incluye product_variant_id.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                item_type: { type: 'string', enum: ORDER_ITEM_TYPES },
                product_name: {
                  type: 'string',
                  description: 'Nombre del producto tal como lo verá el cliente.',
                },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                total_price: {
                  type: 'number',
                  description:
                    'Opcional: si no viene se calcula quantity × unit_price.',
                },
                tax_rate: {
                  type: 'number',
                  description:
                    'Tasa como FRACCIÓN: 0.19 es 19%. Opcional.',
                },
                description: { type: 'string' },
                variant_sku: { type: 'string' },
                variant_attributes: { type: 'string' },
              },
              required: ['product_name', 'quantity', 'unit_price'],
            },
          },
        },
        required: ['items'],
      },
      requiredPermissions: ['store:orders:create'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        const target = 'Nueva orden';
        if (!context.store_id) {
          return {
            status: 'error',
            target,
            changes: [],
            message: 'Sin tienda en contexto: la creación de órdenes está acotada por tienda.',
          };
        }
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return {
            status: 'error',
            target,
            changes: [],
            message: 'La orden necesita al menos 1 renglón en items.',
          };
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const item = normalizeOrderItem(rawItems[index], index);
          if (isError(item)) {
            return { status: 'error', target, changes: [], message: item.error };
          }
          normalized.push(item);
        }
        const subtotal =
          Math.round(
            normalized.reduce(
              (sum, item) => sum + Number(item.total_price ?? 0),
              0,
            ) * 100,
          ) / 100;
        const validated = toValidatedDto(CreateOrderDto, {
          ...(args.customer_id !== undefined &&
            args.customer_id !== null && {
              customer_id: Number(args.customer_id),
            }),
          ...(args.customer_alias ? { customer_alias: String(args.customer_alias) } : {}),
          ...(args.channel ? { channel: String(args.channel) } : {}),
          ...(args.delivery_type
            ? { delivery_type: String(args.delivery_type) }
            : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          subtotal,
          // La tool no acepta impuestos/envío/descuento propios: el total
          // parte del subtotal y el service recalcula lo suyo.
          total_amount: subtotal,
          items: normalized,
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target,
            changes: [],
            message: validated.message,
          };
        }
        let short: InsufficientStockItem[] = [];
        try {
          short = await stockValidatorService.findInsufficientLines(
            toStockLines(normalized),
            { kind: 'product' },
          );
        } catch (error: any) {
          return {
            status: 'error',
            target,
            changes: [],
            message: `No se pudo validar el stock: ${describeError(error).message}`,
          };
        }
        if (short.length) {
          return {
            status: 'error',
            target: `Nueva orden: ${summarizeItems(normalized)}`,
            changes: [],
            message:
              `Sin stock suficiente y la tienda no permite sobreventa: ${formatShortfalls(short)}. ` +
              'Ajusta las cantidades o consulta check_stock_availability para ver el disponible real.',
          };
        }
        return {
          status: 'ok',
          target: `Nueva orden: ${summarizeItems(normalized)}`,
          changes: [
            {
              field: 'items',
              label: 'Renglones',
              from: null,
              to: summarizeItems(normalized),
            },
            { field: 'subtotal', label: 'Subtotal', from: null, to: subtotal },
            {
              field: 'cliente',
              label: 'Cliente',
              from: null,
              to:
                args.customer_id ??
                args.customer_alias ??
                'Mostrador (sin cliente)',
            },
            ...(args.channel
              ? [
                  {
                    field: 'canal',
                    label: 'Canal',
                    from: null,
                    to: String(args.channel),
                  },
                ]
              : []),
          ],
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la creación de órdenes');
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return JSON.stringify({
            error: 'La orden necesita al menos 1 renglón en items.',
            next_step: 'Pasa items con product_name, quantity y unit_price.',
          });
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const item = normalizeOrderItem(rawItems[index], index);
          if (isError(item)) {
            return JSON.stringify({
              error: item.error,
              next_step: 'Corrige el renglón y vuelve a proponer la orden.',
            });
          }
          normalized.push(item);
        }
        const subtotal =
          Math.round(
            normalized.reduce(
              (sum, item) => sum + Number(item.total_price ?? 0),
              0,
            ) * 100,
          ) / 100;
        const validated = toValidatedDto(CreateOrderDto, {
          ...(args.customer_id !== undefined &&
            args.customer_id !== null && {
              customer_id: Number(args.customer_id),
            }),
          ...(args.customer_alias ? { customer_alias: String(args.customer_alias) } : {}),
          ...(args.channel ? { channel: String(args.channel) } : {}),
          ...(args.delivery_type
            ? { delivery_type: String(args.delivery_type) }
            : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          subtotal,
          // La tool no acepta impuestos/envío/descuento propios: el total
          // parte del subtotal y el service recalcula lo suyo.
          total_amount: subtotal,
          items: normalized,
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer la orden.',
          });
        }
        try {
          const short = await stockValidatorService.findInsufficientLines(
            toStockLines(normalized),
            { kind: 'product' },
          );
          if (short.length) {
            return JSON.stringify({
              error: `Sin stock suficiente: ${formatShortfalls(short)}.`,
              next_step:
                'Ajusta las cantidades al disponible real (check_stock_availability) o pide al dueño activar la sobreventa en ajustes de inventario.',
            });
          }
          const created: any = await ordersService.create(validated.dto, {
            id: context.user_id,
          });
          return JSON.stringify({
            orden_creada: {
              order_id: created.id,
              numero: created.order_number,
              estado: created.state,
              total: num(created.grand_total ?? subtotal),
            },
            next_step:
              'La orden quedó creada con stock reservado. Usa pay_order para cobrarla.',
          });
        } catch (error: any) {
          const info = describeError(error);
          if (isStockShortage(info.code)) {
            const fresh = await stockValidatorService
              .findInsufficientLines(toStockLines(normalized), {
                kind: 'product',
              })
              .catch(() => [] as InsufficientStockItem[]);
            return JSON.stringify({
              error: `Sin stock suficiente: ${fresh.length ? formatShortfalls(fresh) : info.message}.`,
              next_step:
                'Ajusta las cantidades al disponible real (check_stock_availability) o pide al dueño activar la sobreventa en ajustes de inventario.',
            });
          }
          return JSON.stringify({
            error: `No se pudo crear la orden: ${info.message}`,
            next_step:
              'Revisa los datos con get_product/find_customer y vuelve a intentarlo.',
          });
        }
      },
    },

    // ─── O-20 manage_order_items ───────────────────────────────────────
    {
      name: 'manage_order_items',
      version: '1',
      domain: 'orders',
      description:
        'Reemplaza la lista COMPLETA de renglones de una orden en estado created o draft: lo que pases en items es lo que queda, lo demás se quita. Lee primero el detalle con get_order para partir de la lista actual. Valida stock sin sobreventa y exige product_variant_id en productos con variantes.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          items: {
            type: 'array',
            minItems: 1,
            description:
              'Lista COMPLETA de renglones que debe tener la orden al final. Mismo formato que create_order.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                item_type: { type: 'string', enum: ORDER_ITEM_TYPES },
                product_name: { type: 'string' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                total_price: { type: 'number' },
                tax_rate: { type: 'number' },
                description: { type: 'string' },
                variant_sku: { type: 'string' },
                variant_attributes: { type: 'string' },
              },
              required: ['product_name', 'quantity', 'unit_price'],
            },
          },
        },
        required: ['order_id', 'items'],
      },
      requiredPermissions: ['store:orders:update'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Editar renglones',
            changes: [],
            message: 'Sin tienda en contexto: las órdenes están acotadas por tienda.',
          };
        }
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return {
            status: 'error',
            target: 'Editar renglones',
            changes: [],
            message: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          };
        }
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return {
            status: 'error',
            target: 'Editar renglones',
            changes: [],
            message: 'La orden necesita al menos 1 renglón en items.',
          };
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const item = normalizeOrderItem(rawItems[index], index);
          if (isError(item)) {
            return {
              status: 'error',
              target: 'Editar renglones',
              changes: [],
              message: item.error,
            };
          }
          normalized.push(item);
        }
        const validated = toValidatedDto(UpdateOrderItemsDto, {
          items: normalized,
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Editar renglones',
            changes: [],
            message: validated.message,
          };
        }
        let order: any;
        try {
          order = await ordersService.findOne(orderId);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Editar renglones',
            changes: [],
            message: `No se encontró la orden ${orderId} en esta tienda: ${describeError(error).message}`,
          };
        }
        if (order.state !== 'created' && order.state !== 'draft') {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message: `La orden está en estado '${order.state}': los renglones solo se editan en 'created' o 'draft'.`,
          };
        }
        let short: InsufficientStockItem[] = [];
        try {
          short = await stockValidatorService.findInsufficientLines(
            toStockLines(normalized),
            { kind: 'product', orderId },
          );
        } catch (error: any) {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message: `No se pudo validar el stock: ${describeError(error).message}`,
          };
        }
        if (short.length) {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message:
              `Sin stock suficiente y la tienda no permite sobreventa: ${formatShortfalls(short)}. ` +
              'Ajusta las cantidades o consulta check_stock_availability.',
          };
        }
        return {
          status: 'ok',
          target: `Orden ${order.order_number} de ${customerName(order)}: ${summarizeItems(normalized)}`,
          changes: [
            {
              field: 'items',
              label: 'Renglones (la lista se reemplaza completa)',
              from: summarizeItems(order.order_items ?? []),
              to: summarizeItems(normalized),
            },
          ],
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la edición de renglones');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return JSON.stringify({
            error: 'La orden necesita al menos 1 renglón en items.',
            next_step: 'Pasa la lista completa de renglones que debe tener la orden.',
          });
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const item = normalizeOrderItem(rawItems[index], index);
          if (isError(item)) {
            return JSON.stringify({
              error: item.error,
              next_step: 'Corrige el renglón y vuelve a proponer el cambio.',
            });
          }
          normalized.push(item);
        }
        const validated = toValidatedDto(UpdateOrderItemsDto, {
          items: normalized,
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer el cambio.',
          });
        }
        try {
          const short = await stockValidatorService.findInsufficientLines(
            toStockLines(normalized),
            { kind: 'product', orderId },
          );
          if (short.length) {
            return JSON.stringify({
              error: `Sin stock suficiente: ${formatShortfalls(short)}.`,
              next_step:
                'Ajusta las cantidades al disponible real (check_stock_availability) o pide al dueño activar la sobreventa.',
            });
          }
          const updated: any = await ordersService.updateOrderItems(
            orderId,
            validated.dto,
          );
          return JSON.stringify({
            orden_actualizada: {
              order_id: updated?.id ?? orderId,
              numero: updated?.order_number ?? null,
              estado: updated?.state ?? null,
              total: num(updated?.grand_total),
            },
            nota: 'La lista de renglones se reemplazó completa y las reservas de stock se ajustaron.',
          });
        } catch (error: any) {
          const info = describeError(error);
          if (isStockShortage(info.code)) {
            const fresh = await stockValidatorService
              .findInsufficientLines(toStockLines(normalized), {
                kind: 'product',
                orderId,
              })
              .catch(() => [] as InsufficientStockItem[]);
            return JSON.stringify({
              error: `Sin stock suficiente: ${fresh.length ? formatShortfalls(fresh) : info.message}.`,
              next_step:
                'Ajusta las cantidades al disponible real (check_stock_availability) o pide al dueño activar la sobreventa.',
            });
          }
          return JSON.stringify({
            error: `No se pudieron editar los renglones: ${info.message}`,
            next_step:
              'Lee la orden con get_order para ver su estado actual y vuelve a intentarlo.',
          });
        }
      },
    },

    // ─── O-21 pay_order ────────────────────────────────────────────────
    {
      name: 'pay_order',
      version: '1',
      domain: 'orders',
      description:
        'Cobra una orden (registra el pago y la mueve a processing). Lee primero get_order para conocer el saldo pendiente y get_cash_session_status para confirmar que hay caja abierta. El cobro también valida stock: sin existencias se bloquea salvo que la tienda permita sobreventa.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          store_payment_method_id: {
            type: 'number',
            description:
              'Método de pago de la tienda (el mismo id del checkout/POS).',
          },
          payment_type: {
            type: 'string',
            enum: PAYMENT_TYPES,
            description: 'direct (presencial) u online. Por defecto direct.',
          },
          amount: {
            type: 'number',
            description:
              'Monto a cobrar. Si es menor que el saldo queda como pago parcial; si no viene se cobra el saldo total.',
          },
          amount_received: {
            type: 'number',
            description:
              'Efectivo recibido (para calcular el vuelto). Solo en efectivo.',
          },
          payment_reference: {
            type: 'string',
            description: 'Referencia del pago (voucher, aprobación). Opcional.',
          },
        },
        required: ['order_id', 'store_payment_method_id'],
      },
      requiredPermissions: ['store:orders:order_flow:create'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Cobrar orden',
            changes: [],
            message: 'Sin tienda en contexto: los cobros están acotados por tienda.',
          };
        }
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return {
            status: 'error',
            target: 'Cobrar orden',
            changes: [],
            message: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          };
        }
        const validated = toValidatedDto(PayOrderDto, {
          ...(args.store_payment_method_id !== undefined && {
            store_payment_method_id: Number(args.store_payment_method_id),
          }),
          payment_type: String(args.payment_type ?? 'direct'),
          ...(args.amount !== undefined &&
            args.amount !== null && { amount: Number(args.amount) }),
          ...(args.amount_received !== undefined &&
            args.amount_received !== null && {
              amount_received: Number(args.amount_received),
            }),
          ...(args.payment_reference
            ? { payment_reference: String(args.payment_reference) }
            : {}),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Cobrar orden',
            changes: [],
            message: validated.message,
          };
        }
        let order: any;
        try {
          order = await ordersService.findOne(orderId);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Cobrar orden',
            changes: [],
            message: `No se encontró la orden ${orderId} en esta tienda: ${describeError(error).message}`,
          };
        }
        if ((TERMINAL_ORDER_STATES as readonly string[]).includes(order.state)) {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message: `La orden está en estado '${order.state}': ya no acepta cobros.`,
          };
        }
        let cashWarning: string | null = null;
        try {
          const active = await sessionsService.getActiveSession(
            context.user_id,
          );
          if (!active) {
            cashWarning =
              'El usuario no tiene turno de caja abierto a su nombre; si la tienda exige caja para cobrar, habrá que abrir caja primero (ver get_cash_session_status).';
          }
        } catch {
          cashWarning = null;
        }
        const balance = num(order.remaining_balance);
        return {
          status: cashWarning ? 'warning' : 'ok',
          target: `Cobrar orden ${order.order_number} de ${customerName(order)}`,
          changes: [
            {
              field: 'saldo',
              label: 'Saldo pendiente',
              from: balance,
              to: Math.max(
                balance - num(validated.dto.amount ?? balance),
                0,
              ),
            },
            {
              field: 'metodo',
              label: 'Método de pago',
              from: null,
              to: `Método #${validated.dto.store_payment_method_id} (${validated.dto.payment_type})`,
            },
          ],
          ...(cashWarning ? { message: cashWarning } : {}),
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el cobro de órdenes');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const validated = toValidatedDto(PayOrderDto, {
          ...(args.store_payment_method_id !== undefined && {
            store_payment_method_id: Number(args.store_payment_method_id),
          }),
          payment_type: String(args.payment_type ?? 'direct'),
          ...(args.amount !== undefined &&
            args.amount !== null && { amount: Number(args.amount) }),
          ...(args.amount_received !== undefined &&
            args.amount_received !== null && {
              amount_received: Number(args.amount_received),
            }),
          ...(args.payment_reference
            ? { payment_reference: String(args.payment_reference) }
            : {}),
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer el cobro.',
          });
        }
        try {
          const fresh: any = await ordersService.findOne(orderId);
          if (
            (TERMINAL_ORDER_STATES as readonly string[]).includes(fresh.state)
          ) {
            return JSON.stringify({
              error: `La orden cambió a estado '${fresh.state}' y ya no acepta cobros.`,
              next_step: 'Lee la orden con get_order para ver su estado actual.',
            });
          }
          await orderFlowService.payOrder(orderId, validated.dto);
          const paid: any = await ordersService.findOne(orderId);
          return JSON.stringify({
            cobro: {
              order_id: orderId,
              numero: paid.order_number,
              estado: paid.state,
              total: num(paid.grand_total),
              pagado: num(paid.total_paid),
              saldo_pendiente: num(paid.remaining_balance),
            },
            next_step:
              Number(paid.remaining_balance ?? 0) > 0
                ? 'Quedó un saldo pendiente: es un pago parcial.'
                : 'La orden quedó totalmente pagada. Usa ship_order para despacharla si es a domicilio.',
          });
        } catch (error: any) {
          const info = describeError(error);
          if (isStockShortage(info.code)) {
            return JSON.stringify({
              error: `El cobro se bloqueó por falta de stock: ${info.message}.`,
              next_step:
                'Revisa el disponible con check_stock_availability; el cobro exige stock salvo sobreventa explícita en ajustes.',
            });
          }
          return JSON.stringify({
            error: `No se pudo cobrar la orden: ${info.message}`,
            next_step:
              'Verifica el estado con get_order y la caja con get_cash_session_status, y reintenta.',
          });
        }
      },
    },

    // ─── O-22 ship_order ───────────────────────────────────────────────
    {
      name: 'ship_order',
      version: '1',
      domain: 'orders',
      description:
        'Despacha una orden en processing (la mueve a shipped y consume las reservas de stock). Lee primero get_order y get_dispatch_status: la orden debe estar pagada/en processing y, si es a domicilio, necesita método de envío asignado.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          tracking_number: {
            type: 'string',
            description: 'Número de guía del transportador. Opcional.',
          },
          carrier: {
            type: 'string',
            description: 'Transportadora. Opcional.',
          },
          notes: { type: 'string', description: 'Notas del despacho. Opcional.' },
          shipping_method_id: {
            type: 'number',
            description:
              'Método de envío a asignar si la orden aún no tiene uno.',
          },
          shipping_rate_id: {
            type: 'number',
            description: 'Tarifa de envío. Opcional.',
          },
        },
        required: ['order_id'],
      },
      requiredPermissions: ['store:orders:order_flow:create'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Despachar orden',
            changes: [],
            message: 'Sin tienda en contexto: los despachos están acotados por tienda.',
          };
        }
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return {
            status: 'error',
            target: 'Despachar orden',
            changes: [],
            message: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          };
        }
        const validated = toValidatedDto(ShipOrderDto, {
          ...(args.tracking_number
            ? { tracking_number: String(args.tracking_number) }
            : {}),
          ...(args.carrier ? { carrier: String(args.carrier) } : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          ...(args.shipping_method_id !== undefined &&
            args.shipping_method_id !== null && {
              shipping_method_id: Number(args.shipping_method_id),
            }),
          ...(args.shipping_rate_id !== undefined &&
            args.shipping_rate_id !== null && {
              shipping_rate_id: Number(args.shipping_rate_id),
            }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Despachar orden',
            changes: [],
            message: validated.message,
          };
        }
        let order: any;
        try {
          order = await ordersService.findOne(orderId);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Despachar orden',
            changes: [],
            message: `No se encontró la orden ${orderId} en esta tienda: ${describeError(error).message}`,
          };
        }
        if (order.state !== 'processing') {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message: `La orden está en estado '${order.state}': solo se despacha desde 'processing' (la orden debe estar cobrada primero).`,
          };
        }
        const needsMethod =
          !order.shipping_method_id &&
          !validated.dto.shipping_method_id &&
          order.delivery_type !== 'direct_delivery';
        return {
          status: needsMethod ? 'warning' : 'ok',
          target: `Despachar orden ${order.order_number} de ${customerName(order)}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: 'processing',
              to: 'shipped',
            },
            ...(args.tracking_number
              ? [
                  {
                    field: 'guia',
                    label: 'Guía',
                    from: null,
                    to: String(args.tracking_number),
                  },
                ]
              : []),
          ],
          ...(needsMethod
            ? {
                message:
                  'La orden necesita despacho y no tiene método de envío asignado: el despacho será rechazado salvo que pases shipping_method_id.',
              }
            : {}),
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el despacho de órdenes');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const validated = toValidatedDto(ShipOrderDto, {
          ...(args.tracking_number
            ? { tracking_number: String(args.tracking_number) }
            : {}),
          ...(args.carrier ? { carrier: String(args.carrier) } : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          ...(args.shipping_method_id !== undefined &&
            args.shipping_method_id !== null && {
              shipping_method_id: Number(args.shipping_method_id),
            }),
          ...(args.shipping_rate_id !== undefined &&
            args.shipping_rate_id !== null && {
              shipping_rate_id: Number(args.shipping_rate_id),
            }),
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer el despacho.',
          });
        }
        try {
          const fresh: any = await ordersService.findOne(orderId);
          if (fresh.state !== 'processing') {
            return JSON.stringify({
              error: `La orden cambió a estado '${fresh.state}': solo se despacha desde 'processing'.`,
              next_step: 'Lee la orden con get_order para ver su estado actual.',
            });
          }
          await orderFlowService.shipOrder(orderId, validated.dto);
          const shipped: any = await ordersService.findOne(orderId);
          return JSON.stringify({
            despacho: {
              order_id: orderId,
              numero: shipped.order_number,
              estado: shipped.state,
            },
            nota: 'La orden quedó despachada y sus reservas de stock se consumieron.',
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo despachar la orden: ${info.message}`,
            next_step:
              'Verifica con get_order/get_dispatch_status (estado, método de envío, cocina lista) y reintenta.',
          });
        }
      },
    },

    // ─── O-24 cancel_order ─────────────────────────────────────────────
    {
      name: 'cancel_order',
      version: '1',
      domain: 'orders',
      description:
        'Cancela una orden viva: libera sus reservas de stock (restaura el disponible sin tocar el físico) y revierte el dinero según lo pagado. Lee primero get_order para ver estado, pagos y renglones. El motivo es obligatorio.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          reason: {
            type: 'string',
            description:
              'Motivo de la cancelación, mínimo 3 caracteres. Obligatorio.',
          },
          kitchenDisposition: {
            type: 'string',
            enum: ['reuse', 'waste'],
            description:
              'Qué hacer con lo que ya salió de cocina: reuse (reutilizar) o waste (desechar). Solo restaurante.',
          },
        },
        required: ['order_id', 'reason'],
      },
      requiredPermissions: ['store:orders:order_flow:create'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Cancelar orden',
            changes: [],
            message: 'Sin tienda en contexto: las órdenes están acotadas por tienda.',
          };
        }
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return {
            status: 'error',
            target: 'Cancelar orden',
            changes: [],
            message: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          };
        }
        const validated = toValidatedDto(CancelOrderDto, {
          ...(args.reason ? { reason: String(args.reason) } : {}),
          ...(args.kitchenDisposition
            ? { kitchenDisposition: String(args.kitchenDisposition) }
            : {}),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Cancelar orden',
            changes: [],
            message: validated.message,
          };
        }
        let order: any;
        try {
          order = await ordersService.findOne(orderId);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Cancelar orden',
            changes: [],
            message: `No se encontró la orden ${orderId} en esta tienda: ${describeError(error).message}`,
          };
        }
        if (order.state === 'cancelled' || order.state === 'refunded') {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message: `La orden ya está en estado '${order.state}': no hay nada que cancelar.`,
          };
        }
        const paid = num(order.total_paid);
        return {
          status: paid > 0 ? 'warning' : 'ok',
          target: `Cancelar orden ${order.order_number} de ${customerName(order)}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: order.state,
              to: 'cancelled',
            },
            {
              field: 'reservas',
              label: 'Reservas de stock',
              from: 'retenidas',
              to: 'liberadas (disponible restaurado, físico intacto)',
            },
            {
              field: 'motivo',
              label: 'Motivo',
              from: null,
              to: validated.dto.reason,
            },
          ],
          ...(paid > 0
            ? {
                message: `La orden ya tiene ${paid} pagados: la cancelación revierte el dinero por sus canales.`,
              }
            : {}),
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la cancelación de órdenes');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const validated = toValidatedDto(CancelOrderDto, {
          ...(args.reason ? { reason: String(args.reason) } : {}),
          ...(args.kitchenDisposition
            ? { kitchenDisposition: String(args.kitchenDisposition) }
            : {}),
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Indica un motivo de al menos 3 caracteres y reintenta.',
          });
        }
        try {
          const fresh: any = await ordersService.findOne(orderId);
          if (fresh.state === 'cancelled' || fresh.state === 'refunded') {
            return JSON.stringify({
              error: `La orden ya está en estado '${fresh.state}': no hay nada que cancelar.`,
              next_step: 'Lee la orden con get_order para ver su estado actual.',
            });
          }
          await orderFlowService.cancelOrder(orderId, validated.dto);
          return JSON.stringify({
            cancelacion: { order_id: orderId, estado: 'cancelled' },
            nota: 'La orden quedó cancelada y sus reservas se liberaron: el disponible se restauró sin tocar el físico.',
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo cancelar la orden: ${info.message}`,
            next_step:
              'Lee la orden con get_order: puede haber cambiado de estado o tener una factura que bloquea la cancelación.',
          });
        }
      },
    },

    // ─── O-25 preview_refund ───────────────────────────────────────────
    {
      name: 'preview_refund',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'Calcula cuánto se puede devolver de una orden (cobertura por renglón, techo máximo, ya reembolsado) y qué métodos de reembolso están disponibles. Es el paso OBLIGATORIO antes de refund_order: ese write exige el techo_preview que esta lectura devuelve. Solo las órdenes delivered/finished aceptan reembolso.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          items: {
            type: 'array',
            minItems: 1,
            description: 'Renglones a devolver con cantidades.',
            items: {
              type: 'object',
              properties: {
                order_item_id: {
                  type: 'number',
                  description:
                    'Id del renglón dentro de la orden (ver get_order).',
                },
                quantity: { type: 'number' },
                inventory_action: {
                  type: 'string',
                  enum: REFUND_INVENTORY_ACTIONS,
                  description:
                    'Qué hacer con las unidades: restock, write_off o no_return. Por defecto restock.',
                },
              },
              required: ['order_item_id', 'quantity'],
            },
          },
          include_shipping: {
            type: 'boolean',
            description: 'Devolver también el costo de envío. Por defecto false.',
          },
        },
        required: ['order_id', 'items'],
      },
      requiredPermissions: ['store:orders:order_flow:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la vista previa de reembolsos');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return JSON.stringify({
            error: 'Indica al menos 1 renglón a devolver en items.',
            next_step: 'Lee los renglones con get_order y pasa sus ids.',
          });
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const raw = rawItems[index] ?? {};
          const itemId = Number(raw.order_item_id);
          const quantity = Number(raw.quantity);
          if (!Number.isInteger(itemId) || itemId < 1) {
            return JSON.stringify({
              error: `Renglón ${index + 1}: order_item_id inválido. Usa los ids de get_order.`,
              next_step: 'Lee la orden con get_order para ver sus renglones.',
            });
          }
          if (!Number.isInteger(quantity) || quantity < 1) {
            return JSON.stringify({
              error: `Renglón ${index + 1}: quantity debe ser un entero mayor que 0.`,
              next_step: 'Corrige la cantidad y reintenta.',
            });
          }
          const action = String(raw.inventory_action ?? 'restock');
          if (
            !(REFUND_INVENTORY_ACTIONS as readonly string[]).includes(action)
          ) {
            return JSON.stringify({
              error: `Renglón ${index + 1}: inventory_action "${action}" no existe. Valores válidos: ${REFUND_INVENTORY_ACTIONS.join(', ')}.`,
              next_step: 'Elige restock, write_off o no_return.',
            });
          }
          normalized.push({
            order_item_id: itemId,
            quantity,
            inventory_action: action,
          });
        }
        const validated = toValidatedDto(CreateRefundDto, {
          items: normalized,
          include_shipping: args.include_shipping === true,
          refund_method: 'original_payment',
          reason: 'Vista previa de reembolso',
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y reintenta.',
          });
        }
        try {
          const [calc, order] = await Promise.all([
            refundFlowService.previewRefund(orderId, validated.dto),
            ordersService.findOne(orderId),
          ]);
          const calcAny = calc as any;
          return JSON.stringify({
            orden: {
              order_id: orderId,
              numero: (order as any).order_number,
              estado: (order as any).state,
              cliente: customerName(order),
              total: num((order as any).grand_total),
              pagado: num((order as any).total_paid),
            },
            cobertura: {
              total_reembolso: num(calcAny.total_refund),
              techo_maximo: num(calcAny.max_refundable),
              ya_reembolsado: num(calcAny.already_refunded),
              es_total: !!calcAny.is_full_refund,
              por_renglon: (calcAny.items ?? []).map((item: any) => ({
                order_item_id: item.order_item_id,
                producto: item.product_name,
                cantidad: item.quantity,
                monto_reembolso: num(item.refund_amount),
                accion_inventario: item.inventory_action,
              })),
            },
            metodos: resolveRefundMethodAvailability(order),
            metodos_nota:
              'La cuenta bancaria destino (si eliges transferencia) se elige al aplicar el reembolso.',
            techo_preview: num(calcAny.max_refundable),
            next_step:
              'Pasa techo_preview tal cual a refund_order junto con el método elegido y el motivo. Si cambian los renglones, vuelve a llamar este preview.',
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo previsualizar el reembolso: ${info.message}`,
            next_step:
              'Solo las órdenes delivered/finished aceptan reembolso: verifica el estado con get_order.',
          });
        }
      },
    },

    // ─── O-26 refund_order ─────────────────────────────────────────────
    {
      name: 'refund_order',
      version: '1',
      domain: 'orders',
      description:
        'Reembolsa renglones de una orden delivered/finished. EXIGE haber llamado preview_refund primero: pasa su techo_preview tal cual y el handler lo re-verifica contra el techo vigente (si se movió, te pide repetir el preview). Elige el método entre los disponibles del preview.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          items: {
            type: 'array',
            minItems: 1,
            description: 'Renglones a devolver. Deben coincidir con el preview.',
            items: {
              type: 'object',
              properties: {
                order_item_id: { type: 'number' },
                quantity: { type: 'number' },
                inventory_action: {
                  type: 'string',
                  enum: REFUND_INVENTORY_ACTIONS,
                  description:
                    'Obligatorio y explícito: restock (vuelve a estante), write_off (se da de baja) o no_return (el cliente se lo queda).',
                },
                location_id: { type: 'number' },
                reason: { type: 'string' },
              },
              required: ['order_item_id', 'quantity', 'inventory_action'],
            },
          },
          include_shipping: {
            type: 'boolean',
            description: 'Devolver también el costo de envío. Por defecto false.',
          },
          refund_method: {
            type: 'string',
            enum: REFUND_METHODS,
            description: 'Método por donde sale el dinero. Debe estar disponible.',
          },
          reason: {
            type: 'string',
            description: 'Motivo del reembolso. Obligatorio.',
          },
          notes: { type: 'string', description: 'Notas internas. Opcional.' },
          techo_preview: {
            type: 'number',
            description:
              'El max_refundable (techo_preview) que devolvió preview_refund para estos mismos renglones. Sin haber llamado ese preview, el reembolso no procede.',
          },
        },
        required: [
          'order_id',
          'items',
          'refund_method',
          'reason',
          'techo_preview',
        ],
      },
      requiredPermissions: ['store:orders:order_flow:create'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Reembolsar orden',
            changes: [],
            message: 'Sin tienda en contexto: los reembolsos están acotados por tienda.',
          };
        }
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return {
            status: 'error',
            target: 'Reembolsar orden',
            changes: [],
            message: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          };
        }
        const ceilingSeen = Number(args.techo_preview);
        if (
          args.techo_preview === undefined ||
          args.techo_preview === null ||
          !Number.isFinite(ceilingSeen)
        ) {
          return {
            status: 'error',
            target: 'Reembolsar orden',
            changes: [],
            message:
              'Todo reembolso exige preview_refund primero: llama a esa lectura y pasa su techo_preview tal cual.',
          };
        }
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return {
            status: 'error',
            target: 'Reembolsar orden',
            changes: [],
            message: 'Indica al menos 1 renglón a devolver en items.',
          };
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const raw = rawItems[index] ?? {};
          const itemId = Number(raw.order_item_id);
          const quantity = Number(raw.quantity);
          if (!Number.isInteger(itemId) || itemId < 1) {
            return {
              status: 'error',
              target: 'Reembolsar orden',
              changes: [],
              message: `Renglón ${index + 1}: order_item_id inválido. Usa los ids de get_order.`,
            };
          }
          if (!Number.isInteger(quantity) || quantity < 1) {
            return {
              status: 'error',
              target: 'Reembolsar orden',
              changes: [],
              message: `Renglón ${index + 1}: quantity debe ser un entero mayor que 0.`,
            };
          }
          const action = String(raw.inventory_action ?? '');
          if (
            !(REFUND_INVENTORY_ACTIONS as readonly string[]).includes(action)
          ) {
            return {
              status: 'error',
              target: 'Reembolsar orden',
              changes: [],
              message: `Renglón ${index + 1}: inventory_action es obligatorio y explícito. Valores válidos: ${REFUND_INVENTORY_ACTIONS.join(', ')}.`,
            };
          }
          normalized.push({
            order_item_id: itemId,
            quantity,
            inventory_action: action,
            ...(raw.location_id !== undefined &&
              raw.location_id !== null && {
                location_id: Number(raw.location_id),
              }),
            ...(raw.reason ? { reason: String(raw.reason) } : {}),
          });
        }
        const validated = toValidatedDto(CreateRefundDto, {
          items: normalized,
          include_shipping: args.include_shipping === true,
          ...(args.refund_method
            ? { refund_method: String(args.refund_method) }
            : {}),
          ...(args.reason ? { reason: String(args.reason) } : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Reembolsar orden',
            changes: [],
            message: validated.message,
          };
        }
        let order: any;
        let calc: any;
        try {
          [order, calc] = await Promise.all([
            ordersService.findOne(orderId),
            refundFlowService.previewRefund(orderId, validated.dto),
          ]);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Reembolsar orden',
            changes: [],
            message: `No se pudo cotizar el reembolso: ${describeError(error).message}`,
          };
        }
        const freshCeiling = num(calc.max_refundable);
        if (
          Math.abs(freshCeiling - ceilingSeen) > REFUND_CEILING_TOLERANCE
        ) {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message:
              `El techo se movió desde tu preview (viste ${ceilingSeen}, ahora es ${freshCeiling}): ` +
              'vuelve a llamar preview_refund con los renglones finales y usa su techo_preview.',
          };
        }
        const methodError = methodAvailabilityError(
          order,
          String(args.refund_method),
        );
        if (methodError) {
          return {
            status: 'error',
            target: `Orden ${order.order_number} de ${customerName(order)}`,
            changes: [],
            message: `${methodError.error} ${methodError.next_step}`,
          };
        }
        const total = num(calc.total_refund);
        return {
          status: 'ok',
          target: `Reembolsar ${total} de la orden ${order.order_number} de ${customerName(order)} vía ${args.refund_method}`,
          changes: [
            {
              field: 'monto',
              label: 'Monto a devolver',
              from: null,
              to: total,
            },
            {
              field: 'cobertura',
              label: 'Cobertura (techo / ya reembolsado)',
              from: null,
              to: `techo ${freshCeiling}, ya reembolsado ${num(calc.already_refunded)}`,
            },
            {
              field: 'metodo',
              label: 'Método',
              from: null,
              to: String(args.refund_method),
            },
            {
              field: 'renglones',
              label: 'Renglones',
              from: null,
              to: (calc.items ?? [])
                .map(
                  (item: any) =>
                    `${item.quantity}× ${item.product_name} (${num(item.refund_amount)})`,
                )
                .join(' + '),
            },
            {
              field: 'motivo',
              label: 'Motivo',
              from: null,
              to: validated.dto.reason,
            },
          ],
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('los reembolsos');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const ceilingSeen = Number(args.techo_preview);
        if (
          args.techo_preview === undefined ||
          args.techo_preview === null ||
          !Number.isFinite(ceilingSeen)
        ) {
          return JSON.stringify({
            error: 'Todo reembolso exige preview_refund primero.',
            next_step:
              'Llama preview_refund con los renglones a devolver y pasa su techo_preview tal cual.',
          });
        }
        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return JSON.stringify({
            error: 'Indica al menos 1 renglón a devolver en items.',
            next_step: 'Lee los renglones con get_order y pasa sus ids.',
          });
        }
        const normalized: Record<string, unknown>[] = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const raw = rawItems[index] ?? {};
          const itemId = Number(raw.order_item_id);
          const quantity = Number(raw.quantity);
          if (!Number.isInteger(itemId) || itemId < 1) {
            return JSON.stringify({
              error: `Renglón ${index + 1}: order_item_id inválido. Usa los ids de get_order.`,
              next_step: 'Lee la orden con get_order para ver sus renglones.',
            });
          }
          if (!Number.isInteger(quantity) || quantity < 1) {
            return JSON.stringify({
              error: `Renglón ${index + 1}: quantity debe ser un entero mayor que 0.`,
              next_step: 'Corrige la cantidad y reintenta.',
            });
          }
          const action = String(raw.inventory_action ?? '');
          if (
            !(REFUND_INVENTORY_ACTIONS as readonly string[]).includes(action)
          ) {
            return JSON.stringify({
              error: `Renglón ${index + 1}: inventory_action es obligatorio y explícito (${REFUND_INVENTORY_ACTIONS.join(', ')}).`,
              next_step: 'Elige qué hacer con las unidades devueltas y reintenta.',
            });
          }
          normalized.push({
            order_item_id: itemId,
            quantity,
            inventory_action: action,
            ...(raw.location_id !== undefined &&
              raw.location_id !== null && {
                location_id: Number(raw.location_id),
              }),
            ...(raw.reason ? { reason: String(raw.reason) } : {}),
          });
        }
        const validated = toValidatedDto(CreateRefundDto, {
          items: normalized,
          include_shipping: args.include_shipping === true,
          ...(args.refund_method
            ? { refund_method: String(args.refund_method) }
            : {}),
          ...(args.reason ? { reason: String(args.reason) } : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer el reembolso.',
          });
        }
        try {
          const [order, calc] = await Promise.all([
            ordersService.findOne(orderId),
            refundFlowService.previewRefund(orderId, validated.dto),
          ]);
          const freshCeiling = num((calc as any).max_refundable);
          if (
            Math.abs(freshCeiling - ceilingSeen) > REFUND_CEILING_TOLERANCE
          ) {
            return JSON.stringify({
              error: `El techo se movió desde tu preview (viste ${ceilingSeen}, ahora es ${freshCeiling}).`,
              next_step:
                'Vuelve a llamar preview_refund con los renglones finales y usa su techo_preview.',
            });
          }
          const methodError = methodAvailabilityError(
            order,
            String(args.refund_method),
          );
          if (methodError) return JSON.stringify(methodError);
          const created: any = await refundFlowService.createRefund(
            orderId,
            validated.dto,
          );
          return JSON.stringify({
            reembolso: {
              refund_id: created?.id ?? null,
              order_id: orderId,
              monto: num(created?.total_refund ?? (calc as any).total_refund),
              estado: created?.state ?? created?.status ?? null,
              metodo: validated.dto.refund_method,
            },
            nota: 'El reembolso quedó registrado; el dinero sale por el método elegido.',
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo reembolsar: ${info.message}`,
            next_step:
              'Repite preview_refund para cotizar con el estado actual y reintenta.',
          });
        }
      },
    },

    // ─── O-23 deliver_order_items ──────────────────────────────────────
    {
      name: 'deliver_order_items',
      version: '1',
      domain: 'orders',
      description:
        'Entrega una orden o sus renglones: deliver mueve shipped→delivered (la orden completa), deliver_item entrega UN renglón (plato, cerveza) en órdenes sin mesa, y confirm_delivery cierra delivered/processing como recibida. Lee primero get_order para ver estado y renglones. Nunca escribe orders.state directo: delega en OrderFlowService.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          action: {
            type: 'string',
            enum: DELIVER_ACTIONS,
            description:
              'deliver: entrega total (exige shipped). deliver_item: entrega un renglón (exige order_item_id). confirm_delivery: confirma la recepción y cierra.',
          },
          order_item_id: {
            type: 'number',
            description:
              'Id del renglón dentro de la orden (ver get_order). Obligatorio con deliver_item.',
          },
          delivered_to: {
            type: 'string',
            description: 'Quién recibió. Solo con deliver. Opcional.',
          },
          delivery_notes: {
            type: 'string',
            description: 'Notas de la entrega. Solo con deliver. Opcional.',
          },
        },
        required: ['order_id', 'action'],
      },
      requiredPermissions: ['store:orders:order_flow:create'],
      requiresConfirmation: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Entregar orden',
            changes: [],
            message: 'Sin tienda en contexto: las entregas están acotadas por tienda.',
          };
        }
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return {
            status: 'error',
            target: 'Entregar orden',
            changes: [],
            message: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
          };
        }
        const action = String(args.action ?? '');
        if (!(DELIVER_ACTIONS as readonly string[]).includes(action)) {
          return {
            status: 'error',
            target: 'Entregar orden',
            changes: [],
            message: `action "${action}" no existe. Valores válidos: ${DELIVER_ACTIONS.join(', ')}.`,
          };
        }
        if (action === 'deliver') {
          const validated = toValidatedDto(DeliverOrderDto, {
            ...(args.delivered_to
              ? { delivered_to: String(args.delivered_to) }
              : {}),
            ...(args.delivery_notes
              ? { delivery_notes: String(args.delivery_notes) }
              : {}),
          });
          if (!validated.ok) {
            return {
              status: 'error',
              target: 'Entregar orden',
              changes: [],
              message: validated.message,
            };
          }
        }
        let order: any;
        try {
          order = await ordersService.findOne(orderId);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Entregar orden',
            changes: [],
            message: `No se encontró la orden ${orderId} en esta tienda: ${describeError(error).message}`,
          };
        }
        const subject = `orden ${order.order_number} de ${customerName(order)}`;
        if (action === 'deliver') {
          if (order.state !== 'shipped') {
            return {
              status: 'error',
              target: `Entregar ${subject}`,
              changes: [],
              message: `La orden está en estado '${order.state}': la entrega total exige 'shipped' (despáchala primero con ship_order).`,
            };
          }
          return {
            status: 'ok',
            target: `Entregar ${subject}`,
            changes: [
              {
                field: 'estado',
                label: 'Estado',
                from: 'shipped',
                to: 'delivered',
              },
              ...(args.delivered_to
                ? [
                    {
                      field: 'recibido_por',
                      label: 'Recibido por',
                      from: null,
                      to: String(args.delivered_to),
                    },
                  ]
                : []),
              ...(args.delivery_notes
                ? [
                    {
                      field: 'notas',
                      label: 'Notas',
                      from: null,
                      to: String(args.delivery_notes),
                    },
                  ]
                : []),
            ],
            domain: 'orders',
          };
        }
        if (action === 'deliver_item') {
          const itemId = Number(args.order_item_id);
          if (!Number.isInteger(itemId) || itemId < 1) {
            return {
              status: 'error',
              target: `Entregar renglón de ${subject}`,
              changes: [],
              message:
                'deliver_item exige order_item_id: lee los renglones con get_order y pasa el id.',
            };
          }
          const item = (order.order_items ?? []).find(
            (row: any) => Number(row.id) === itemId,
          );
          if (!item) {
            return {
              status: 'error',
              target: `Entregar renglón de ${subject}`,
              changes: [],
              message: `El renglón ${itemId} no pertenece a esta orden. Lee los renglones con get_order.`,
            };
          }
          if (item.delivered_at) {
            return {
              status: 'error',
              target: `Entregar renglón de ${subject}`,
              changes: [],
              message: `"${item.product_name ?? `renglón ${itemId}`}" ya fue entregado: no hay nada que entregar.`,
            };
          }
          return {
            status: 'ok',
            target: `Entregar "${item.product_name ?? `renglón ${itemId}`}" de ${subject}`,
            changes: [
              {
                field: `renglon_${itemId}`,
                label: item.product_name ?? `Renglón ${itemId}`,
                from: 'pendiente',
                to: 'entregado',
              },
            ],
            domain: 'orders',
          };
        }
        if (
          !(FINISHABLE_STATES as readonly string[]).includes(order.state)
        ) {
          return {
            status: 'error',
            target: `Confirmar entrega de ${subject}`,
            changes: [],
            message: `La orden está en estado '${order.state}': solo se confirma la recepción desde '${FINISHABLE_STATES.join("' o '")}'.`,
          };
        }
        return {
          status: 'ok',
          target: `Confirmar entrega de ${subject}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: order.state,
              to: 'finished',
            },
          ],
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la entrega de órdenes');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const action = String(args.action ?? '');
        if (!(DELIVER_ACTIONS as readonly string[]).includes(action)) {
          return JSON.stringify({
            error: `action "${action}" no existe. Valores válidos: ${DELIVER_ACTIONS.join(', ')}.`,
            next_step: 'Elige deliver, deliver_item o confirm_delivery y reintenta.',
          });
        }
        const validatedDeliver =
          action === 'deliver'
            ? toValidatedDto(DeliverOrderDto, {
                ...(args.delivered_to
                  ? { delivered_to: String(args.delivered_to) }
                  : {}),
                ...(args.delivery_notes
                  ? { delivery_notes: String(args.delivery_notes) }
                  : {}),
              })
            : { ok: true as const, dto: {} as DeliverOrderDto };
        if (!validatedDeliver.ok) {
          return JSON.stringify({
            error: validatedDeliver.message,
            next_step: 'Corrige los campos indicados y vuelve a proponer la entrega.',
          });
        }
        try {
          const fresh: any = await ordersService.findOne(orderId);
          if (action === 'deliver') {
            if (fresh.state !== 'shipped') {
              return JSON.stringify({
                error: `La orden cambió a estado '${fresh.state}': la entrega total exige 'shipped'.`,
                next_step: 'Lee la orden con get_order para ver su estado actual.',
              });
            }
            const updated: any = await orderFlowService.deliverOrder(
              orderId,
              validatedDeliver.dto,
            );
            return JSON.stringify({
              entrega: {
                order_id: orderId,
                numero: updated?.order_number ?? fresh.order_number,
                estado: updated?.state ?? 'delivered',
              },
              nota: 'La orden quedó entregada. Usa confirm_delivery cuando el cliente confirme la recepción para cerrarla.',
            });
          }
          if (action === 'deliver_item') {
            const itemId = Number(args.order_item_id);
            if (!Number.isInteger(itemId) || itemId < 1) {
              return JSON.stringify({
                error: 'deliver_item exige order_item_id.',
                next_step: 'Lee los renglones con get_order y pasa el id.',
              });
            }
            const item = (fresh.order_items ?? []).find(
              (row: any) => Number(row.id) === itemId,
            );
            if (!item) {
              return JSON.stringify({
                error: `El renglón ${itemId} no pertenece a esta orden.`,
                next_step: 'Lee los renglones con get_order para ver los ids válidos.',
              });
            }
            if (item.delivered_at) {
              return JSON.stringify({
                error: `"${item.product_name ?? `renglón ${itemId}`}" ya fue entregado: no hay nada que entregar.`,
                next_step: 'Lee la orden con get_order para ver qué renglones siguen pendientes.',
              });
            }
            await orderFlowService.deliverOrderItem(orderId, itemId);
            return JSON.stringify({
              entrega: {
                order_id: orderId,
                order_item_id: itemId,
                producto: item.product_name ?? null,
              },
              nota: 'El renglón quedó entregado.',
            });
          }
          if (
            !(FINISHABLE_STATES as readonly string[]).includes(fresh.state)
          ) {
            return JSON.stringify({
              error: `La orden cambió a estado '${fresh.state}': solo se confirma la recepción desde '${FINISHABLE_STATES.join("' o '")}'.`,
              next_step: 'Lee la orden con get_order para ver su estado actual.',
            });
          }
          const updated: any =
            await orderFlowService.confirmDelivery(orderId);
          return JSON.stringify({
            entrega: {
              order_id: orderId,
              numero: updated?.order_number ?? fresh.order_number,
              estado: updated?.state ?? 'finished',
            },
            nota: 'La recepción quedó confirmada y la orden se cerró.',
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo entregar: ${info.message}`,
            next_step:
              'Lee la orden con get_order: puede haber cambiado de estado o tener cocina pendiente.',
          });
        }
      },
    },

    // ─── O-27 get_order_timeline ─────────────────────────────────────────
    {
      name: 'get_order_timeline',
      version: '1',
      domain: 'orders',
      readOnly: true,
      description:
        'Historial de eventos de UNA orden: cambios de estado, pagos, reembolsos y quién los hizo, en orden. Úsala para "¿qué le pasó a esta orden?", "¿quién la canceló?" o antes de proponer un cambio masivo (es la cadena de validación de bulk_transition_orders). Requiere el order_id: si solo tienes el número o el cliente, resuelve antes con find_order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'Identificador interno de la orden. Obténlo con find_order.',
          },
          limit: {
            type: 'number',
            description:
              'Máximo de eventos. Por defecto 50, máximo 100.',
          },
        },
        required: ['order_id'],
      },
      requiredPermissions: ['store:orders:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el historial de órdenes');
        const orderId = Number(args.order_id);
        if (!Number.isFinite(orderId) || orderId < 1) {
          return JSON.stringify({
            error: `order_id inválido: "${args.order_id}". Usa find_order para obtener uno válido.`,
            next_step: 'Obtén el order_id con find_order y reintenta.',
          });
        }
        const limit = clamp(args.limit, MAX_TIMELINE_EVENTS, 100);
        try {
          const [order, timeline] = await Promise.all([
            ordersService.findOne(orderId),
            ordersService.getTimeline(orderId),
          ]);
          const events = Array.isArray((timeline as any)?.events)
            ? (timeline as any).events
            : [];
          const legacy = !!(timeline as any)?.legacy;
          const compact = events.slice(0, limit).map((event: any) => ({
            id: event?.id ?? null,
            tipo: event?.event_type ?? event?.action ?? 'evento',
            de: event?.from_state ?? event?.old_value ?? null,
            a: event?.to_state ?? event?.new_value ?? null,
            actor: event?.actor
              ? (event.actor.name ?? `usuario #${event.actor.user_id ?? '?'}`)
              : event?.users
                ? [event.users.first_name, event.users.last_name]
                    .filter(Boolean)
                    .join(' ') || event.users.email
                : null,
            monto: event?.amount !== undefined ? num(event.amount) : undefined,
            detalle: event?.payload ?? event?.description ?? null,
            creada: event?.created_at ?? null,
          }));
          return JSON.stringify({
            orden: {
              order_id: orderId,
              numero: (order as any).order_number,
              estado: (order as any).state,
              cliente: customerName(order),
            },
            total_eventos: events.length,
            mostrando: compact.length,
            ...(events.length > compact.length && {
              nota: `Se muestran ${compact.length} de ${events.length} eventos: los más recientes primero.`,
            }),
            ...(legacy && {
              fuente: 'legacy',
              fuente_nota:
                'Esta orden es anterior al registro de eventos: el historial viene de auditoría y puede estar incompleto.',
            }),
            eventos: compact,
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo leer el historial de la orden ${orderId}: ${info.message}`,
            next_step: 'Verifica el order_id con find_order y reintenta.',
          });
        }
      },
    },

    // ─── O-28 bulk_transition_orders ────────────────────────────────────
    {
      name: 'bulk_transition_orders',
      version: '1',
      domain: 'orders',
      description:
        'Mueve N órdenes al mismo estado (finished, shipped, delivered o cancelled) con previsualización por orden: la preview clasifica cada id en ok / ya-está / forzada / inválida ANTES de que el usuario apruebe. Lee primero get_order_timeline en las órdenes objetivo para auditar qué les pasó. Sin transacción global: cada orden se aplica por separado y el resultado reporta una por una.',
      parameters: {
        type: 'object',
        properties: {
          order_ids: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BULK_ORDERS_IDS,
            description: `Ids internos de las órdenes (máximo ${MAX_BULK_ORDERS_IDS}). Resuélvelos con find_order o list_orders.`,
            items: { type: 'number' },
          },
          target_state: {
            type: 'string',
            enum: BULK_ORDER_TRANSITION_TARGETS,
            description: 'Estado destino común a todo el lote.',
          },
          reason: {
            type: 'string',
            description:
              'Motivo que queda auditado en cada orden. Opcional pero recomendado.',
          },
        },
        required: ['order_ids', 'target_state'],
      },
      requiredPermissions: ['store:orders:bulk_update'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context): Promise<ToolPreview> => {
        if (!context.store_id) {
          return {
            status: 'error',
            target: 'Transición masiva de órdenes',
            changes: [],
            message: 'Sin tienda en contexto: las órdenes están acotadas por tienda.',
          };
        }
        const rawIds = Array.isArray(args.order_ids) ? args.order_ids : [];
        const validated = toValidatedDto(BulkTransitionOrdersDto, {
          ids: rawIds.map((id) => Number(id)),
          ...(args.target_state
            ? { targetState: String(args.target_state) }
            : {}),
          ...(args.reason ? { reason: String(args.reason) } : {}),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Transición masiva de órdenes',
            changes: [],
            message: validated.message,
          };
        }
        let dryRun: any;
        try {
          dryRun = await ordersBulkService.previewTransition(validated.dto);
        } catch (error: any) {
          return {
            status: 'error',
            target: 'Transición masiva de órdenes',
            changes: [],
            message: `No se pudo previsualizar el lote: ${describeError(error).message}`,
          };
        }
        const items = (dryRun.items ?? []) as Array<{
          id: number;
          order_number: string;
          current_state: string;
          status: string;
          message?: string;
        }>;
        const count = (status: string) =>
          items.filter((item) => item.status === status).length;
        const ok = count('ok');
        const skipped = count('skipped');
        const warnings = count('warning');
        const errors = count('error');
        const detail = (item: (typeof items)[number]) =>
          `${item.order_number}: ${item.current_state} → ${validated.dto.targetState} (${item.status}${item.message ? `, ${item.message}` : ''})`;
        if (errors === items.length && items.length > 0) {
          return {
            status: 'error',
            target: `Mover ${items.length} órdenes a ${validated.dto.targetState}`,
            changes: [],
            message: `Ninguna orden del lote es válida: ${items
              .slice(0, 5)
              .map(detail)
              .join('; ')}. Revisa los ids con find_order y vuelve a proponer.`,
          };
        }
        return {
          status: errors > 0 || warnings > 0 ? 'warning' : 'ok',
          target: `Mover ${items.length} órdenes a ${validated.dto.targetState}`,
          changes: [
            {
              field: 'resumen',
              label: 'Clasificación del lote',
              from: null,
              to: `${ok} aplicables, ${skipped} ya están en destino, ${warnings} forzadas (auditadas), ${errors} inválidas (se omiten)`,
            },
            ...items.slice(0, MAX_BULK_PREVIEW_ROWS).map((item) => ({
              field: `orden_${item.id}`,
              label: item.order_number,
              from: item.current_state,
              to:
                item.status === 'ok' || item.status === 'warning'
                  ? validated.dto.targetState
                  : `${item.status}: ${item.message ?? 'sin detalle'}`,
            })),
          ],
          ...(errors > 0 || warnings > 0
            ? {
                message: [
                  errors > 0
                    ? `${errors} inválidas se omiten al aplicar (${items
                        .filter((item) => item.status === 'error')
                        .slice(0, 5)
                        .map((item) => item.order_number)
                        .join(', ')})`
                    : null,
                  warnings > 0
                    ? `${warnings} forzadas quedarán auditadas como transición forzada`
                    : null,
                  items.length > MAX_BULK_PREVIEW_ROWS
                    ? `se muestran ${MAX_BULK_PREVIEW_ROWS} de ${items.length} filas`
                    : null,
                ]
                  .filter(Boolean)
                  .join('. '),
              }
            : {}),
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la transición masiva de órdenes');
        const rawIds = Array.isArray(args.order_ids) ? args.order_ids : [];
        const validated = toValidatedDto(BulkTransitionOrdersDto, {
          ids: rawIds.map((id) => Number(id)),
          ...(args.target_state
            ? { targetState: String(args.target_state) }
            : {}),
          ...(args.reason ? { reason: String(args.reason) } : {}),
        });
        if (!validated.ok) {
          return JSON.stringify({
            error: validated.message,
            next_step: 'Corrige los ids o el estado destino y vuelve a proponer.',
          });
        }
        try {
          // Re-verificación: el lote pudo moverse entre el preview y el apply.
          // Si ya no queda nada aplicable, no se toca ninguna orden.
          const fresh: any = await ordersBulkService.previewTransition(
            validated.dto,
          );
          const freshItems = (fresh.items ?? []) as Array<{ status: string }>;
          const applicable = freshItems.filter(
            (item) => item.status === 'ok' || item.status === 'warning',
          ).length;
          if (applicable === 0) {
            return JSON.stringify({
              error:
                'El lote cambió desde el preview: ya no queda ninguna orden aplicable (pueden haberse movido de estado o salir de la tienda).',
              next_step:
                'Vuelve a proponer el lote para previsualizarlo con el estado actual.',
            });
          }
          const result: any = await ordersBulkService.bulkTransition(
            validated.dto,
          );
          return JSON.stringify({
            lote: {
              destino: validated.dto.targetState,
              total: result.total,
              aplicadas: result.successful,
              fallidas: result.failed,
            },
            por_orden: (result.results ?? []).map((row: any) => ({
              order_id: row.id,
              estado: row.status,
              detalle: row.message ?? row.code ?? null,
            })),
            next_step:
              result.failed > 0
                ? 'Algunas órdenes fallaron: audita cada una con get_order_timeline antes de reintentar.'
                : 'Lote aplicado. Audita cualquier orden con get_order_timeline.',
          });
        } catch (error: any) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo aplicar el lote: ${info.message}`,
            next_step: 'Vuelve a proponer el lote para previsualizarlo de nuevo.',
          });
        }
      },
    },
  ];
}

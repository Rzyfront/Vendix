import { RegisteredTool } from '../interfaces/tool.interface';
import { OrdersService } from '../../../domains/store/orders/orders.service';
import { OrderQueryDto } from '../../../domains/store/orders/dto/order-query.dto';
import { DispatchNotesService } from '../../../domains/store/dispatch-notes/dispatch-notes.service';
import { SessionsService } from '../../../domains/store/cash-registers/sessions/sessions.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

export interface OrdersToolDeps {
  ordersService: OrdersService;
  dispatchNotesService: DispatchNotesService;
  sessionsService: SessionsService;
  prisma: StorePrismaService;
}

const ORDER_STATES = [
  'draft',
  'created',
  'pending_payment',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'finished',
] as const;

const ORDER_CHANNELS = [
  'pos',
  'ecommerce',
  'agent',
  'whatsapp',
  'marketplace',
] as const;

/** Columnas por las que `OrdersService.findAll` puede ordenar sin romper Prisma. */
const SORTABLE_COLUMNS = [
  'created_at',
  'updated_at',
  'order_number',
  'grand_total',
  'state',
] as const;

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
 * Nombre del cliente. Las órdenes de invitado no tienen `users`; el nombre vive
 * en el snapshot de dirección, así que hay que rascarlo de ahí antes de rendirse.
 */
function customerName(order: any): string {
  const user = order?.users;
  if (user) {
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ');
    if (full.trim()) return full.trim();
    if (user.email) return user.email;
  }

  const snapshot = order?.shipping_address_snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const candidate =
      snapshot.full_name ??
      snapshot.recipient_name ??
      snapshot.name ??
      [snapshot.first_name, snapshot.last_name].filter(Boolean).join(' ');
    if (candidate && String(candidate).trim()) return String(candidate).trim();
  }

  return 'Invitado (sin cliente registrado)';
}

/** Fila compacta para listados. Nunca incluyas los ítems completos aquí. */
function compactOrder(order: any) {
  return {
    order_id: order.id,
    numero: order.order_number,
    cliente: customerName(order),
    customer_id: order.customer_id ?? null,
    estado: order.state,
    canal: order.channel,
    tipo_entrega: order.delivery_type,
    total: num(order.grand_total),
    pagado: num(order.total_paid),
    saldo_pendiente: num(order.remaining_balance),
    cumplimiento_despacho: order.dispatch_fulfillment,
    items: Array.isArray(order.order_items) ? order.order_items.length : null,
    creada: order.created_at,
  };
}

function validateEnum(
  value: any,
  allowed: readonly string[],
  field: string,
): string | undefined | { error: string } {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = String(value);
  if (!allowed.includes(parsed)) {
    return {
      error: `${field} "${parsed}" no existe. Valores válidos: ${allowed.join(', ')}.`,
    };
  }
  return parsed;
}

function isError(value: any): value is { error: string } {
  return !!value && typeof value === 'object' && 'error' in value;
}

export function createOrdersTools(deps: OrdersToolDeps): RegisteredTool[] {
  const { ordersService, dispatchNotesService, sessionsService, prisma } = deps;

  const noStore = (what: string) =>
    JSON.stringify({
      error: `Sin tienda en contexto: ${what} está acotado por tienda.`,
    });

  return [
    // ─── find_order ──────────────────────────────────────────────────
    {
      name: 'find_order',
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
          const result = await ordersService.findAll({
            page: 1,
            limit,
            search,
            ...(state && { status: state as any }),
          } as OrderQueryDto);

          const candidatas = result.data.map((o: any) => compactOrder(o));

          // "La orden 412" suele ser el id interno, que `search` no mira: solo
          // compara contra order_number y contra los datos del cliente. Sin este
          // rescate el flujo se corta justo en el paso de entrada.
          if (/^\d+$/.test(search)) {
            const byId = await prisma.orders.findFirst({
              where: { id: Number(search) },
              include: {
                users: {
                  select: { id: true, first_name: true, last_name: true, email: true },
                },
                order_items: { select: { id: true } },
              },
            });
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
          const result = await ordersService.findAll({
            page,
            limit,
            ...(state && { status: state as any }),
            ...(channel && { channel: channel as any }),
            ...(args.customer_id && { customer_id: Number(args.customer_id) }),
            ...(args.search && { search: String(args.search) }),
            ...(from && to && { date_from: from, date_to: to }),
            ...(args.dispatchable === true && { dispatchable: true }),
            ...(args.missing_shipping_method === true && {
              missing_shipping_method: true,
            }),
            ...(sortBy && {
              sort_by: sortBy as string,
              sort_order: args.sort_order === 'asc' ? 'asc' : 'desc',
            }),
          } as OrderQueryDto);

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
          const order = await prisma.orders.findFirst({
            where: { id: orderId },
            select: {
              id: true,
              order_number: true,
              state: true,
              delivery_type: true,
              dispatch_fulfillment: true,
              created_at: true,
              order_items: {
                select: { id: true, product_name: true, quantity: true },
              },
            },
          });

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
  ];
}

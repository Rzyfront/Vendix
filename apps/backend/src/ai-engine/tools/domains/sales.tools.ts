import { order_channel_enum } from '@prisma/client';
import { RegisteredTool } from '../interfaces/tool.interface';
import { SalesAnalyticsService } from '../../../domains/store/analytics/services/sales-analytics.service';
import { ProductsAnalyticsService } from '../../../domains/store/analytics/services/products-analytics.service';
import {
  DatePreset,
  ProductsAnalyticsQueryDto,
  SalesAnalyticsQueryDto,
} from '../../../domains/store/analytics/dto/analytics-query.dto';

export interface SalesToolDeps {
  salesAnalyticsService: SalesAnalyticsService;
  productsAnalyticsService: ProductsAnalyticsService;
}

/**
 * Presets de periodo que entiende `resolveLocalDateRange`. Se resuelven contra
 * el calendario LOCAL de la tienda (no UTC), así que "hoy" es el día de negocio
 * real del comerciante. Sin periodo explícito el rango cae en `thisMonth`.
 */
const DATE_PRESETS = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'lastYear',
] as const;

const CHANNELS = [
  'pos',
  'ecommerce',
  'agent',
  'whatsapp',
  'marketplace',
] as const;

/**
 * Las analíticas cuentan como venta SOLO las órdenes entregadas o finalizadas.
 * El modelo tiene que poder explicarle esto al usuario cuando el número no
 * cuadre con lo que ve en la lista de órdenes.
 */
const SALES_CRITERIA =
  'Solo cuentan las órdenes en estado delivered o finished. Las órdenes creadas, en proceso o pendientes de pago NO suman a estos totales.';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ResolvedPeriod {
  date_from?: string;
  date_to?: string;
  date_preset?: DatePreset;
}

/**
 * Traduce los argumentos del modelo a un rango que las analíticas entienden.
 * Devuelve un string con el error cuando la entrada no sirve, para que el
 * handler lo reenvíe como JSON explicativo en vez de lanzar.
 */
function resolvePeriod(args: Record<string, any>): ResolvedPeriod | string {
  const from = args.date_from ? String(args.date_from) : undefined;
  const to = args.date_to ? String(args.date_to) : undefined;
  const preset = args.date_preset ? String(args.date_preset) : undefined;

  if (from || to) {
    if (!from || !to) {
      return 'Un rango explícito necesita date_from y date_to a la vez. Si solo quieres un periodo relativo usa date_preset.';
    }
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return `Las fechas deben venir en formato YYYY-MM-DD. Recibido: date_from="${from}", date_to="${to}".`;
    }
    if (from > to) {
      return `El rango está invertido: date_from (${from}) es posterior a date_to (${to}).`;
    }
    return { date_from: from, date_to: to };
  }

  if (preset) {
    if (!(DATE_PRESETS as readonly string[]).includes(preset)) {
      return `date_preset "${preset}" no existe. Valores válidos: ${DATE_PRESETS.join(', ')}.`;
    }
    return { date_preset: preset as DatePreset };
  }

  return {};
}

/** Etiqueta legible del periodo, para que la respuesta del modelo sea concreta. */
function describePeriod(period: ResolvedPeriod): string {
  if (period.date_from && period.date_to) {
    return `${period.date_from} a ${period.date_to}`;
  }
  return period.date_preset ?? 'thisMonth (por defecto)';
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * `order_channel_enum` ES un union de strings, así que señalar el error
 * devolviendo un `string` haría que `typeof x === 'string'` se tragara también
 * los valores válidos. De ahí el resultado etiquetado.
 */
type ChannelResult =
  | { ok: true; value?: order_channel_enum }
  | { ok: false; error: string };

function resolveChannel(args: Record<string, any>): ChannelResult {
  if (!args.channel) return { ok: true };
  const channel = String(args.channel);
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    return {
      ok: false,
      error: `channel "${channel}" no existe. Valores válidos: ${CHANNELS.join(', ')}.`,
    };
  }
  return { ok: true, value: channel as order_channel_enum };
}

export function createSalesTools(deps: SalesToolDeps): RegisteredTool[] {
  const { salesAnalyticsService, productsAnalyticsService } = deps;

  return [
    // ─── get_sales_report ────────────────────────────────────────────
    {
      name: 'get_sales_report',
      domain: 'sales',
      readOnly: true,
      description:
        'Cuánto vendió la tienda en un periodo: ingresos, número de órdenes, ticket promedio, unidades vendidas, clientes distintos y el crecimiento contra el periodo anterior equivalente. Úsala para "¿cómo vamos hoy?", "¿cuánto vendimos este mes?", "¿mejoramos respecto al mes pasado?" o cuando pidan comparar canales (POS vs ecommerce). Para el detalle orden por orden usa list_orders; para saber qué producto se vendió más usa get_top_products.',
      parameters: {
        type: 'object',
        properties: {
          date_preset: {
            type: 'string',
            enum: DATE_PRESETS,
            description:
              'Periodo relativo, resuelto en la zona horaria de la tienda. Si se omite junto con date_from/date_to, se usa el mes en curso.',
          },
          date_from: {
            type: 'string',
            description:
              'Inicio del rango en formato YYYY-MM-DD. Debe acompañarse de date_to.',
          },
          date_to: {
            type: 'string',
            description:
              'Fin del rango en formato YYYY-MM-DD, inclusive. Debe acompañarse de date_from.',
          },
          channel: {
            type: 'string',
            enum: CHANNELS,
            description:
              'Limita el reporte a un canal de venta. Si se omite, suma todos los canales.',
          },
        },
      },
      requiredPermissions: ['store:analytics:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: el reporte de ventas está acotado por tienda.',
          });
        }

        const period = resolvePeriod(args);
        if (typeof period === 'string') {
          return JSON.stringify({ error: period });
        }

        const channelResult = resolveChannel(args);
        if (!channelResult.ok) {
          return JSON.stringify({ error: channelResult.error });
        }
        const channel = channelResult.value;

        try {
          const query = {
            ...period,
            ...(channel ? { channel } : {}),
          } as SalesAnalyticsQueryDto;

          const summary =
            await salesAnalyticsService.getSalesSummary(query);

          return JSON.stringify({
            periodo: describePeriod(period),
            canal: channel ?? 'todos',
            criterio: SALES_CRITERIA,
            totales: {
              ingresos: round2(summary.total_revenue),
              ordenes: summary.total_orders,
              ticket_promedio: round2(summary.average_order_value),
              unidades_vendidas: summary.total_units_sold,
              clientes_distintos: summary.total_customers,
            },
            variacion_vs_periodo_anterior: {
              ingresos_pct: round2(summary.revenue_growth),
              ordenes_pct: round2(summary.orders_growth),
              nota: 'El periodo anterior es un tramo de la misma duración inmediatamente previo. 0 significa que el periodo anterior no tuvo ventas, no que no haya cambio.',
            },
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo calcular el reporte de ventas: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },

    // ─── get_top_products ────────────────────────────────────────────
    {
      name: 'get_top_products',
      domain: 'sales',
      readOnly: true,
      description:
        'Ranking de los productos más vendidos en un periodo, por facturación o por unidades. Devuelve, por producto, unidades vendidas, ingresos, precio promedio real de venta y margen estimado. Úsala para "¿qué es lo que más se vende?", "¿cuáles son mis productos estrella?" o para decidir qué reponer. Ojo: el ranking por facturación y el ranking por unidades pueden ser muy distintos — pregunta o elige según lo que el usuario quiera saber.',
      parameters: {
        type: 'object',
        properties: {
          date_preset: {
            type: 'string',
            enum: DATE_PRESETS,
            description:
              'Periodo relativo, resuelto en la zona horaria de la tienda. Por defecto, el mes en curso.',
          },
          date_from: {
            type: 'string',
            description: 'Inicio del rango YYYY-MM-DD. Requiere date_to.',
          },
          date_to: {
            type: 'string',
            description:
              'Fin del rango YYYY-MM-DD, inclusive. Requiere date_from.',
          },
          sort_by: {
            type: 'string',
            enum: ['revenue', 'quantity'],
            description:
              'revenue ordena por dinero facturado (por defecto); quantity ordena por unidades despachadas.',
          },
          limit: {
            type: 'number',
            description:
              'Cuántos productos devolver. Por defecto 10, máximo 25.',
          },
          category_id: {
            type: 'number',
            description:
              'Restringe el ranking a una categoría. Usa find_product o el catálogo para obtener el id.',
          },
          channel: {
            type: 'string',
            enum: CHANNELS,
            description:
              'Filtra por canal de venta. Solo aplica cuando sort_by es revenue.',
          },
        },
      },
      requiredPermissions: ['store:analytics:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: el ranking de productos está acotado por tienda.',
          });
        }

        const period = resolvePeriod(args);
        if (typeof period === 'string') {
          return JSON.stringify({ error: period });
        }

        const channelResult = resolveChannel(args);
        if (!channelResult.ok) {
          return JSON.stringify({ error: channelResult.error });
        }
        const channel = channelResult.value;

        const sortBy = args.sort_by === 'quantity' ? 'quantity' : 'revenue';
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
        const categoryId = args.category_id
          ? Number(args.category_id)
          : undefined;

        try {
          let rows: any[];

          if (sortBy === 'quantity') {
            rows = await productsAnalyticsService.getTopSellingProducts({
              ...period,
              limit,
              ...(categoryId && { category_id: categoryId }),
            } as ProductsAnalyticsQueryDto);
          } else {
            // Sin `page` el servicio devuelve el array plano ya ordenado por
            // facturación descendente; con `page` devolvería `{ data, meta }`.
            const result = await salesAnalyticsService.getSalesByProduct({
              ...period,
              limit,
              ...(categoryId && { category_id: categoryId }),
              ...(channel ? { channel } : {}),
            } as SalesAnalyticsQueryDto);
            rows = Array.isArray(result) ? result : (result as any).data;
          }

          const data = (rows ?? []).map((r: any) => ({
            product_id: r.product_id,
            producto: r.product_name,
            sku: r.sku || null,
            unidades_vendidas: r.units_sold,
            ingresos: round2(r.revenue),
            precio_promedio: round2(r.average_price),
            margen_pct:
              r.profit_margin === null || r.profit_margin === undefined
                ? null
                : round2(r.profit_margin),
          }));

          return JSON.stringify({
            periodo: describePeriod(period),
            ordenado_por: sortBy === 'quantity' ? 'unidades' : 'facturación',
            canal: sortBy === 'revenue' ? (channel ?? 'todos') : 'todos',
            criterio: SALES_CRITERIA,
            mostrando: data.length,
            limite_aplicado: limit,
            nota:
              data.length === limit
                ? 'Se alcanzó el límite pedido; puede haber más productos con ventas en el periodo.'
                : 'Estos son todos los productos con ventas en el periodo.',
            margen_nota:
              'margen_pct es estimado contra el cost_price actual del producto, no contra el costo histórico de cada venta. null significa que el producto no tiene costo cargado.',
            data,
          });
        } catch (error: any) {
          return JSON.stringify({
            error: `No se pudo calcular el ranking de productos: ${error?.message ?? 'error desconocido'}`,
          });
        }
      },
    },
  ];
}

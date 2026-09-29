import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RegisteredTool } from '../interfaces/tool.interface';
import { S3Service } from '../../../common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { internalApiBase, internalAuthHeaders } from '../bridge/internal-http';

export interface ReportingToolDeps {
  s3: S3Service;
}

/** Long enough to click the link in the chat, short enough not to be a leak. */
const LINK_TTL_SECONDS = 900;

/** A report bigger than this is a data export, and it belongs in the module. */
const MAX_REPORT_BYTES = 25 * 1024 * 1024;

/**
 * Tope documentado de A-2: el turno no carga más filas que estas por llamada.
 * Los endpoints ya agregan; la tool garantiza el tope aunque el endpoint no
 * pagine, para no saturar el contexto de la conversación.
 */
const MAX_ANALYZE_ROWS = 200;
const DEFAULT_ANALYZE_LIMIT = 50;

const logger = new Logger('vexi-reporting');

/**
 * Catálogo de reportes para A-1/A-2, espejo del registry del frontend
 * (`report-registry.ts`): 49 reportes con dataEndpoint, 29 con exportEndpoint.
 *
 * Los 20 sin export devuelven `{error, next_step}` guiado en A-1 por diseño
 * (el botón de descarga está oculto en la UI para esos reportes): no se
 * inventa ningún archivo. A-2 sí cubre los 49 porque todos tienen lectura.
 */
interface ReportCatalogEntry {
  label: string;
  data: string;
  export?: string;
}

const REPORT_CATALOG: Record<string, ReportCatalogEntry> = {
  'overview-summary': {
    label: 'Resumen general',
    data: 'store/analytics/overview/summary',
  },
  'purchase-summary': {
    label: 'Resumen de compras',
    data: 'store/analytics/purchases/summary',
    export: 'store/analytics/purchases/export',
  },
  'purchase-by-supplier': {
    label: 'Compras por proveedor',
    data: 'store/analytics/purchases/by-supplier',
  },
  'purchase-trends': {
    label: 'Tendencias de compra',
    data: 'store/analytics/purchases/trends',
    export: 'store/analytics/purchases/trends/export',
  },
  'payable-aging': {
    label: 'Antigüedad de cuentas por pagar',
    data: 'store/analytics/purchases/payable-aging',
    export: 'store/analytics/purchases/payable-aging/export',
  },
  'reviews-summary': {
    label: 'Resumen de reseñas',
    data: 'store/analytics/reviews/summary',
    export: 'store/analytics/reviews/export',
  },
  'reviews-by-product': {
    label: 'Reseñas por producto',
    data: 'store/analytics/reviews/by-product',
    export: 'store/analytics/reviews/by-product/export',
  },
  'sales-summary': {
    label: 'Resumen de ventas',
    data: 'store/analytics/sales/summary',
    export: 'store/analytics/sales/export',
  },
  'sales-by-product': {
    label: 'Ventas por producto',
    data: 'store/analytics/sales/by-product',
  },
  'sales-by-category': {
    label: 'Ventas por categoría',
    data: 'store/analytics/sales/by-category',
  },
  'sales-by-customer': {
    label: 'Ventas por cliente',
    data: 'store/analytics/sales/by-customer',
  },
  'sales-by-payment': {
    label: 'Ventas por medio de pago',
    data: 'store/analytics/sales/by-payment-method',
  },
  'sales-by-channel': {
    label: 'Ventas por canal',
    data: 'store/analytics/sales/by-channel',
    export: 'store/analytics/sales/by-channel/export',
  },
  'sales-by-user': {
    label: 'Ventas por vendedor',
    data: 'store/analytics/sales/by-user',
    export: 'store/analytics/sales/by-user/export',
  },
  'sales-tips-by-waiter': {
    label: 'Propinas por mesero',
    data: 'store/analytics/sales/tips-by-waiter',
    export: 'store/analytics/sales/tips-by-waiter/export',
  },
  'sales-trends': {
    label: 'Tendencias de ventas',
    data: 'store/analytics/sales/trends',
  },
  'inventory-overview': {
    label: 'Resumen de inventario',
    data: 'store/analytics/inventory/summary',
  },
  'inventory-stock-info': {
    label: 'Niveles de stock',
    data: 'store/analytics/inventory/stock-levels',
    export: 'store/analytics/inventory/export',
  },
  'inventory-low-stock': {
    label: 'Stock bajo',
    data: 'store/analytics/inventory/low-stock',
    export: 'store/analytics/inventory/low-stock/export',
  },
  'inventory-low-stock-by-supplier': {
    label: 'Stock bajo por proveedor',
    data: 'store/analytics/inventory/low-stock-by-supplier',
    export: 'store/analytics/inventory/low-stock-by-supplier/export',
  },
  'inventory-by-supplier': {
    label: 'Inventario por proveedor',
    data: 'store/analytics/inventory/by-supplier',
    export: 'store/analytics/inventory/by-supplier/export',
  },
  'inventory-valuation': {
    label: 'Valorización de inventario',
    data: 'store/analytics/inventory/valuation',
  },
  'inventory-movements': {
    label: 'Movimientos de inventario',
    data: 'store/analytics/inventory/movements',
    export: 'store/analytics/inventory/movements/export',
  },
  'inventory-movement-analysis': {
    label: 'Análisis de movimientos',
    data: 'store/analytics/inventory/movement-summary',
  },
  'inventory-ingredient-consumption': {
    label: 'Consumo de insumos',
    data: 'store/analytics/inventory/ingredient-consumption',
    export: 'store/analytics/inventory/ingredient-consumption/export',
  },
  'product-performance': {
    label: 'Rendimiento de productos',
    data: 'store/analytics/products/performance',
    export: 'store/analytics/products/performance/export',
  },
  'product-top-sellers': {
    label: 'Productos más vendidos',
    data: 'store/analytics/products/top-sellers',
  },
  'product-profitability': {
    label: 'Rentabilidad de productos',
    data: 'store/analytics/products/profitability',
    export: 'store/analytics/products/profitability/export',
  },
  'customer-summary': {
    label: 'Resumen de clientes',
    data: 'store/analytics/customers/summary',
    export: 'store/analytics/customers/export',
  },
  'customer-acquisition': {
    label: 'Adquisición de clientes',
    data: 'store/analytics/customers/channels',
  },
  'customer-abandoned-carts': {
    label: 'Carritos abandonados',
    data: 'store/analytics/customers/abandoned-carts/summary',
    export: 'store/analytics/customers/abandoned-carts/export',
  },
  'customers-top': {
    label: 'Mejores clientes',
    data: 'store/analytics/customers/top',
    export: 'store/analytics/customers/top/export',
  },
  'customers-receivable': {
    label: 'Cartera por cobrar',
    data: 'store/analytics/customers/receivable',
    export: 'store/analytics/customers/receivable/export',
  },
  'trial-balance': {
    label: 'Balance de prueba',
    data: 'store/accounting/reports/trial-balance',
  },
  'balance-sheet': {
    label: 'Balance general',
    data: 'store/accounting/reports/balance-sheet',
  },
  'income-statement': {
    label: 'Estado de resultados',
    data: 'store/accounting/reports/income-statement',
  },
  'general-ledger': {
    label: 'Libro mayor',
    data: 'store/accounting/reports/general-ledger',
  },
  'tax-summary': {
    label: 'Resumen de impuestos',
    data: 'store/analytics/financial/tax-summary',
    export: 'store/analytics/financial/tax-summary/export',
  },
  'financial-refunds': {
    label: 'Reembolsos',
    data: 'store/analytics/financial/refunds',
  },
  'cash-sessions': {
    label: 'Cierres de caja',
    data: 'store/analytics/financial/cash-sessions',
    export: 'store/analytics/financial/cash-sessions/export',
  },
  'expenses-summary': {
    label: 'Resumen de gastos',
    data: 'store/analytics/financial/expenses',
    export: 'store/analytics/financial/expenses/export',
  },
  'profit-loss': {
    label: 'Pérdidas y ganancias',
    data: 'store/analytics/financial/profit-loss',
    export: 'store/analytics/financial/export',
  },
  'payroll-summary': {
    label: 'Resumen de nómina',
    data: 'store/reports/payroll/summary',
  },
  'payroll-by-employee': {
    label: 'Nómina por empleado',
    data: 'store/reports/payroll/by-employee',
  },
  'payroll-provisions': {
    label: 'Provisiones laborales',
    data: 'store/reports/payroll/provisions',
  },
  'dispatch-remisiones': {
    label: 'Remisiones de despacho',
    data: 'store/analytics/dispatch/remisiones',
    export: 'store/analytics/dispatch/remisiones/export',
  },
  'dispatch-planillas': {
    label: 'Planillas de ruta',
    data: 'store/analytics/dispatch/planillas',
    export: 'store/analytics/dispatch/planillas/export',
  },
  'dispatch-vehiculos': {
    label: 'Vehículos de reparto',
    data: 'store/analytics/dispatch/vehiculos',
    export: 'store/analytics/dispatch/vehiculos/export',
  },
  'payments-list': {
    label: 'Pagos recibidos',
    data: 'store/analytics/payments',
    export: 'store/analytics/payments/export',
  },
};

const REPORT_IDS = Object.keys(REPORT_CATALOG);

function guidedError(error: string, nextStep: string): string {
  return JSON.stringify({ error, next_step: nextStep });
}

function unknownReport(reportId: unknown): string {
  return guidedError(
    `No conozco un reporte llamado "${String(reportId)}".`,
    `Usa uno de los reportes del catálogo (por ejemplo sales-summary, inventory-low-stock o profit-loss). Si me dices qué quieres ver, te sugiero el report_id exacto.`,
  );
}

function requireCredential(): { ok: true } | { ok: false; body: string } {
  const context = RequestContextService.getContext();
  if (!context?.access_token) {
    return {
      ok: false,
      body: guidedError(
        'No hay credencial del usuario en este contexto, así que no puedo leer los reportes en su nombre.',
        'Pídele a la persona que vuelva a abrir el chat e inténtalo de nuevo.',
      ),
    };
  }
  return { ok: true };
}

function buildUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): URL {
  const url = new URL(`${internalApiBase()}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * A-1/A-2 — Reportes y analítica (paso 8, P0).
 *
 * Dos tools parametrizadas en vez de ~290 tools 1:1. Ambas leen a través del
 * HTTP interno con el token del usuario, así que atraviesan guards,
 * interceptores y scope de tienda reales: la tool nunca ve lo que el
 * navegador de la persona no podría ver.
 *
 * - A-2 `analyze_report` es la ÚNICA vía para conversar sobre datos: los
 *   números viajan tal cual los calcula el endpoint (que delega en
 *   `analytics-metrics.contract.ts`); el modelo NUNCA recalcula métricas.
 * - A-1 `export_report` SOLO se invoca ante un pedido explícito de descarga
 *   ("descarga/exporta el XLSX"); nunca como paso intermedio de un análisis.
 */
export function createReportingTools({ s3 }: ReportingToolDeps): RegisteredTool[] {
  return [
    // ─── A-2: analyze_report (READ) ────────────────────────────────
    {
      name: 'analyze_report',
      version: '1',
      domain: 'reporting',
      readOnly: true,
      description:
        'Lee los datos agregados de un reporte para conversar sobre ellos, validar antes de actuar o responder preguntas de negocio. Es la ÚNICA vía para hablar de cifras: presenta los números tal cual vienen (ya los calcula el endpoint con el contrato de métricas) y NUNCA los recalcules a mano. Pasa el rango de fechas cuando la pregunta lo pide ("agosto", "esta semana") y pagina con limit/offset si hay muchas filas. Si lo que piden es descargar el archivo, eso es export_report, no esta tool.',
      parameters: {
        type: 'object',
        properties: {
          report_id: {
            type: 'string',
            enum: REPORT_IDS,
            description:
              'Qué reporte se quiere leer (por ejemplo sales-summary, inventory-low-stock, profit-loss).',
          },
          date_from: {
            type: 'string',
            description: 'Fecha inicial del rango, formato YYYY-MM-DD.',
          },
          date_to: {
            type: 'string',
            description: 'Fecha final del rango, formato YYYY-MM-DD.',
          },
          limit: {
            type: 'number',
            description: `Filas por página para reportes tabulares (por defecto ${DEFAULT_ANALYZE_LIMIT}, máximo ${MAX_ANALYZE_ROWS}).`,
          },
          offset: {
            type: 'number',
            description: 'Filas a saltar para paginar (por defecto 0).',
          },
        },
        required: ['report_id'],
      },
      requiredPermissions: ['store:analytics:read'],
      handler: async (args) => {
        const entry = REPORT_CATALOG[String(args.report_id)];
        if (!entry) return unknownReport(args.report_id);

        const credential = requireCredential();
        if (!credential.ok) return credential.body;

        const limit = Math.min(
          Math.max(Number(args.limit ?? DEFAULT_ANALYZE_LIMIT) || DEFAULT_ANALYZE_LIMIT, 1),
          MAX_ANALYZE_ROWS,
        );
        const offset = Math.max(Number(args.offset ?? 0) || 0, 0);

        const url = buildUrl(entry.data, {
          date_from: args.date_from as string | undefined,
          date_to: args.date_to as string | undefined,
          limit,
          offset,
        });

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: internalAuthHeaders(),
          });

          if (!response.ok) {
            const detail = await response.text();
            return guidedError(
              `El reporte de ${entry.label} devolvió ${response.status}.`,
              response.status === 403
                ? 'La persona no tiene permiso para ver ese reporte. Explícaselo en vez de reintentar.'
                : `Revisa el rango de fechas y vuelve a intentarlo una sola vez. Detalle: ${detail.slice(0, 200)}`,
            );
          }

          const payload = (await response.json()) as Record<string, any>;
          const data =
            payload && typeof payload === 'object' && 'data' in payload
              ? (payload as { data: unknown }).data
              : payload;

          const range = {
            date_from: (args.date_from as string | undefined) ?? null,
            date_to: (args.date_to as string | undefined) ?? null,
          };

          if (Array.isArray(data)) {
            const rows = data.slice(offset, offset + limit);
            const truncated = data.length > offset + rows.length;
            return JSON.stringify({
              report: entry.label,
              report_id: String(args.report_id),
              range,
              row_count: data.length,
              offset,
              limit,
              truncated,
              rows,
              next_step: truncated
                ? `Hay más filas: repite con offset ${offset + rows.length} para ver la siguiente página. Presenta las cifras tal cual, sin recalcularlas.`
                : 'Presenta estas cifras tal cual vienen, sin recalcularlas a mano.',
            });
          }

          return JSON.stringify({
            report: entry.label,
            report_id: String(args.report_id),
            range,
            summary: data,
            next_step:
              'Presenta estas cifras tal cual vienen, sin recalcularlas a mano.',
          });
        } catch (error: any) {
          logger.warn(
            `analyze_report(${args.report_id}) failed: ${error?.message}`,
          );
          return guidedError(
            `No pude leer el reporte de ${entry.label}: ${error?.message ?? 'error interno'}.`,
            'Revisa el report_id y el rango de fechas e inténtalo de nuevo.',
          );
        }
      },
    },

    // ─── A-1: export_report (READ, solo descarga explícita) ─────────
    {
      name: 'export_report',
      version: '1',
      domain: 'reporting',
      readOnly: true,
      description:
        'Genera el XLSX de un reporte y devuelve un enlace de descarga. Úsala SOLO cuando la persona pide explícitamente descargar o exportar el archivo ("descarga el XLSX", "expórtame las ventas"); para conversar sobre cifras o validar antes de actuar usa analyze_report. El archivo lo construye el propio endpoint de export, con las mismas columnas, totales y fechas en la zona horaria de la tienda que el módulo de Reportes. El enlace vence en 15 minutos: dilo al entregarlo.',
      parameters: {
        type: 'object',
        properties: {
          report_id: {
            type: 'string',
            enum: REPORT_IDS,
            description: 'Qué reporte se quiere descargar.',
          },
          date_from: {
            type: 'string',
            description: 'Fecha inicial del rango, formato YYYY-MM-DD.',
          },
          date_to: {
            type: 'string',
            description: 'Fecha final del rango, formato YYYY-MM-DD.',
          },
        },
        required: ['report_id'],
      },
      requiredPermissions: ['store:analytics:read'],
      handler: async (args) => {
        const reportId = String(args.report_id);
        const entry = REPORT_CATALOG[reportId];
        if (!entry) return unknownReport(args.report_id);

        if (!entry.export) {
          return guidedError(
            `El reporte de ${entry.label} no tiene descarga XLSX: en el módulo de Reportes tampoco muestra botón de exportar.`,
            'Ofrece leerlo con analyze_report para conversar sobre sus datos, o pregúntale a la persona si otro reporte con descarga le sirve.',
          );
        }

        const credential = requireCredential();
        if (!credential.ok) return credential.body;

        const url = buildUrl(entry.export, {
          date_from: args.date_from as string | undefined,
          date_to: args.date_to as string | undefined,
        });

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: internalAuthHeaders({
              // The export endpoints answer a binary stream, not the JSON envelope.
              Accept:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
          });

          if (!response.ok) {
            const detail = await response.text();
            return guidedError(
              `El reporte de ${entry.label} devolvió ${response.status}.`,
              response.status === 403
                ? 'La persona no tiene permiso para ver ese reporte. Explícaselo en vez de reintentar.'
                : `Revisa el rango de fechas y vuelve a intentarlo una sola vez. Detalle: ${detail.slice(0, 200)}`,
            );
          }

          const buffer = Buffer.from(await response.arrayBuffer());

          if (!buffer.length) {
            return guidedError(
              `El reporte de ${entry.label} salió vacío para ese rango.`,
              'Dile a la persona que no hay datos en esas fechas y ofrécele otro periodo.',
            );
          }

          if (buffer.length > MAX_REPORT_BYTES) {
            return guidedError(
              `El reporte pesa ${Math.round(buffer.length / 1024 / 1024)} MB, demasiado para entregarlo por el chat.`,
              'Ofrécele acotar el rango de fechas o descargarlo desde el módulo de Reportes.',
            );
          }

          const context = RequestContextService.getContext();
          const storeId = context?.store_id ?? 0;
          const fileName = `${reportId}${args.date_from ? `-${args.date_from}` : ''}${args.date_to ? `-a-${args.date_to}` : ''}.xlsx`;
          const key = `vexi-reports/stores/${storeId}/${randomUUID()}-${fileName}`;

          await s3.uploadFile(
            buffer,
            key,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          );

          const signedUrl = await s3.getPresignedUrl(key, LINK_TTL_SECONDS);

          return JSON.stringify({
            report: entry.label,
            report_id: reportId,
            file_name: fileName,
            size_kb: Math.round(buffer.length / 1024),
            download_url: signedUrl,
            expires_in_minutes: Math.round(LINK_TTL_SECONDS / 60),
            note: 'Entrégale el enlace tal cual, di de qué reporte es y avísale que vence en 15 minutos. No describas el contenido: no lo leíste, solo lo generaste.',
          });
        } catch (error: any) {
          logger.warn(
            `export_report(${args.report_id}) failed: ${error?.message}`,
          );
          return guidedError(
            `No pude generar el reporte de ${entry.label}: ${error?.message ?? 'error interno'}.`,
            'Revisa el report_id y el rango de fechas e inténtalo de nuevo.',
          );
        }
      },
    },
  ];
}

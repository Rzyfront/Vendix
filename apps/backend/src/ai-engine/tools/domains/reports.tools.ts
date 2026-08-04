import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RegisteredTool } from '../interfaces/tool.interface';
import { S3Service } from '../../../common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { internalApiBase, internalAuthHeaders } from '../bridge/internal-http';

export interface ReportToolDeps {
  s3: S3Service;
}

/** Long enough to click the link in the chat, short enough not to be a leak. */
const LINK_TTL_SECONDS = 900;

/** A report bigger than this is a data export, and it belongs in the module. */
const MAX_REPORT_BYTES = 25 * 1024 * 1024;

const logger = new Logger('vexi-reports');

/**
 * Business-facing report key → the export endpoint that builds it.
 *
 * Curated deliberately. The catalog can see that `store/analytics/sales/export`
 * exists, but not that a person asking for "las ventas de agosto" means that one and
 * not `store/analytics/products/export`; and getting it wrong here means handing
 * someone the wrong spreadsheet and letting them act on it. The keys are the words
 * people actually use, so the model maps a request onto one without guessing at a
 * route.
 */
const REPORTS: Record<string, { path: string; label: string }> = {
  ventas: { path: 'store/analytics/sales/export', label: 'Ventas' },
  productos: { path: 'store/analytics/products/export', label: 'Productos' },
  rendimiento_productos: {
    path: 'store/analytics/products/performance/export',
    label: 'Rendimiento de productos',
  },
  rentabilidad_productos: {
    path: 'store/analytics/products/profitability/export',
    label: 'Rentabilidad de productos',
  },
  inventario: {
    path: 'store/analytics/inventory/export',
    label: 'Inventario',
  },
  movimientos_inventario: {
    path: 'store/analytics/inventory/movements/export',
    label: 'Movimientos de inventario',
  },
  clientes: { path: 'store/analytics/customers/export', label: 'Clientes' },
  carritos_abandonados: {
    path: 'store/analytics/customers/abandoned-carts/export',
    label: 'Carritos abandonados',
  },
  compras: { path: 'store/analytics/purchases/export', label: 'Compras' },
  reseñas: { path: 'store/analytics/reviews/export', label: 'Reseñas' },
  financiero: {
    path: 'store/analytics/financial/export',
    label: 'Estado financiero',
  },
  impuestos: {
    path: 'store/analytics/financial/tax-summary/export',
    label: 'Resumen de impuestos',
  },
  cierres_caja: {
    path: 'store/analytics/financial/cash-sessions/export',
    label: 'Cierres de caja',
  },
};

/**
 * Reports, delivered as a file rather than as prose.
 *
 * The binary never touches the model. A spreadsheet arrives as bytes, goes straight
 * to S3, and what returns to the conversation is a short-lived signed link — which
 * is the only workable shape: the tool-result channel truncates at 6.000 characters,
 * so an XLSX pushed through it would arrive corrupt, and base64 of a real report
 * would cost more tokens than the entire conversation around it.
 *
 * The report itself is built by the module's own export endpoint, so the columns,
 * the number formats, the timezone and the totals are identical to what the person
 * gets from the Reportes screen. Rebuilding them here would produce a second,
 * silently diverging version of every report in the product.
 */
export function createReportTools({ s3 }: ReportToolDeps): RegisteredTool[] {
  return [
    {
      name: 'get_report',
      domain: 'reports',
      readOnly: true,
      description:
        'Genera un reporte en Excel y devuelve un enlace de descarga para que la persona lo abra. Es el mismo reporte del módulo de Reportes, con las mismas columnas y totales, así que no lo rearmes tú ni resumas cifras a mano cuando lo que piden es el archivo. Reportes disponibles: ventas, productos, rendimiento_productos, rentabilidad_productos, inventario, movimientos_inventario, clientes, carritos_abandonados, compras, reseñas, financiero, impuestos, cierres_caja. Si la persona pide un rango ("agosto", "el último trimestre"), traduce las fechas tú y pásalas explícitas. El enlace vence en 15 minutos: dilo al entregarlo.',
      parameters: {
        type: 'object',
        properties: {
          report: {
            type: 'string',
            enum: Object.keys(REPORTS),
            description: 'Qué reporte se quiere.',
          },
          date_from: {
            type: 'string',
            description: 'Fecha inicial en formato YYYY-MM-DD.',
          },
          date_to: {
            type: 'string',
            description: 'Fecha final en formato YYYY-MM-DD.',
          },
        },
        required: ['report'],
      },
      handler: async (args) => {
        const target = REPORTS[String(args.report)];

        if (!target) {
          return JSON.stringify({
            error: `No tengo un reporte llamado "${args.report}". Los que puedo generar son: ${Object.keys(REPORTS).join(', ')}.`,
          });
        }

        const context = RequestContextService.getContext();
        if (!context?.access_token) {
          return JSON.stringify({
            error:
              'No hay credencial del usuario en este contexto, así que no puedo generar el reporte en su nombre.',
          });
        }

        const url = new URL(`${internalApiBase()}/${target.path}`);
        if (args.date_from) {
          url.searchParams.set('date_from', String(args.date_from));
        }
        if (args.date_to) {
          url.searchParams.set('date_to', String(args.date_to));
        }

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
            return JSON.stringify({
              error: `El reporte de ${target.label} devolvió ${response.status}.`,
              detail: detail.slice(0, 400),
              note:
                response.status === 403
                  ? 'La persona no tiene permiso para ver ese reporte. Explícaselo en vez de reintentar.'
                  : 'Revisa el rango de fechas y vuelve a intentarlo una sola vez.',
            });
          }

          const buffer = Buffer.from(await response.arrayBuffer());

          if (!buffer.length) {
            return JSON.stringify({
              error: `El reporte de ${target.label} salió vacío para ese rango. Dile a la persona que no hay datos en esas fechas y ofrécele otro periodo.`,
            });
          }

          if (buffer.length > MAX_REPORT_BYTES) {
            return JSON.stringify({
              error: `El reporte pesa ${Math.round(buffer.length / 1024 / 1024)} MB, demasiado para entregarlo por el chat. Ofrécele acotar el rango de fechas o descargarlo desde el módulo de Reportes.`,
            });
          }

          const storeId = context.store_id ?? 0;
          const fileName = `${String(args.report)}${
            args.date_from ? `-${args.date_from}` : ''
          }${args.date_to ? `-a-${args.date_to}` : ''}.xlsx`;

          const key = `vexi-reports/stores/${storeId}/${randomUUID()}-${fileName}`;

          await s3.uploadFile(
            buffer,
            key,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          );

          const signedUrl = await s3.getPresignedUrl(key, LINK_TTL_SECONDS);

          return JSON.stringify({
            report: target.label,
            file_name: fileName,
            size_kb: Math.round(buffer.length / 1024),
            download_url: signedUrl,
            expires_in_minutes: Math.round(LINK_TTL_SECONDS / 60),
            note: 'Entrégale el enlace tal cual, di de qué reporte es y avísale que vence en 15 minutos. No describas el contenido: no lo leíste, solo lo generaste.',
          });
        } catch (error: any) {
          logger.warn(
            `get_report(${args.report}) failed: ${error?.message}`,
          );
          return JSON.stringify({
            error: `No pude generar el reporte de ${target.label}: ${error?.message ?? 'error interno'}.`,
          });
        }
      },
    },
  ];
}

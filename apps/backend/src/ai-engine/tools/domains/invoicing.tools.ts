import { HttpException } from '@nestjs/common';
import {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { InvoicingService } from '../../../domains/store/invoicing/invoicing.service';
import { InvoiceFlowService } from '../../../domains/store/invoicing/invoice-flow/invoice-flow.service';
import { DianEventsService } from '../../../domains/store/invoicing/services/dian-events.service';
import { ResolutionsService } from '../../../domains/store/invoicing/resolutions/resolutions.service';
import { DianConfigService } from '../../../domains/store/invoicing/dian-config/dian-config.service';

export interface InvoicingToolDeps {
  invoicingService: InvoicingService;
  invoiceFlowService: InvoiceFlowService;
  dianEventsService: DianEventsService;
  resolutionsService: ResolutionsService;
  dianConfigService: DianConfigService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F (misma que `writes.tools.ts` para el fallo: los
// handlers NO lanzan, devuelven `{error, next_step}` en español; cero
// `prisma.` aquí — toda lectura va al service dueño del scope tenant).
// ─────────────────────────────────────────────────────────────────────────────

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Prisma `Decimal` → número plano. `null`/`undefined` colapsan a `null`. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/** Traduce una excepción del dominio a texto que el modelo pueda narrar. */
function describeReadError(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    if (typeof response === 'string') return response;
    const raw = response?.message;
    return Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

/** Respuesta de fallo de un handler de lectura. Nunca se lanza. */
function readToolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    ...(nextStep && { next_step: nextStep }),
  });
}

/**
 * Cadena habilitante de `send_invoice_dian` (F-30, paso 11), fijada desde ya:
 * ninguna emisión sin pre-vuelo. El modelo la cita antes de proponer emitir.
 */
const EMISSION_CHAIN = {
  send_tool: 'send_invoice_dian (F-30)',
  requires: [
    'get_emit_readiness con emittable=true (F-32)',
    'get_dian_status con emission.is_live=true (F-35)',
    'list_invoice_resolutions con una resolución activa y saldo disponible (F-34)',
    'identidad del emisor responsable del impuesto del documento (assertCanChargeVat)',
  ],
} as const;

export function createInvoicingTools(
  deps: InvoicingToolDeps,
): RegisteredTool[] {
  const {
    invoicingService,
    invoiceFlowService,
    dianEventsService,
    resolutionsService,
    dianConfigService,
  } = deps;

  return [
    // ─── F-28: get_invoice_status ──────────────────────────────────────
    {
      name: 'get_invoice_status',
      version: '1',
      domain: 'invoicing',
      readOnly: true,
      description:
        'Estado de una factura electrónica: número, estado del documento, totales, cliente, resolución usada y eventos DIAN/RADIAN registrados. Requiere invoice_id.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'number',
            description: 'ID de la factura a consultar.',
          },
        },
        required: ['invoice_id'],
      },
      requiredPermissions: ['invoicing:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return readToolError(
            'invoice_id inválido: debe ser un entero positivo.',
            'Revisa el id en el listado de facturas del módulo de facturación.',
          );
        }

        let invoice: any;
        try {
          invoice = await invoicingService.findOne(invoiceId);
        } catch (error) {
          return readToolError(
            `No se pudo leer la factura ${invoiceId}: ${describeReadError(error)}`,
            'Verifica que el id exista en el listado de facturas de esta tienda.',
          );
        }

        let dian_events: any[] = [];
        try {
          dian_events = await dianEventsService.findByInvoice(invoiceId);
        } catch {
          // Los eventos son contexto, no el dato: una factura sin eventos (o
          // con el read fallido) se reporta igual, con la lista vacía.
          dian_events = [];
        }

        const customer = invoice.customer
          ? {
              id: invoice.customer.id ?? null,
              name:
                invoice.customer.legal_name ??
                ([invoice.customer.first_name, invoice.customer.last_name]
                  .filter(Boolean)
                  .join(' ') || null),
              person_type: invoice.customer.person_type ?? null,
              email: invoice.customer.email ?? null,
            }
          : null;

        return JSON.stringify({
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number ?? null,
          document_type: invoice.document_type ?? null,
          status: invoice.status ?? null,
          send_status: invoice.send_status ?? null,
          transmission_status: invoice.transmission_status ?? null,
          issue_date: toIsoDate(invoice.issue_date),
          due_date: toIsoDate(invoice.due_date),
          currency: invoice.currency_code ?? invoice.currency ?? null,
          subtotal: toNumberOrNull(
            invoice.subtotal_amount ?? invoice.subtotal,
          ),
          tax_amount: toNumberOrNull(invoice.tax_amount),
          total_amount: toNumberOrNull(invoice.total_amount),
          cufe: invoice.cufe ?? null,
          cude: invoice.cude ?? null,
          customer,
          resolution: invoice.resolution
            ? {
                id: invoice.resolution.id ?? null,
                resolution_number:
                  invoice.resolution.resolution_number ?? null,
                prefix: invoice.resolution.prefix ?? null,
              }
            : null,
          item_count: Array.isArray(invoice.invoice_items)
            ? invoice.invoice_items.length
            : null,
          retry_status: invoice.retry_status ?? null,
          dian_events: dian_events.map((event: any) => ({
            id: event.id ?? null,
            event_code: event.event_code ?? null,
            event_name: event.event_name ?? event.name ?? null,
            status: event.status ?? null,
            description: event.description ?? null,
            registered_at: toIsoDate(
              event.registered_at ?? event.created_at,
            ),
          })),
        });
      },
    },

    // ─── F-32: get_emit_readiness ──────────────────────────────────────
    {
      name: 'get_emit_readiness',
      version: '1',
      domain: 'invoicing',
      readOnly: true,
      description:
        'Pre-vuelo de emisión de una factura: veredicto emittable con bloqueantes y advertencias, sin cambiar nada ni gastar el consecutivo. Es la primera lectura obligatoria antes de proponer send_invoice_dian (F-30). Requiere invoice_id.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'number',
            description: 'ID de la factura a evaluar.',
          },
        },
        required: ['invoice_id'],
      },
      requiredPermissions: ['invoicing:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return readToolError(
            'invoice_id inválido: debe ser un entero positivo.',
            'Revisa el id en el listado de facturas del módulo de facturación.',
          );
        }

        let report: any;
        try {
          report = await invoiceFlowService.getEmitReadiness(invoiceId);
        } catch (error) {
          return readToolError(
            `No se pudo evaluar la factura ${invoiceId}: ${describeReadError(error)}`,
            'Verifica que el id exista en el listado de facturas de esta tienda.',
          );
        }

        return JSON.stringify({
          invoice_id: report.invoice_id ?? invoiceId,
          invoice_number: report.invoice_number ?? null,
          status: report.status ?? null,
          emittable: report.emittable === true,
          has_items: report.has_items ?? null,
          blockers: report.blockers ?? [],
          warnings: report.warnings ?? [],
          findings: report.findings ?? [],
          identity_emittable: report.identity?.emittable ?? null,
          fiscal_document_emittable:
            report.fiscal_document?.emittable ?? null,
          valid_transitions: report.valid_transitions ?? [],
          discard_route: report.discard_route ?? null,
          emission_chain: EMISSION_CHAIN,
        });
      },
    },

    // ─── F-34: list_invoice_resolutions ────────────────────────────────
    {
      name: 'list_invoice_resolutions',
      version: '1',
      domain: 'invoicing',
      readOnly: true,
      description:
        'Resoluciones de facturación DIAN de la entidad fiscal con su saldo de numeración disponible (remaining). La ClTec nunca viaja: solo se reporta si está cargada y su longitud. Tercera lectura obligatoria antes de proponer send_invoice_dian (F-30).',
      parameters: {
        type: 'object',
        properties: {
          active_only: {
            type: 'boolean',
            description:
              'Si es true, solo resoluciones activas. Por defecto trae todas.',
          },
        },
        required: [],
      },
      requiredPermissions: ['invoicing:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        let rows: any[];
        try {
          rows = await resolutionsService.findAll();
        } catch (error) {
          return readToolError(
            `No se pudieron leer las resoluciones: ${describeReadError(error)}`,
            'Revisa la configuración de facturación electrónica de la tienda.',
          );
        }

        const activeOnly = args.active_only === true;
        const items = (rows ?? [])
          .filter((row) => !activeOnly || row.is_active === true)
          .map((row) => {
            const fromNumber = toNumberOrNull(
              row.from_number ?? row.start_number,
            );
            const toNumber = toNumberOrNull(row.to_number ?? row.end_number);
            const currentNumber = toNumberOrNull(
              row.current_number ?? row.current_consecutive,
            );
            return {
              id: row.id,
              resolution_number: row.resolution_number ?? null,
              prefix: row.prefix ?? null,
              document_type: row.document_type ?? null,
              from_number: fromNumber,
              to_number: toNumber,
              current_number: currentNumber,
              remaining:
                toNumber !== null && currentNumber !== null
                  ? Math.max(toNumber - currentNumber, 0)
                  : null,
              start_date: toIsoDate(row.start_date ?? row.valid_from),
              end_date: toIsoDate(row.end_date ?? row.valid_until),
              is_active: row.is_active ?? null,
              accounting_entity_id: row.accounting_entity_id ?? null,
              technical_key_set: row.technical_key_set ?? null,
              technical_key_length: row.technical_key_length ?? null,
            };
          });

        return JSON.stringify({
          count: items.length,
          resolutions: items,
          emission_chain: EMISSION_CHAIN,
        });
      },
    },

    // ─── F-35: get_dian_status ─────────────────────────────────────────
    {
      name: 'get_dian_status',
      version: '1',
      domain: 'invoicing',
      readOnly: true,
      description:
        'Estado operativo DIAN de la tienda: si está emitiendo en producción ahora mismo (emission.is_live), motivo y bloqueantes cuando no, más actividad reciente y estado del certificado. Segunda lectura obligatoria antes de proponer send_invoice_dian (F-30).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      requiredPermissions: ['invoicing:read'],
      handler: async (_args, _context: ToolExecutionContext) => {
        let dashboard: any;
        let emission: any;
        try {
          [dashboard, emission] = await Promise.all([
            dianConfigService.getDashboard(),
            dianConfigService.getEmissionStatus(),
          ]);
        } catch (error) {
          return readToolError(
            `No se pudo leer el estado DIAN: ${describeReadError(error)}`,
            'Revisa la configuración de facturación electrónica de la tienda.',
          );
        }

        return JSON.stringify({
          emission: {
            is_live: emission?.is_live === true,
            configuration_id: emission?.configuration_id ?? null,
            environment: emission?.environment ?? null,
            enablement_status: emission?.enablement_status ?? null,
            reason: emission?.reason ?? null,
            blockers: emission?.blockers ?? [],
            warnings: emission?.warnings ?? [],
            actionable: emission?.actionable ?? [],
            waiting_on_dian: emission?.waiting_on_dian ?? [],
          },
          activity: {
            stats: dashboard?.stats ?? null,
            certificate_status: dashboard?.certificate_status ?? null,
            configs_summary: dashboard?.configs_summary ?? [],
            recent_submissions: Array.isArray(
              dashboard?.recent_submissions,
            )
              ? dashboard.recent_submissions.slice(0, 5)
              : [],
          },
          emission_chain: EMISSION_CHAIN,
        });
      },
    },
  ];
}

import { HttpException } from '@nestjs/common';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { InvoicingService } from '../../../domains/store/invoicing/invoicing.service';
import { InvoiceFlowService } from '../../../domains/store/invoicing/invoice-flow/invoice-flow.service';
import { DianEventsService } from '../../../domains/store/invoicing/services/dian-events.service';
import { ResolutionsService } from '../../../domains/store/invoicing/resolutions/resolutions.service';
import { DianConfigService } from '../../../domains/store/invoicing/dian-config/dian-config.service';
import { ManualCertificateIssuerAdapter } from '../../../domains/store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { CertificateValidationResult } from '../../../domains/store/invoicing/dian-config/certificates/certificate-issuer.interface';
import { buildDianCertificateS3Key } from '../../../domains/store/invoicing/dian-config/certificates/certificate-s3-key.util';
import { S3Service } from '../../../common/services/s3.service';
import { resolveDianPartyTaxScheme } from '../../../domains/store/invoicing/providers/dian-direct/constants/dian-tax-codes';
import { toDianTaxLevelCode } from '../../../domains/store/invoicing/providers/dian-direct/constants/dian-tax-level-codes';

export interface InvoicingToolDeps {
  invoicingService: InvoicingService;
  invoiceFlowService: InvoiceFlowService;
  dianEventsService: DianEventsService;
  resolutionsService: ResolutionsService;
  dianConfigService: DianConfigService;
  certificateAdapter: ManualCertificateIssuerAdapter;
  s3Service: S3Service;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F (misma que `writes.tools.ts` para el fallo: los
// handlers NO lanzan, devuelven `{error, next_step}` en español; ninguna
// lectura directa a la base — todo va al service dueño del scope tenant).
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

/** Misma doctrina `{error, next_step}` para los handlers de escritura. */
function writeToolError(message: string, nextStep?: string): string {
  return readToolError(message, nextStep);
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

// ─────────────────────────────────────────────────────────────────────────────
// Paso 11: writes + P1 fiscales. Cada write cita su read habilitante y su
// handler re-verifica las precondiciones del preview, porque el preview es
// proyección, no transacción.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frases de consecuencia de los dominios irreversibles. Espejos literales de
 * `IRREVERSIBLE_DOMAINS` (`capability-registry.service.ts`, verificado en el
 * paso 11: `invoicing` y `dian-config` pertenecen al mapa) — se copian y no
 * se importan para no arrastrar el grafo del bridge a esta familia; la spec
 * pinnea la igualdad con el mapa para que no diverjan en silencio.
 */
const INVOICING_IRREVERSIBLE_PHRASE =
  'Un documento electrónico emitido ante la DIAN no se puede deshacer: corregirlo exige una nota crédito con su propia numeración.';
const DIAN_CONFIG_IRREVERSIBLE_PHRASE =
  'Cambiar la configuración de facturación electrónica afecta todos los documentos que se emitan después.';
const FISCAL_WIZARD_CTA = '/admin/fiscal/wizard';

/** Nombre humano del adquiriente para sujetos de preview. */
function customerDisplayName(invoice: any): string {
  const customer = invoice?.customer;
  if (!customer) return 'consumidor final';
  return (
    customer.legal_name ??
    ([customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
      null) ??
    customer.email ??
    'consumidor final'
  );
}

/** «factura FV-001 de Comercial Andina»: sujeto humano del preview. */
function invoiceSubject(invoice: any): string {
  const number = invoice?.invoice_number ?? `#${invoice?.id ?? '?'}`;
  return `factura ${number} de ${customerDisplayName(invoice)}`;
}

/** Saldo de numeración (misma matemática que F-34). */
function resolutionRemaining(row: any): number | null {
  const toNumber = toNumberOrNull(row?.to_number ?? row?.end_number);
  const currentNumber = toNumberOrNull(
    row?.current_number ?? row?.current_consecutive,
  );
  if (toNumber === null || currentNumber === null) return null;
  return Math.max(toNumber - currentNumber, 0);
}

/** Acción de F-31 → estado destino del flujo. */
const ACCEPT_INVOICE_TARGETS = {
  accept: 'accepted',
  reject: 'rejected',
  cancel: 'cancelled',
  void: 'voided',
} as const;

type AcceptInvoiceAction = keyof typeof ACCEPT_INVOICE_TARGETS;

const ACCEPT_INVOICE_LABELS: Record<AcceptInvoiceAction, string> = {
  accept: 'Aceptar',
  reject: 'Rechazar',
  cancel: 'Cancelar',
  void: 'Anular',
};

/**
 * Las salidas de cada estado NO se espejan aquí: el preview y el handler de
 * F-31 preguntan a `invoiceFlowService.getValidTransitions(status)`, que lee
 * el `VALID_TRANSITIONS` dueño en `invoice-flow.service.ts`. El servicio
 * re-valida al aplicar (`validateTransition` lanza); la consulta previa solo
 * evita proponer una transición que ya se sabe imposible.
 */

/** `notes` cabe en `/Invoice/cbc:Note` (FAD13, 1-500). */
const INVOICE_NOTE_MAX_LENGTH = 500;

/** Techo del .p12 en base64 ya decodificado (un certificado real pesa KBs). */
const CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024;

function decodeP12Base64(raw: unknown): Buffer | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/\s+/g, '');
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  try {
    const buffer = Buffer.from(compact, 'base64');
    if (!buffer.length || buffer.length > CERTIFICATE_MAX_BYTES) return null;
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Traduce el `error` de `validateCertificate` al mensaje que el controlador
 * HTTP mapea a códigos DIAN_CERT_* (misma clasificación, sin importar códigos).
 */
function describeCertificateError(error: unknown): string {
  const text = typeof error === 'string' ? error : '';
  if (text.includes('tax identifier')) {
    return 'el certificado no pertenece al NIT de esta configuración (DIAN_CERT_004)';
  }
  if (text.includes('expired')) {
    return 'el certificado está vencido (DIAN_CERT_003)';
  }
  if (text.includes('password')) {
    return 'la contraseña no abre este certificado (DIAN_CERT_002)';
  }
  return text || 'el archivo no es un .p12 válido (DIAN_CERT_001)';
}

function projectCertificateInfo(validation: CertificateValidationResult) {
  return {
    subject: validation.subject ?? null,
    issuer: validation.issuer ?? null,
    expires: toIsoDate(validation.expires),
    fingerprint: validation.fingerprint ?? null,
    serial_number: validation.serial_number ?? null,
    tax_id: validation.tax_id ?? null,
  };
}

export function createInvoicingTools(
  deps: InvoicingToolDeps,
): RegisteredTool[] {
  const {
    invoicingService,
    invoiceFlowService,
    dianEventsService,
    resolutionsService,
    dianConfigService,
    certificateAdapter,
    s3Service,
  } = deps;

  /**
   * Cadena habilitante de F-30, resuelta de frente y en orden determinista:
   * estado → readiness (F-32) → identidad del emisor (O-48) → DIAN en vivo
   * (F-35) → resolución con saldo (F-34). La comparten `preview` y `handler`
   * para que la re-verificación sea la misma comprobación, no una parecida.
   */
  async function resolveEmissionGate(
    invoiceId: number,
  ): Promise<
    | {
        ok: true;
        invoice: any;
        readiness: any;
        gate: any;
        emission: any;
        resolution: any;
        remaining: number;
        is_resend: boolean;
        issuer_dian: {
          party_tax_scheme: { id: string; name: string };
          tax_level_code: string;
        };
      }
    | { ok: false; message: string; next_step: string }
  > {
    let invoice: any;
    try {
      invoice = await invoicingService.findOne(invoiceId);
    } catch (error) {
      return {
        ok: false,
        message: `No se pudo leer la factura ${invoiceId}: ${describeReadError(error)}`,
        next_step:
          'Verifica que el id exista con get_invoice_status (F-28) en esta tienda.',
      };
    }

    const status = invoice?.status;
    const is_resend = status === 'rejected';
    if (status !== 'validated' && !is_resend) {
      const guidance =
        status === 'draft'
          ? 'Valídala primero con validate_invoice (F-29).'
          : status === 'sent'
            ? 'Ya está enviada: consulta su estado con get_invoice_status (F-28) o resuélvela con accept_invoice (F-31).'
            : status === 'accepted'
              ? 'Ya fue aceptada por la DIAN: no se reenvía, se corrige con una nota crédito.'
              : 'Está en estado terminal y no admite emisión.';
      return {
        ok: false,
        message: `La factura ${invoiceId} está en estado '${status ?? 'desconocido'}': solo se emite desde validated (o rejected como reenvío).`,
        next_step: guidance,
      };
    }

    let readiness: any;
    try {
      readiness = await invoiceFlowService.getEmitReadiness(invoiceId);
    } catch (error) {
      return {
        ok: false,
        message: `No se pudo evaluar la factura ${invoiceId}: ${describeReadError(error)}`,
        next_step: 'Revisa el pre-vuelo con get_emit_readiness (F-32).',
      };
    }
    if (readiness?.emittable !== true) {
      const blockers: any[] = readiness?.blockers ?? [];
      const first =
        typeof blockers[0] === 'string'
          ? blockers[0]
          : (blockers[0]?.problem ?? blockers[0]?.message ?? null);
      return {
        ok: false,
        message: `La factura ${invoiceId} no es emisible${first ? `: ${first}` : ''}${blockers.length > 1 ? ` (+${blockers.length - 1} bloqueantes más)` : ''}.`,
        next_step:
          'Corrige los bloqueantes que lista get_emit_readiness (F-32) antes de proponer la emisión.',
      };
    }

    let gate: any;
    try {
      gate = await invoiceFlowService.getIssuerEmissionGate(invoiceId);
    } catch (error) {
      return {
        ok: false,
        message: `No se pudo verificar la identidad del emisor: ${describeReadError(error)}`,
        next_step: `Revisa la identidad fiscal del comercio en ${FISCAL_WIZARD_CTA}.`,
      };
    }
    if (gate?.can_emit !== true) {
      return {
        ok: false,
        message: `Sin O-48 nunca emitir: ${gate?.vat_message ?? 'el comercio no es responsable de IVA y el documento lo exige'}.`,
        next_step: `Completa la identidad fiscal del comercio en ${FISCAL_WIZARD_CTA} y vuelve a intentarlo.`,
      };
    }
    // El esquema del emisor sale de los flags resueltos (4 estados, nunca el
    // binario de régimen) y el TaxLevelCode de la casilla 53 declarada: una
    // casilla sin códigos FE colapsa a R-99-PN por diseño, no por defecto.
    const issuer_dian = {
      party_tax_scheme: resolveDianPartyTaxScheme({
        vat_responsible: gate.vat_responsible === true,
        inc_responsible: gate.inc_responsible === true,
      }),
      tax_level_code: toDianTaxLevelCode(gate.tax_responsibilities ?? []),
    };

    let emission: any;
    try {
      emission = await dianConfigService.getEmissionStatus();
    } catch (error) {
      return {
        ok: false,
        message: `No se pudo leer el estado DIAN: ${describeReadError(error)}`,
        next_step: 'Revisa la operación DIAN con get_dian_status (F-35).',
      };
    }
    if (emission?.is_live !== true) {
      return {
        ok: false,
        message: `La DIAN no está en vivo: ${emission?.reason ?? 'sin motivo reportado'}.`,
        next_step:
          'Resuelve los bloqueantes de get_dian_status (F-35) antes de emitir.',
      };
    }

    let rows: any[];
    try {
      rows = await resolutionsService.findAll();
    } catch (error) {
      return {
        ok: false,
        message: `No se pudieron leer las resoluciones: ${describeReadError(error)}`,
        next_step: 'Revisa la numeración con list_invoice_resolutions (F-34).',
      };
    }
    const withSaldo = (rows ?? [])
      .map((row) => ({ row, remaining: resolutionRemaining(row) }))
      .find(
        ({ row, remaining }) =>
          row?.is_active === true && remaining !== null && remaining > 0,
      );
    if (!withSaldo) {
      return {
        ok: false,
        message:
          'Ninguna resolución activa tiene saldo de numeración disponible.',
        next_step:
          'Solicita una nueva resolución ante la DIAN y regístrala; verifica el saldo con list_invoice_resolutions (F-34).',
      };
    }

    return {
      ok: true,
      invoice,
      readiness,
      gate,
      emission,
      resolution: withSaldo.row,
      remaining: withSaldo.remaining as number,
      is_resend,
      issuer_dian,
    };
  }

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

    // ─── F-29: validate_invoice ────────────────────────────────────────
    {
      name: 'validate_invoice',
      version: '1',
      domain: 'invoicing',
      description:
        'Valida un borrador de factura (draft → validated) tras comprobar su pre-vuelo: habilita la emisión con send_invoice_dian (F-30). Lee primero get_invoice_status (F-28) para el estado y get_emit_readiness (F-32) para los bloqueantes. Requiere invoice_id.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'number',
            description: 'ID del borrador a validar.',
          },
        },
        required: ['invoice_id'],
      },
      requiredPermissions: ['invoicing:write'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return {
            status: 'error',
            target: 'Validar factura',
            changes: [],
            message:
              'invoice_id inválido: debe ser un entero positivo. Revisa el id con get_invoice_status (F-28).',
          };
        }
        let invoice: any;
        try {
          invoice = await invoicingService.findOne(invoiceId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Validar factura',
            changes: [],
            message: `No se pudo leer la factura ${invoiceId}: ${describeReadError(error)}. Verifica el id con get_invoice_status (F-28).`,
          };
        }
        if (invoice?.status !== 'draft') {
          return {
            status: 'error',
            target: `Validar ${invoiceSubject(invoice)}`,
            changes: [],
            message: `La factura está en estado '${invoice?.status ?? 'desconocido'}': solo se valida desde draft.`,
          };
        }
        let readiness: any;
        try {
          readiness = await invoiceFlowService.getEmitReadiness(invoiceId);
        } catch (error) {
          return {
            status: 'error',
            target: `Validar ${invoiceSubject(invoice)}`,
            changes: [],
            message: `No se pudo evaluar la factura: ${describeReadError(error)}. Revisa el pre-vuelo con get_emit_readiness (F-32).`,
          };
        }
        if (readiness?.emittable !== true) {
          const count = (readiness?.blockers ?? []).length;
          return {
            status: 'error',
            target: `Validar ${invoiceSubject(invoice)}`,
            changes: [],
            message: `El borrador tiene ${count} bloqueante(s) y no es validable. Corrige lo que lista get_emit_readiness (F-32) antes de proponer la validación.`,
          };
        }
        const warnings: any[] = readiness?.warnings ?? [];
        return {
          status: warnings.length ? 'warning' : 'ok',
          target: `Validar ${invoiceSubject(invoice)}`,
          changes: [
            { field: 'estado', label: 'Estado', from: 'draft', to: 'validated' },
            {
              field: 'efecto',
              label: 'Efecto',
              from: null,
              to: 'habilita la emisión con send_invoice_dian (F-30)',
            },
          ],
          ...(warnings.length
            ? { message: `Advertencias del pre-vuelo: ${warnings.length}.` }
            : {}),
          domain: 'invoicing',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return writeToolError(
            'invoice_id inválido: debe ser un entero positivo.',
            'Revisa el id con get_invoice_status (F-28).',
          );
        }
        let invoice: any;
        try {
          invoice = await invoicingService.findOne(invoiceId);
        } catch (error) {
          return writeToolError(
            `No se pudo leer la factura ${invoiceId}: ${describeReadError(error)}`,
            'Verifica el id con get_invoice_status (F-28).',
          );
        }
        if (invoice?.status !== 'draft') {
          return writeToolError(
            `La factura ${invoiceId} ya no está en borrador (estado '${invoice?.status ?? 'desconocido'}').`,
            'Lee su estado actual con get_invoice_status (F-28).',
          );
        }
        let readiness: any;
        try {
          readiness = await invoiceFlowService.getEmitReadiness(invoiceId);
        } catch (error) {
          return writeToolError(
            `No se pudo re-verificar la factura ${invoiceId}: ${describeReadError(error)}`,
            'Revisa el pre-vuelo con get_emit_readiness (F-32).',
          );
        }
        if (readiness?.emittable !== true) {
          return writeToolError(
            `La factura ${invoiceId} dejó de ser validable desde el preview.`,
            'Revisa los bloqueantes con get_emit_readiness (F-32).',
          );
        }
        let validated: any;
        try {
          validated = await invoiceFlowService.validate(invoiceId);
        } catch (error) {
          return writeToolError(
            `No se pudo validar la factura ${invoiceId}: ${describeReadError(error)}`,
            'Revisa los bloqueantes con get_emit_readiness (F-32).',
          );
        }
        return JSON.stringify({
          invoice_id: validated?.id ?? invoiceId,
          invoice_number: validated?.invoice_number ?? null,
          status: validated?.status ?? 'validated',
          total_amount: toNumberOrNull(validated?.total_amount),
          enables: 'send_invoice_dian (F-30)',
        });
      },
    },

    // ─── F-30: send_invoice_dian ───────────────────────────────────────
    {
      name: 'send_invoice_dian',
      version: '1',
      domain: 'invoicing',
      description:
        'IRREVERSIBLE: transmite una factura validada a la DIAN y gasta su consecutivo (validated → sent; rejected → sent como reenvío). La cadena habilitante se verifica antes de proponer: get_emit_readiness (F-32) emisible, emisor con O-48 (sin O-48 nunca emitir), get_dian_status (F-35) en vivo y resolución con saldo (F-34). Requiere invoice_id.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'number',
            description: 'ID de la factura validada a emitir.',
          },
        },
        required: ['invoice_id'],
      },
      requiredPermissions: ['invoicing:write'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return {
            status: 'error',
            target: 'Emitir factura ante la DIAN',
            changes: [],
            message:
              'invoice_id inválido: debe ser un entero positivo. Revisa el id con get_invoice_status (F-28).',
          };
        }
        const gate = await resolveEmissionGate(invoiceId);
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Emitir factura ante la DIAN',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        const scheme = gate.issuer_dian.party_tax_scheme;
        return {
          status: 'warning',
          target: `Emitir ${invoiceSubject(gate.invoice)} ante la DIAN${gate.is_resend ? ' (reenvío de un rechazo)' : ''}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: gate.invoice.status,
              to: 'sent',
            },
            {
              field: 'consecutivo',
              label: 'Consecutivo DIAN',
              from: 'reservado',
              to: `gastado (resolución ${gate.resolution.resolution_number ?? gate.resolution.prefix ?? `#${gate.resolution.id}`} · saldo ${gate.remaining})`,
            },
            {
              field: 'esquema_emisor',
              label: 'Esquema del emisor',
              from: null,
              to: `${scheme.id} · ${scheme.name}`,
            },
            {
              field: 'tax_level_code',
              label: 'TaxLevelCode',
              from: null,
              to: gate.issuer_dian.tax_level_code,
            },
          ],
          message: `${INVOICING_IRREVERSIBLE_PHRASE} Cadena verificada: F-32 emisible + emisor responsable + F-35 en vivo + F-34 con saldo.${gate.is_resend ? ' Es un reenvío: el primer rechazo ya dejó un hueco en la numeración.' : ''}`,
          domain: 'invoicing',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return writeToolError(
            'invoice_id inválido: debe ser un entero positivo.',
            'Revisa el id con get_invoice_status (F-28).',
          );
        }
        const gate = await resolveEmissionGate(invoiceId);
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        let sent: any;
        try {
          sent = await invoiceFlowService.send(invoiceId);
        } catch (error) {
          return writeToolError(
            `No se pudo emitir la factura ${invoiceId}: ${describeReadError(error)}`,
            'Revisa el estado actual con get_invoice_status (F-28); si la DIAN la rechazó, corrige y reenvía.',
          );
        }
        return JSON.stringify({
          invoice_id: sent?.id ?? invoiceId,
          invoice_number: sent?.invoice_number ?? null,
          status: sent?.status ?? 'sent',
          send_status: sent?.send_status ?? null,
          transmission_status: sent?.transmission_status ?? null,
          cufe: sent?.cufe ?? sent?.cude ?? null,
          is_resend: gate.is_resend,
          issuer_dian: gate.issuer_dian,
          resolution_used: {
            id: gate.resolution.id ?? null,
            resolution_number: gate.resolution.resolution_number ?? null,
            prefix: gate.resolution.prefix ?? null,
            remaining_before: gate.remaining,
          },
          emission_chain: EMISSION_CHAIN,
        });
      },
    },

    // ─── F-31: accept_invoice ──────────────────────────────────────────
    {
      name: 'accept_invoice',
      version: '1',
      domain: 'invoicing',
      description:
        'Resuelve una factura enviada o descarta un documento: accept/reject sobre sent, cancel sobre draft/validated, void sobre rejected. Un documento aceptado por la DIAN no se toca: se corrige con nota crédito. La nota opcional solo se adhiere en borrador (máx 500 caracteres). Lee primero get_invoice_status (F-28). Requiere invoice_id y action.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'number',
            description: 'ID de la factura a resolver.',
          },
          action: {
            type: 'string',
            enum: ['accept', 'reject', 'cancel', 'void'],
            description:
              'accept: acepta una enviada (dispara asientos). reject: rechaza una enviada (admite reenvío). cancel: descarta sin transmitir (gasta el consecutivo). void: anula una rechazada por la DIAN.',
          },
          note: {
            type: 'string',
            description:
              'Nota opcional (máx 500 caracteres). Solo se puede adherir sobre un borrador; un documento emitido se corrige con nota crédito.',
          },
        },
        required: ['invoice_id', 'action'],
      },
      requiredPermissions: ['invoicing:write'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return {
            status: 'error',
            target: 'Resolver factura',
            changes: [],
            message:
              'invoice_id inválido: debe ser un entero positivo. Revisa el id con get_invoice_status (F-28).',
          };
        }
        const action = args.action as AcceptInvoiceAction;
        if (!(action in ACCEPT_INVOICE_TARGETS)) {
          return {
            status: 'error',
            target: 'Resolver factura',
            changes: [],
            message:
              'action inválida: usa accept, reject, cancel o void según el estado que muestra get_invoice_status (F-28).',
          };
        }
        const note =
          typeof args.note === 'string' && args.note.trim()
            ? args.note.trim()
            : null;
        if (note && note.length > INVOICE_NOTE_MAX_LENGTH) {
          return {
            status: 'error',
            target: 'Resolver factura',
            changes: [],
            message: `La nota excede ${INVOICE_NOTE_MAX_LENGTH} caracteres (límite del documento fiscal). Acórtala antes de proponer.`,
          };
        }
        let invoice: any;
        try {
          invoice = await invoicingService.findOne(invoiceId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Resolver factura',
            changes: [],
            message: `No se pudo leer la factura ${invoiceId}: ${describeReadError(error)}. Verifica el id con get_invoice_status (F-28).`,
          };
        }
        const target = ACCEPT_INVOICE_TARGETS[action];
        const exits = invoiceFlowService.getValidTransitions(
          invoice?.status ?? '',
        );
        if (!exits.includes(target)) {
          const hint =
            invoice?.status === 'accepted'
              ? 'Un documento aceptado por la DIAN no se anula ni se rechaza: se corrige con una nota crédito.'
              : `Desde '${invoice?.status ?? 'desconocido'}' no se puede '${target}'.`;
          return {
            status: 'error',
            target: `${ACCEPT_INVOICE_LABELS[action]} ${invoiceSubject(invoice)}`,
            changes: [],
            message: `${hint} Revisa las acciones disponibles con get_invoice_status (F-28).`,
          };
        }
        if (note && invoice?.status !== 'draft') {
          return {
            status: 'error',
            target: `${ACCEPT_INVOICE_LABELS[action]} ${invoiceSubject(invoice)}`,
            changes: [],
            message:
              'La nota solo se adhiere sobre un borrador: el documento ya tiene efectos fiscales y su vía de corrección es la nota crédito. Reintenta sin note.',
          };
        }
        const changes: ToolPreview['changes'] = [
          {
            field: 'estado',
            label: 'Estado',
            from: invoice.status,
            to: target,
          },
        ];
        if (note) {
          changes.push({
            field: 'nota',
            label: 'Nota adherida',
            from: invoice.notes ?? null,
            to: note,
          });
        }
        const consequence =
          action === 'void' || action === 'cancel'
            ? ` ${INVOICING_IRREVERSIBLE_PHRASE} El consecutivo queda como hueco irrecuperable en la numeración autorizada.`
            : action === 'accept'
              ? ' Al aceptar se emiten los asientos contables de la venta.'
              : ' Al rechazar, el documento admite reenvío con send_invoice_dian (F-30).';
        return {
          status: action === 'void' || action === 'cancel' ? 'warning' : 'ok',
          target: `${ACCEPT_INVOICE_LABELS[action]} ${invoiceSubject(invoice)}`,
          changes,
          message: `${ACCEPT_INVOICE_LABELS[action]} la factura ${invoice?.invoice_number ?? `#${invoiceId}`}.${consequence}`,
          domain: 'invoicing',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return writeToolError(
            'invoice_id inválido: debe ser un entero positivo.',
            'Revisa el id con get_invoice_status (F-28).',
          );
        }
        const action = args.action as AcceptInvoiceAction;
        if (!(action in ACCEPT_INVOICE_TARGETS)) {
          return writeToolError(
            'action inválida: usa accept, reject, cancel o void.',
            'Revisa el estado con get_invoice_status (F-28).',
          );
        }
        const note =
          typeof args.note === 'string' && args.note.trim()
            ? args.note.trim()
            : null;
        if (note && note.length > INVOICE_NOTE_MAX_LENGTH) {
          return writeToolError(
            `La nota excede ${INVOICE_NOTE_MAX_LENGTH} caracteres.`,
            'Acorta la nota al límite del documento fiscal.',
          );
        }
        let invoice: any;
        try {
          invoice = await invoicingService.findOne(invoiceId);
        } catch (error) {
          return writeToolError(
            `No se pudo leer la factura ${invoiceId}: ${describeReadError(error)}`,
            'Verifica el id con get_invoice_status (F-28).',
          );
        }
        const target = ACCEPT_INVOICE_TARGETS[action];
        const exits = invoiceFlowService.getValidTransitions(
          invoice?.status ?? '',
        );
        if (!exits.includes(target)) {
          return writeToolError(
            `La factura ${invoiceId} está en '${invoice?.status ?? 'desconocido'}' y ya no admite '${target}'.`,
            'Lee las acciones disponibles con get_invoice_status (F-28).',
          );
        }
        if (note) {
          if (invoice?.status !== 'draft') {
            return writeToolError(
              'La nota solo se adhiere sobre un borrador y el documento ya avanzó.',
              'Reintenta la transición sin note; lo emitido se corrige con nota crédito.',
            );
          }
          try {
            await invoicingService.update(invoiceId, { notes: note } as any);
          } catch (error) {
            return writeToolError(
              `No se pudo adherir la nota: ${describeReadError(error)}`,
              'Reintenta la transición sin note o revisa el borrador.',
            );
          }
        }
        let updated: any;
        try {
          updated = await invoiceFlowService[action](invoiceId);
        } catch (error) {
          return writeToolError(
            `No se pudo ${target} la factura ${invoiceId}: ${describeReadError(error)}`,
            'Revisa el estado actual con get_invoice_status (F-28).',
          );
        }
        return JSON.stringify({
          invoice_id: updated?.id ?? invoiceId,
          invoice_number: updated?.invoice_number ?? null,
          action,
          status: updated?.status ?? target,
          note_attached: note !== null,
        });
      },
    },

    // ─── F-33: create_invoice_from_order ───────────────────────────────
    {
      name: 'create_invoice_from_order',
      version: '1',
      domain: 'invoicing',
      irreversible: true,
      description:
        'Crea el borrador de factura de una orden de venta (excluye líneas canceladas para no romper la igualdad fiscal). Lee primero get_order para el estado de la orden; tras crear, el pre-vuelo es get_emit_readiness (F-32). Requiere order_id.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description: 'ID de la orden de venta a facturar.',
          },
        },
        required: ['order_id'],
      },
      requiredPermissions: ['invoicing:write'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const orderId = toPositiveInt(args.order_id);
        if (!orderId) {
          return {
            status: 'error',
            target: 'Facturar orden',
            changes: [],
            message:
              'order_id inválido: debe ser un entero positivo. Obténlo con find_order y revisa la orden con get_order.',
          };
        }
        return {
          status: 'ok',
          target: `Factura borrador desde la orden #${orderId}`,
          changes: [
            {
              field: 'documento',
              label: 'Documento',
              from: null,
              to: 'factura en borrador (draft)',
            },
            {
              field: 'lineas',
              label: 'Líneas',
              from: null,
              to: 'ítems no cancelados de la orden, con sus impuestos tipados',
            },
          ],
          message:
            'La orden debe existir y no estar ya facturada (el servicio lo verifica al aplicar). Tras crear, evalúa el borrador con get_emit_readiness (F-32).',
          domain: 'invoicing',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const orderId = toPositiveInt(args.order_id);
        if (!orderId) {
          return writeToolError(
            'order_id inválido: debe ser un entero positivo.',
            'Obtén el id con find_order.',
          );
        }
        let created: any;
        try {
          created = await invoicingService.createFromOrder(orderId);
        } catch (error) {
          return writeToolError(
            `No se pudo facturar la orden ${orderId}: ${describeReadError(error)}`,
            'Verifica con get_order que la orden exista y no esté ya facturada.',
          );
        }
        return JSON.stringify({
          invoice_id: created?.id ?? null,
          invoice_number: created?.invoice_number ?? null,
          status: created?.status ?? 'draft',
          order_id: orderId,
          subtotal: toNumberOrNull(
            created?.subtotal_amount ?? created?.subtotal,
          ),
          tax_amount: toNumberOrNull(created?.tax_amount),
          total_amount: toNumberOrNull(created?.total_amount),
          next_step: 'Evalúa el borrador con get_emit_readiness (F-32).',
        });
      },
    },

    // ─── F-36: get_production_readiness ────────────────────────────────
    {
      name: 'get_production_readiness',
      version: '1',
      domain: 'invoicing',
      readOnly: true,
      description:
        'Checklist de paso a producción de una configuración DIAN: veredicto ready, requisitos faltantes (missing) y resoluciones evaluadas. La clave técnica nunca viaja (solo su unicidad evaluada). Es la lectura habilitante de promote_dian_to_production (F-37). Requiere config_id.',
      parameters: {
        type: 'object',
        properties: {
          config_id: {
            type: 'number',
            description: 'ID de la configuración DIAN a evaluar.',
          },
        },
        required: ['config_id'],
      },
      requiredPermissions: ['invoicing:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const configId = toPositiveInt(args.config_id);
        if (!configId) {
          return readToolError(
            'config_id inválido: debe ser un entero positivo.',
            'Revisa las configuraciones en el módulo de facturación electrónica.',
          );
        }
        let report: any;
        try {
          report = await dianConfigService.getProductionReadiness(configId);
        } catch (error) {
          return readToolError(
            `No se pudo evaluar la configuración ${configId}: ${describeReadError(error)}`,
            'Verifica que la configuración exista en esta tienda.',
          );
        }
        return JSON.stringify({
          config_id: configId,
          environment: report?.environment ?? null,
          enablement_status: report?.enablement_status ?? null,
          ready: report?.ready === true,
          missing: report?.missing ?? [],
          checks: report?.checks ?? [],
          warnings: report?.warnings ?? [],
          actionable: report?.actionable ?? [],
          waiting_on_dian: report?.waiting_on_dian ?? [],
          resolutions: (report?.resolutions ?? []).map((row: any) => ({
            id: row.id ?? null,
            prefix: row.prefix ?? null,
            resolution_number: row.resolution_number ?? null,
            range_from: toNumberOrNull(row.range_from),
            range_to: toNumberOrNull(row.range_to),
            current_number: toNumberOrNull(row.current_number),
            valid_from: toIsoDate(row.valid_from),
            valid_to: toIsoDate(row.valid_to),
            is_habilitacion_range: row.is_habilitacion_range ?? null,
            is_expired: row.is_expired ?? null,
            is_exhausted: row.is_exhausted ?? null,
          })),
          enables: 'promote_dian_to_production (F-37)',
        });
      },
    },

    // ─── F-37: promote_dian_to_production ──────────────────────────────
    {
      name: 'promote_dian_to_production',
      version: '1',
      domain: 'invoicing',
      irreversible: true,
      description:
        'IRREVERSIBLE: pasa una configuración DIAN de habilitación a producción (environment=production, enablement_status=enabled). El servicio exige el checklist completo: lee primero get_production_readiness (F-36) y get_dian_status (F-35). Requiere config_id.',
      parameters: {
        type: 'object',
        properties: {
          config_id: {
            type: 'number',
            description: 'ID de la configuración DIAN a promover.',
          },
        },
        required: ['config_id'],
      },
      requiredPermissions: ['invoicing:write'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const configId = toPositiveInt(args.config_id);
        if (!configId) {
          return {
            status: 'error',
            target: 'Promover DIAN a producción',
            changes: [],
            message:
              'config_id inválido: debe ser un entero positivo. Revisa las configuraciones en el módulo de facturación electrónica.',
          };
        }
        let report: any;
        try {
          report = await dianConfigService.getProductionReadiness(configId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Promover DIAN a producción',
            changes: [],
            message: `No se pudo evaluar la configuración ${configId}: ${describeReadError(error)}. Verifica con get_production_readiness (F-36).`,
          };
        }
        if (report?.ready !== true) {
          const missing: string[] = report?.missing ?? [];
          return {
            status: 'error',
            target: `Promover la configuración DIAN #${configId} a producción`,
            changes: [],
            message: `Faltan ${missing.length} requisito(s): ${missing.join(', ') || 'ver el checklist'}. Complétalos (get_production_readiness F-36) antes de proponer la promoción.`,
          };
        }
        return {
          status: 'warning',
          target: `Promover la configuración DIAN #${configId} a producción`,
          changes: [
            {
              field: 'environment',
              label: 'Ambiente',
              from: report?.environment ?? 'habilitación',
              to: 'production',
            },
            {
              field: 'enablement_status',
              label: 'Estado de habilitación',
              from: report?.enablement_status ?? null,
              to: 'enabled',
            },
          ],
          message: `${DIAN_CONFIG_IRREVERSIBLE_PHRASE} Checklist F-36 completo y F-35 en vivo verificados.`,
          domain: 'invoicing',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const configId = toPositiveInt(args.config_id);
        if (!configId) {
          return writeToolError(
            'config_id inválido: debe ser un entero positivo.',
            'Revisa las configuraciones en el módulo de facturación electrónica.',
          );
        }
        let report: any;
        try {
          report = await dianConfigService.getProductionReadiness(configId);
        } catch (error) {
          return writeToolError(
            `No se pudo re-verificar la configuración ${configId}: ${describeReadError(error)}`,
            'Revisa el checklist con get_production_readiness (F-36).',
          );
        }
        if (report?.ready !== true) {
          return writeToolError(
            `La configuración ${configId} dejó de estar lista: faltan ${(report?.missing ?? []).join(', ') || 'requisitos'}.`,
            'Completa el checklist con get_production_readiness (F-36).',
          );
        }
        let updated: any;
        try {
          updated = await dianConfigService.promoteToProduction(configId);
        } catch (error) {
          return writeToolError(
            `No se pudo promover la configuración ${configId}: ${describeReadError(error)}`,
            'Revisa el checklist con get_production_readiness (F-36).',
          );
        }
        return JSON.stringify({
          config_id: updated?.id ?? configId,
          environment: updated?.environment ?? 'production',
          enablement_status: updated?.enablement_status ?? 'enabled',
          enabled_at: toIsoDate(updated?.enabled_at),
        });
      },
    },

    // ─── F-38: upload_dian_certificate ─────────────────────────────────
    {
      name: 'upload_dian_certificate',
      version: '1',
      domain: 'invoicing',
      irreversible: true,
      description:
        'Sube y activa el certificado digital .p12 que firma los documentos DIAN de una configuración: valida el archivo (NIT, vigencia, contraseña) antes de guardar nada. La contraseña y el archivo nunca se devuelven ni se narran. Lee primero get_dian_status (F-35) para el estado del certificado actual. Requiere config_id, p12_base64 y password.',
      parameters: {
        type: 'object',
        properties: {
          config_id: {
            type: 'number',
            description: 'ID de la configuración DIAN que firmará con este certificado.',
          },
          p12_base64: {
            type: 'string',
            description:
              'Contenido del archivo .p12 en base64 (máx 5 MB decodificado).',
          },
          password: {
            type: 'string',
            description:
              'Contraseña que abre el .p12. Se usa solo para validar y cifrar; jamás se devuelve.',
          },
        },
        required: ['config_id', 'p12_base64', 'password'],
      },
      requiredPermissions: ['invoicing:write'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const configId = toPositiveInt(args.config_id);
        if (!configId) {
          return {
            status: 'error',
            target: 'Subir certificado DIAN',
            changes: [],
            message:
              'config_id inválido: debe ser un entero positivo. Revisa las configuraciones en el módulo de facturación electrónica.',
          };
        }
        if (
          typeof args.password !== 'string' ||
          !args.password.trim()
        ) {
          return {
            status: 'error',
            target: 'Subir certificado DIAN',
            changes: [],
            message:
              'password es obligatoria: sin ella no se puede validar el certificado (DIAN_CERT_002).',
          };
        }
        const p12 = decodeP12Base64(args.p12_base64);
        if (!p12) {
          return {
            status: 'error',
            target: 'Subir certificado DIAN',
            changes: [],
            message:
              'p12_base64 inválido: debe ser un base64 no vacío de máximo 5 MB con el contenido del .p12.',
          };
        }
        let config: any;
        try {
          config = await dianConfigService.getConfigById(configId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Subir certificado DIAN',
            changes: [],
            message: `No se pudo leer la configuración ${configId}: ${describeReadError(error)}. Verifica con get_dian_status (F-35).`,
          };
        }
        let validation: CertificateValidationResult;
        try {
          validation = await certificateAdapter.validateCertificate({
            p12_buffer: p12,
            password: args.password,
            expected_tax_id: config?.nit ?? null,
            expected_dv: config?.nit_dv ?? null,
          });
        } catch (error) {
          return {
            status: 'error',
            target: `Subir certificado DIAN (configuración #${configId})`,
            changes: [],
            message: `No se pudo validar el certificado: ${describeReadError(error)}.`,
          };
        }
        if (!validation?.valid) {
          return {
            status: 'error',
            target: `Subir certificado DIAN (configuración #${configId})`,
            changes: [],
            message: `El certificado no es usable: ${describeCertificateError(validation?.error)}. Consigue el .p12 correcto antes de proponer.`,
          };
        }
        const info = projectCertificateInfo(validation);
        return {
          status: 'warning',
          target: `Subir certificado DIAN de ${config?.nit ? `NIT ${config.nit}` : `la configuración #${configId}`}`,
          changes: [
            {
              field: 'certificado',
              label: 'Certificado firmante',
              from: 'actual',
              to: `${info.subject ?? 'sujeto no reportado'} (vence ${info.expires ?? 'fecha no reportada'})`,
            },
            {
              field: 'huella',
              label: 'Huella digital',
              from: null,
              to: info.fingerprint,
            },
          ],
          message:
            'El certificado validado reemplaza al actual como firmante de todos los documentos que se emitan después.',
          domain: 'invoicing',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const configId = toPositiveInt(args.config_id);
        if (!configId) {
          return writeToolError(
            'config_id inválido: debe ser un entero positivo.',
            'Revisa las configuraciones en el módulo de facturación electrónica.',
          );
        }
        if (typeof args.password !== 'string' || !args.password.trim()) {
          return writeToolError(
            'password es obligatoria: sin ella no se puede validar el certificado.',
            'Pide la contraseña del .p12 e inténtalo de nuevo.',
          );
        }
        const p12 = decodeP12Base64(args.p12_base64);
        if (!p12) {
          return writeToolError(
            'p12_base64 inválido: debe ser un base64 no vacío de máximo 5 MB.',
            'Revisa el archivo .p12 de origen.',
          );
        }
        let config: any;
        try {
          config = await dianConfigService.getConfigById(configId);
        } catch (error) {
          return writeToolError(
            `No se pudo leer la configuración ${configId}: ${describeReadError(error)}`,
            'Verifica con get_dian_status (F-35).',
          );
        }
        let validation: CertificateValidationResult;
        try {
          validation = await certificateAdapter.validateCertificate({
            p12_buffer: p12,
            password: args.password,
            expected_tax_id: config?.nit ?? null,
            expected_dv: config?.nit_dv ?? null,
          });
        } catch (error) {
          return writeToolError(
            `No se pudo re-validar el certificado: ${describeReadError(error)}`,
            'Revisa el archivo .p12 de origen.',
          );
        }
        if (!validation?.valid) {
          return writeToolError(
            `El certificado no es usable: ${describeCertificateError(validation?.error)}`,
            'Consigue el .p12 correcto antes de reintentar.',
          );
        }
        const s3_key = buildDianCertificateS3Key({
          organization_id: config.organization_id,
          store_id: config.store_id ?? null,
          dian_configuration_id: configId,
        });
        try {
          await s3Service.uploadFile(p12, s3_key, 'application/x-pkcs12');
        } catch (error) {
          return writeToolError(
            `No se pudo almacenar el certificado: ${describeReadError(error)}`,
            'Reintenta la subida; el certificado actual sigue activo.',
          );
        }
        let updated: any;
        try {
          updated = await dianConfigService.updateCertificate(
            configId,
            s3_key,
            args.password,
            validation.expires ?? null,
            validation,
          );
        } catch (error) {
          return writeToolError(
            `No se pudo activar el certificado: ${describeReadError(error)}`,
            'Revisa la configuración con get_dian_status (F-35).',
          );
        }
        return JSON.stringify({
          config_id: updated?.id ?? configId,
          certificate_source: updated?.certificate_source ?? null,
          certificate_uploaded_at: toIsoDate(updated?.certificate_uploaded_at),
          certificate: projectCertificateInfo(validation),
        });
      },
    },
  ];
}

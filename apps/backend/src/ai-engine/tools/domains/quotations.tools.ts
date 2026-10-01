import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { QuotationsService } from '../../../domains/store/quotations/quotations.service';

/**
 * Familia quotations de Vex (paso 8 del plan vex-agent).
 *
 * Wrappers finos sobre `QuotationsService`; sin SQL directo. El scope tenant
 * lo resuelve el servicio (StorePrismaService).
 *
 * Cadena: list_quotations/get_quotation (lecturas habilitantes) →
 * send_quotation (draft→sent) → accept_quotation (sent→accepted) →
 * convert_quotation_to_order (accepted→converted). Cada handler re-verifica
 * el estado: el preview es proyección, no transacción.
 *
 * Permisos verificados en `quotations.controller.ts`.
 */

export interface QuotationToolDeps {
  quotationsService: QuotationsService;
}

const PERM_READ = 'store:quotations:read';
const PERM_READ_ONE = 'store:quotations:read:one';
const PERM_CREATE = 'store:quotations:create';
const PERM_UPDATE = 'store:quotations:update';
const PERM_CONVERT = 'store:quotations:convert';

const QUOTATION_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
  'contracted',
  'cancelled',
] as const;

function describeError(error: any): string {
  const detail = error?.response?.message ?? error?.message ?? String(error);
  return Array.isArray(detail) ? detail.join('; ') : String(detail);
}

const guard =
  (
    fn: (
      args: Record<string, any>,
      context: ToolExecutionContext,
    ) => Promise<Record<string, any>>,
  ) =>
  async (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<string> => {
    try {
      return JSON.stringify(await fn(args ?? {}, context));
    } catch (error: any) {
      return JSON.stringify({ error: describeError(error) });
    }
  };

function previewError(
  target: string,
  message: string,
  domain = 'quotations',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function clampLimit(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function quotationLabel(q: Record<string, any>): string {
  return String(
    q.quotation_number ?? (q.id !== undefined ? `#${q.id}` : 'cotización'),
  );
}

function normalizeItems(items: unknown): {
  ok: boolean;
  message?: string;
  value?: Array<Record<string, any>>;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: 'items debe ser un arreglo no vacío.' };
  }
  for (const [i, raw] of items.entries()) {
    const line = (raw ?? {}) as Record<string, any>;
    if (!line.product_name || !String(line.product_name).trim()) {
      return {
        ok: false,
        message: `items[${i}].product_name es obligatorio.`,
      };
    }
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        ok: false,
        message: `items[${i}].quantity debe ser un entero mayor que cero.`,
      };
    }
    const unit_price = Number(line.unit_price);
    const total_price = Number(line.total_price);
    if (!Number.isFinite(unit_price) || !Number.isFinite(total_price)) {
      return {
        ok: false,
        message: `items[${i}] exige unit_price y total_price numéricos.`,
      };
    }
    if (line.tax_rate !== undefined) {
      const rate = Number(line.tax_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        return {
          ok: false,
          message: `items[${i}].tax_rate se expresa como fracción (0.19 para 19%, máximo 1).`,
        };
      }
    }
  }
  return { ok: true, value: items as Array<Record<string, any>> };
}

export function createQuotationTools(
  deps: QuotationToolDeps,
): RegisteredTool[] {
  async function loadQuotation(
    id: number,
  ): Promise<Record<string, any> | null> {
    try {
      const found = await deps.quotationsService.findOne(id);
      return (found ?? null) as unknown as Record<string, any> | null;
    } catch {
      return null;
    }
  }

  return [
    // ─── list_quotations (READ) ──────────────────────────────────
    {
      name: 'list_quotations',
      version: '1',
      domain: 'quotations',
      readOnly: true,
      description:
        'Lista cotizaciones con filtros opcionales (search, status, customer_id, date_from/date_to) y paginación (page, limit máx 100). Úsala para "qué cotizaciones hay pendientes" o como lectura habilitante antes de proponer send/accept/convert.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Texto a buscar (número, notas).',
          },
          status: {
            type: 'string',
            enum: [...QUOTATION_STATUSES],
            description: 'Estado de la cotización.',
          },
          customer_id: { type: 'number', description: 'ID del cliente.' },
          date_from: {
            type: 'string',
            description: 'Desde (YYYY-MM-DD). Requiere date_to.',
          },
          date_to: { type: 'string', description: 'Hasta (YYYY-MM-DD).' },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máx 100).',
          },
        },
      },
      requiredPermissions: [PERM_READ],
      handler: guard(async (args) => {
        const query: Record<string, any> = {
          page: clampPage(args.page),
          limit: clampLimit(args.limit),
        };
        if (typeof args.search === 'string' && args.search.trim()) {
          query.search = args.search.trim();
        }
        if (
          typeof args.status === 'string' &&
          (QUOTATION_STATUSES as readonly string[]).includes(args.status)
        ) {
          query.status = args.status;
        }
        const customer_id = toPositiveInt(args.customer_id);
        if (args.customer_id !== undefined && customer_id === null) {
          return {
            error: `customer_id inválido: ${String(args.customer_id)}.`,
            next_step: 'Pasa el ID numérico del cliente.',
          };
        }
        if (customer_id !== null) query.customer_id = customer_id;
        if (args.date_from !== undefined || args.date_to !== undefined) {
          if (!args.date_from || !args.date_to) {
            return {
              error: 'date_from y date_to viajan juntos.',
              next_step: 'Pasa ambas fechas en formato YYYY-MM-DD.',
            };
          }
          query.date_from = args.date_from;
          query.date_to = args.date_to;
        }
        const result = await deps.quotationsService.findAll(query as any);
        return result as unknown as Record<string, any>;
      }),
    },

    // ─── get_quotation (READ) ────────────────────────────────────
    {
      name: 'get_quotation',
      version: '1',
      domain: 'quotations',
      readOnly: true,
      description:
        'Lee el detalle de una cotización: estado, cliente, líneas, impuestos y totales. Cadena obligatoria antes de send_quotation, accept_quotation y convert_quotation_to_order.',
      parameters: {
        type: 'object',
        properties: {
          quotation_id: {
            type: 'number',
            description: 'ID de la cotización.',
          },
        },
        required: ['quotation_id'],
      },
      requiredPermissions: [PERM_READ_ONE],
      handler: guard(async (args) => {
        const id = toPositiveInt(args.quotation_id);
        if (id === null) {
          return {
            error: `quotation_id inválido: ${String(args.quotation_id)}.`,
            next_step: 'Pasa el ID numérico de la cotización.',
          };
        }
        const found = await deps.quotationsService.findOne(id);
        return found as unknown as Record<string, any>;
      }),
    },

    // ─── create_quotation (WRITE) ────────────────────────────────
    {
      name: 'create_quotation',
      version: '1',
      domain: 'quotations',
      description:
        'Crea una cotización en estado draft con sus líneas (product_name, quantity, unit_price, total_price por línea; tax_rate como fracción, ej. 0.19). Nace como draft y fluye con send_quotation → accept_quotation → convert_quotation_to_order.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'number',
            description: 'ID del cliente (opcional).',
          },
          items: {
            type: 'array',
            description:
              'Líneas de la cotización: product_name, quantity, unit_price, total_price; opcionales product_id, product_variant_id, discount_amount, tax_rate (fracción), notes.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                product_name: { type: 'string' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                discount_amount: { type: 'number' },
                tax_rate: { type: 'number' },
                total_price: { type: 'number' },
                notes: { type: 'string' },
              },
              required: [
                'product_name',
                'quantity',
                'unit_price',
                'total_price',
              ],
            },
          },
          valid_until: {
            type: 'string',
            description: 'Vigencia (YYYY-MM-DD, opcional).',
          },
          channel: { type: 'string', description: 'Canal (opcional).' },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['items'],
      },
      requiredPermissions: [PERM_CREATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const checked = normalizeItems(args?.items);
        if (!checked.ok) {
          return previewError('Nueva cotización', checked.message as string);
        }
        const lines = checked.value as Array<Record<string, any>>;
        const total = lines.reduce(
          (sum, line) => sum + Number(line.total_price),
          0,
        );
        const detail = lines
          .map(
            (line) =>
              `${String(line.product_name)} x${line.quantity} ($${line.total_price})`,
          )
          .join('; ');
        return {
          status: 'ok',
          target: `Nueva cotización — ${lines.length} línea(s), total $${total}`,
          changes: [
            {
              field: 'customer_id',
              label: 'Cliente',
              from: null,
              to: args?.customer_id ?? 'sin cliente',
            },
            { field: 'items', label: 'Líneas', from: null, to: detail },
            { field: 'total', label: 'Total', from: null, to: total },
          ],
          message:
            'La cotización nace en draft. Envíala con send_quotation cuando esté lista.',
          domain: 'quotations',
        };
      },
      handler: guard(async (args) => {
        const checked = normalizeItems(args?.items);
        if (!checked.ok) {
          return {
            error: checked.message as string,
            next_step: 'Corrige las líneas y reintenta.',
          };
        }
        const dto: Record<string, any> = { items: checked.value };
        const customer_id = toPositiveInt(args?.customer_id);
        if (args?.customer_id !== undefined && customer_id === null) {
          return {
            error: `customer_id inválido: ${String(args?.customer_id)}.`,
            next_step: 'Pasa el ID numérico del cliente u omítelo.',
          };
        }
        if (customer_id !== null) dto.customer_id = customer_id;
        for (const key of ['valid_until', 'channel', 'notes']) {
          if (args?.[key] !== undefined && args?.[key] !== null) {
            dto[key] = args[key];
          }
        }
        const created = await deps.quotationsService.create(dto as any);
        const row = created as unknown as Record<string, any>;
        return {
          resumen: `Cotización ${quotationLabel(row)} creada en draft.`,
          quotation_id: row.id,
          quotation_number: row.quotation_number ?? null,
          resultado: row,
        };
      }),
    },

    // ─── send_quotation (WRITE) ──────────────────────────────────
    {
      name: 'send_quotation',
      version: '1',
      domain: 'quotations',
      description:
        'Envía una cotización en draft (draft→sent); si el cliente tiene correo, el servidor intenta notificarlo. Cadena: get_quotation para confirmar que está en draft.',
      parameters: {
        type: 'object',
        properties: {
          quotation_id: {
            type: 'number',
            description: 'ID de la cotización en draft.',
          },
        },
        required: ['quotation_id'],
      },
      requiredPermissions: [PERM_UPDATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.quotation_id);
        if (id === null) {
          return previewError(
            'Enviar cotización',
            'quotation_id inválido: consíguelo con list_quotations.',
          );
        }
        const quotation = await loadQuotation(id);
        if (!quotation) {
          return previewError(
            `Cotización #${id}`,
            'La cotización no existe o no es visible en esta tienda.',
          );
        }
        if (quotation.status !== 'draft') {
          return previewError(
            `Cotización ${quotationLabel(quotation)}`,
            `Solo se puede enviar desde draft; está en "${quotation.status}".`,
          );
        }
        return {
          status: 'ok',
          target: `Enviar cotización ${quotationLabel(quotation)}`,
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: 'draft',
              to: 'sent',
            },
          ],
          domain: 'quotations',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.quotation_id);
        if (id === null) {
          return {
            error: 'quotation_id inválido.',
            next_step: 'Consíguelo con list_quotations.',
          };
        }
        const quotation = await loadQuotation(id);
        if (!quotation) {
          return {
            error: `La cotización #${id} no existe.`,
            next_step: 'Elige una cotización existente con list_quotations.',
          };
        }
        if (quotation.status !== 'draft') {
          return {
            error: `La cotización ${quotationLabel(quotation)} ya no está en draft (está en "${quotation.status}").`,
            next_step: 'Lee el estado actual con get_quotation.',
          };
        }
        const sent = await deps.quotationsService.send(id);
        const row = sent as unknown as Record<string, any>;
        return {
          resumen: `Cotización ${quotationLabel(row)} enviada.`,
          quotation_id: row.id ?? id,
          estado: row.status ?? 'sent',
        };
      }),
    },

    // ─── accept_quotation (WRITE) ────────────────────────────────
    {
      name: 'accept_quotation',
      version: '1',
      domain: 'quotations',
      description:
        'Marca una cotización enviada como aceptada (sent→accepted). Cadena: get_quotation para confirmar que está en sent.',
      parameters: {
        type: 'object',
        properties: {
          quotation_id: {
            type: 'number',
            description: 'ID de la cotización en sent.',
          },
        },
        required: ['quotation_id'],
      },
      requiredPermissions: [PERM_UPDATE],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.quotation_id);
        if (id === null) {
          return previewError(
            'Aceptar cotización',
            'quotation_id inválido: consíguelo con list_quotations.',
          );
        }
        const quotation = await loadQuotation(id);
        if (!quotation) {
          return previewError(
            `Cotización #${id}`,
            'La cotización no existe o no es visible en esta tienda.',
          );
        }
        if (quotation.status !== 'sent') {
          return previewError(
            `Cotización ${quotationLabel(quotation)}`,
            `Solo se puede aceptar desde sent; está en "${quotation.status}".`,
          );
        }
        return {
          status: 'ok',
          target: `Aceptar cotización ${quotationLabel(quotation)}`,
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: 'sent',
              to: 'accepted',
            },
          ],
          domain: 'quotations',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.quotation_id);
        if (id === null) {
          return {
            error: 'quotation_id inválido.',
            next_step: 'Consíguelo con list_quotations.',
          };
        }
        const quotation = await loadQuotation(id);
        if (!quotation) {
          return {
            error: `La cotización #${id} no existe.`,
            next_step: 'Elige una cotización existente con list_quotations.',
          };
        }
        if (quotation.status !== 'sent') {
          return {
            error: `La cotización ${quotationLabel(quotation)} ya no está en sent (está en "${quotation.status}").`,
            next_step: 'Lee el estado actual con get_quotation.',
          };
        }
        const accepted = await deps.quotationsService.accept(id);
        const row = accepted as unknown as Record<string, any>;
        return {
          resumen: `Cotización ${quotationLabel(row)} aceptada.`,
          quotation_id: row.id ?? id,
          estado: row.status ?? 'accepted',
        };
      }),
    },

    // ─── convert_quotation_to_order (WRITE) ──────────────────────
    {
      name: 'convert_quotation_to_order',
      version: '1',
      domain: 'quotations',
      description:
        'Convierte una cotización aceptada en orden de venta (accepted→converted). Crea la orden con las líneas, impuestos y cliente de la cotización. Cadena: get_quotation para confirmar que está en accepted.',
      parameters: {
        type: 'object',
        properties: {
          quotation_id: {
            type: 'number',
            description: 'ID de la cotización en accepted.',
          },
        },
        required: ['quotation_id'],
      },
      requiredPermissions: [PERM_CONVERT],
      requiresConfirmation: true,
      preview: async (args) => {
        const id = toPositiveInt(args?.quotation_id);
        if (id === null) {
          return previewError(
            'Convertir cotización',
            'quotation_id inválido: consíguelo con list_quotations.',
          );
        }
        const quotation = await loadQuotation(id);
        if (!quotation) {
          return previewError(
            `Cotización #${id}`,
            'La cotización no existe o no es visible en esta tienda.',
          );
        }
        if (quotation.status !== 'accepted') {
          return previewError(
            `Cotización ${quotationLabel(quotation)}`,
            `Solo se puede convertir desde accepted; está en "${quotation.status}".`,
          );
        }
        return {
          status: 'warning',
          target: `Convertir cotización ${quotationLabel(quotation)} en orden`,
          changes: [
            {
              field: 'status',
              label: 'Estado',
              from: 'accepted',
              to: 'converted',
            },
            {
              field: 'order',
              label: 'Orden',
              from: null,
              to: 'nueva orden de venta',
            },
          ],
          message:
            'Crea la orden de venta y cierra la cotización; la conversión no se deshace.',
          domain: 'quotations',
        };
      },
      handler: guard(async (args) => {
        const id = toPositiveInt(args?.quotation_id);
        if (id === null) {
          return {
            error: 'quotation_id inválido.',
            next_step: 'Consíguelo con list_quotations.',
          };
        }
        const quotation = await loadQuotation(id);
        if (!quotation) {
          return {
            error: `La cotización #${id} no existe.`,
            next_step: 'Elige una cotización existente con list_quotations.',
          };
        }
        if (quotation.status !== 'accepted') {
          return {
            error: `La cotización ${quotationLabel(quotation)} ya no está en accepted (está en "${quotation.status}").`,
            next_step: 'Lee el estado actual con get_quotation.',
          };
        }
        const converted = await deps.quotationsService.convertToOrder(id);
        const row = converted as unknown as Record<string, any>;
        return {
          resumen: `Cotización ${quotationLabel(quotation)} convertida en orden.`,
          quotation_id: id,
          resultado: row,
        };
      }),
    },
  ];
}

import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { WithholdingTaxService } from '../../../domains/store/withholding-tax/withholding-tax.service';
import {
  SufferedOperationItem,
  WithholdingFlowService,
  WithholdingResolution,
} from '../../../domains/store/withholding-tax/withholding-flow.service';
import {
  CalculateWithholdingDto,
  CalculationsQueryDto,
  PreviewWithholdingDto,
} from '../../../domains/store/withholding-tax/dto';
import { ExogenousService } from '../../../domains/store/exogenous/exogenous.service';
import {
  GenerateReportDto,
  QueryReportsDto,
} from '../../../domains/store/exogenous/dto';
import { EXOGENOUS_FORMATS } from '../../../domains/store/exogenous/constants/format-definitions';
import { TaxesService } from '../../../domains/store/taxes/taxes.service';
import {
  CreateTaxCategoryDto,
  TaxCategoryQueryDto,
  TaxFiscalType,
  TaxType,
  UpdateTaxCategoryDto,
} from '../../../domains/store/taxes/dto';

export interface WithholdingToolDeps {
  withholdingTaxService: WithholdingTaxService;
  withholdingFlowService: WithholdingFlowService;
  exogenousService: ExogenousService;
  taxesService: TaxesService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F (misma que `writes.tools.ts` para el fallo: los
// handlers NO lanzan, devuelven `{error, next_step}` en español; ninguna
// lectura directa a la base — todo va al service dueño del scope tenant).
//
// Y la regla fiscal que manda en esta familia: el modelo NUNCA calcula
// retenciones a mano. Todo número sale del FLOW/resolver determinista —
// `resolveSufferedByOperation` para suffered (una línea por grupo de
// operación, nunca `resolveSuffered` directo), `previewWithholding` para
// practiced — y la tool solo transporta y proyecta.
// ─────────────────────────────────────────────────────────────────────────────

const WITHHOLDING_ROLES = ['practiced', 'suffered'] as const;

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
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

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/**
 * Valida un DTO ya construido como lo haría el `ValidationPipe` global del
 * HTTP (`whitelist` + `forbidNonWhitelisted`): las tools llaman a los
 * servicios directo, sin pasar por el pipe.
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

// ─────────────────────────────────────────────────────────────────────────────
// Paso 11: exógena + impuestos + cálculo/certificados. Misma regla fiscal que
// arriba (el modelo nunca calcula) más dos propias: 1001=practiced /
// 1003=suffered con suffered como crédito a favor, y `tax_type` requerido en
// toda categoría nueva (anti-`?? 'iva'`).
// ─────────────────────────────────────────────────────────────────────────────

/** Formatos exógenos operables vía Vexi (el servicio soporta más). */
const VEXI_EXOGENOUS_FORMATS = ['1001', '1003'] as const;

/** Rol legal que alimenta cada formato (fijo por norma, no por parámetro). */
const EXOGENOUS_FORMAT_ROLES: Record<string, string> = {
  '1001': 'practiced',
  '1003': 'suffered',
};

/** Cotas del año de certificado (mismas que el controlador HTTP). */
const CERTIFICATE_MIN_YEAR = 2000;
const CERTIFICATE_MAX_YEAR = 2100;

function resolveCertificateYear(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') {
    return new Date().getFullYear();
  }
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < CERTIFICATE_MIN_YEAR ||
    parsed > CERTIFICATE_MAX_YEAR
  ) {
    return null;
  }
  return parsed;
}

/** A dónde ruta cada `tax_type`: PUC + esquema DIAN + declaración. */
const TAX_TYPE_ROUTING: Record<string, string> = {
  iva: 'PUC 2408 · esquema DIAN 01 · declaración de IVA',
  inc: 'PUC 2436 · esquema DIAN 04 · declaración de INC',
  ica: 'PUC 2412 · esquema DIAN 03 · declaración de ICA',
  withholding: 'retención en la fuente · formulario 350 / exógena',
  reteiva: 'reteIVA · formulario 350 / exógena',
  reteica: 'reteICA · formulario 350 / exógena',
};

function isTaxFiscalType(value: unknown): value is TaxFiscalType {
  return (
    typeof value === 'string' &&
    (Object.values(TaxFiscalType) as string[]).includes(value)
  );
}

function isTaxCalcType(value: unknown): value is TaxType {
  return (
    typeof value === 'string' &&
    (Object.values(TaxType) as string[]).includes(value)
  );
}

export function createWithholdingTools(
  deps: WithholdingToolDeps,
): RegisteredTool[] {
  const {
    withholdingTaxService,
    withholdingFlowService,
    exogenousService,
    taxesService,
  } = deps;

  return [
    // ─── F-39: preview_withholding ─────────────────────────────────────
    {
      name: 'preview_withholding',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Proyección de solo lectura de las retenciones aplicables a una operación, calculada por el motor fiscal determinista (el modelo nunca calcula a mano): practiced para compras a un proveedor, suffered para ventas a un cliente agente retenedor. En suffered con venta mixta, envía items con su product_type y el motor resuelve una línea por grupo (bienes y servicios); sin cliente o sin agente retenedor la respuesta es lines vacía. No persiste nada.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['practiced', 'suffered'],
            description:
              'practiced: la tienda compra y retiene a un proveedor. suffered: la tienda vende y un cliente la retiene.',
          },
          base: {
            type: 'number',
            description:
              'Subtotal de la operación sobre el que se calcula la base. Para venta mixta usa items en su lugar.',
          },
          iva_amount: {
            type: 'number',
            description:
              'IVA de la operación. Solo mueve reteIVA; retefuente/reteICA usan el subtotal.',
          },
          customer_id: {
            type: 'number',
            description:
              'Cliente contraparte (solo suffered). Sin cliente, el resultado es lines vacía.',
          },
          supplier_id: {
            type: 'number',
            description: 'Proveedor contraparte (solo practiced).',
          },
          product_type: {
            type: 'string',
            description:
              "Solo suffered sin items: product_type de lo vendido ('service' resuelve como servicio; lo demás cuenta como bien).",
          },
          year: {
            type: 'number',
            description:
              'Año gravable para la UVT. Por defecto el año en curso.',
          },
          items: {
            type: 'array',
            description:
              'Solo suffered: líneas de la venta para resolver por grupo de operación (venta mixta bienes+servicios). Cada item lleva product_type, base e iva_amount opcional.',
            items: {
              type: 'object',
              properties: {
                product_type: {
                  type: 'string',
                  description:
                    "Tipo de producto de la línea ('service' va al grupo servicios; lo demás al grupo bienes).",
                },
                base: { type: 'number', description: 'Subtotal de la línea.' },
                iva_amount: {
                  type: 'number',
                  description: 'IVA de la línea (mueve reteIVA).',
                },
              },
              required: ['base'],
            },
          },
        },
        required: ['role', 'base'],
      },
      requiredPermissions: ['withholding:read'],
      handler: async (args, context: ToolExecutionContext) => {
        const role = args.role;
        if (role !== 'practiced' && role !== 'suffered') {
          return readToolError(
            "role inválido: debe ser 'practiced' (compra a proveedor) o 'suffered' (venta a cliente).",
            'Indica el rol de la operación antes de proyectar la retención.',
          );
        }

        const base = toNumberOrNull(args.base);
        if (base === null || base < 0) {
          return readToolError(
            'base inválida: debe ser un número mayor o igual a cero.',
            'Indica el subtotal de la operación en base.',
          );
        }

        const year: number | undefined =
          args.year === undefined || args.year === null
            ? undefined
            : (toPositiveInt(args.year) ?? undefined);
        if (args.year !== undefined && args.year !== null && !year) {
          return readToolError(
            'year inválido: debe ser un año gravable entero positivo.',
            'Omite year para usar el año en curso.',
          );
        }

        // ── suffered: SIEMPRE por tipo de operación, nunca directo ──
        if (role === 'suffered') {
          const organizationId = toPositiveInt(context.organization_id);
          if (!organizationId) {
            return readToolError(
              'Sin organización en contexto: el preview sufrido se resuelve siempre dentro de un tenant.',
              'Reintenta desde una sesión con tienda seleccionada.',
            );
          }

          const customerId =
            args.customer_id === undefined || args.customer_id === null
              ? null
              : toPositiveInt(args.customer_id);
          if (
            args.customer_id !== undefined &&
            args.customer_id !== null &&
            !customerId
          ) {
            return readToolError(
              'customer_id inválido: debe ser un entero positivo.',
              'Omite customer_id para una venta anónima (el resultado será lines vacía).',
            );
          }

          // Un solo grupo cuando no viajan items: el preview simple no
          // desglosa por línea. Ausente `product_type` ⇒ el FLOW lo cuenta
          // como bien, igual que `prepared` o una línea sin producto.
          const rawItems: unknown[] = Array.isArray(args.items)
            ? args.items
            : [
                {
                  product_type: args.product_type ?? null,
                  base,
                  iva_amount: args.iva_amount ?? 0,
                },
              ];
          if (!rawItems.length) {
            return readToolError(
              'items vacío: envía al menos una línea o usa base para el preview simple.',
              'Para una venta mixta envía cada grupo con su base y product_type.',
            );
          }

          const items: SufferedOperationItem[] = [];
          for (const [index, raw] of rawItems.entries()) {
            const entry =
              raw && typeof raw === 'object'
                ? (raw as Record<string, unknown>)
                : null;
            const itemBase = entry ? toNumberOrNull(entry.base) : null;
            if (itemBase === null || itemBase < 0) {
              return readToolError(
                `items[${index}].base inválida: debe ser un número mayor o igual a cero.`,
                'Revisa las bases de cada línea de la venta.',
              );
            }
            const itemIva = entry ? toNumberOrNull(entry.iva_amount) : null;
            if (
              entry?.iva_amount !== undefined &&
              entry?.iva_amount !== null &&
              (itemIva === null || itemIva < 0)
            ) {
              return readToolError(
                `items[${index}].iva_amount inválido: debe ser un número mayor o igual a cero.`,
                'Revisa el IVA de cada línea de la venta.',
              );
            }
            items.push({
              product_type:
                typeof entry?.product_type === 'string'
                  ? entry.product_type
                  : null,
              base: itemBase,
              ivaAmount: itemIva ?? 0,
            });
          }

          let resolution: WithholdingResolution;
          try {
            resolution =
              await withholdingFlowService.resolveSufferedByOperation({
                organization_id: organizationId,
                store_id: context.store_id ?? null,
                customer_id: customerId,
                items,
                ...(year !== undefined && { year }),
              });
          } catch (error) {
            return readToolError(
              `No se pudo proyectar la retención sufrida: ${describeReadError(error)}`,
              'Verifica la contraparte y que la UVT del año esté cargada.',
            );
          }

          const lines = resolution.lines ?? [];
          return JSON.stringify({
            role: 'suffered',
            lines,
            total_withholding: lines.reduce(
              (sum, line) => sum + (Number(line.amount) || 0),
              0,
            ),
            uvt_value_used: resolution.uvt_value_used ?? 0,
            counterparty_type: resolution.counterparty_type ?? null,
            groups: items.length,
          });
        }

        // ── practiced: vía el preview del service (usa resolvePracticed) ──
        const supplierId =
          args.supplier_id === undefined || args.supplier_id === null
            ? undefined
            : args.supplier_id;
        const validated = toValidatedDto(PreviewWithholdingDto, {
          role,
          base,
          ...(args.iva_amount !== undefined &&
            args.iva_amount !== null && {
              ivaAmount: args.iva_amount,
            }),
          ...(supplierId !== undefined && { supplier_id: supplierId }),
          ...(year !== undefined && { year }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa base, supplier_id y year del preview.',
          );
        }

        let result: {
          lines: WithholdingResolution['lines'];
          total_withholding: number;
        };
        try {
          result =
            await withholdingTaxService.previewWithholding(validated.dto);
        } catch (error) {
          return readToolError(
            `No se pudo proyectar la retención practicada: ${describeReadError(error)}`,
            'Verifica el proveedor y que la UVT del año esté cargada.',
          );
        }

        return JSON.stringify({
          role: 'practiced',
          lines: result.lines ?? [],
          total_withholding: result.total_withholding ?? 0,
        });
      },
    },

    // ─── F-41: list_withholding_calculations ───────────────────────────
    {
      name: 'list_withholding_calculations',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Histórico paginado de retenciones calculadas (practicadas a proveedores y sufridas ante clientes), con concepto, base, tarifa, valor retenido y contraparte. Con include_stats=true agrega el resumen mensual/anual y la UVT vigente.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'number',
            description: 'Página, desde 1. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description:
              'Filas por página, 1 a 100. Por defecto 20.',
          },
          role: {
            type: 'string',
            enum: ['practiced', 'suffered'],
            description:
              'Filtra por rol legal: practiced (a proveedores) o suffered (ante clientes).',
          },
          year: {
            type: 'number',
            description: 'Año gravable del cálculo.',
          },
          month: {
            type: 'number',
            description: 'Mes calendario 1-12 (filtra por created_at).',
          },
          supplier_id: {
            type: 'number',
            description: 'Filtra por proveedor contraparte.',
          },
          concept_id: {
            type: 'number',
            description: 'Filtra por concepto de retención.',
          },
          include_stats: {
            type: 'boolean',
            description:
              'Si es true, incluye el resumen mensual/anual y la UVT vigente.',
          },
        },
        required: [],
      },
      requiredPermissions: ['withholding:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const validated = toValidatedDto(CalculationsQueryDto, {
          ...(args.page !== undefined &&
            args.page !== null && { page: args.page }),
          ...(args.limit !== undefined &&
            args.limit !== null && {
              limit: clampLimit(args.limit, 20, 100),
            }),
          ...(args.role !== undefined &&
            args.role !== null && { role: args.role }),
          ...(args.year !== undefined &&
            args.year !== null && { year: args.year }),
          ...(args.month !== undefined &&
            args.month !== null && { month: args.month }),
          ...(args.supplier_id !== undefined &&
            args.supplier_id !== null && { supplier_id: args.supplier_id }),
          ...(args.concept_id !== undefined &&
            args.concept_id !== null && { concept_id: args.concept_id }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa page, limit, role, year, month, supplier_id y concept_id.',
          );
        }

        let result: {
          data: any[];
          total: number;
          page: number;
          limit: number;
        };
        try {
          result = await withholdingTaxService.findAllCalculations(
            validated.dto,
          );
        } catch (error) {
          return readToolError(
            `No se pudo leer el histórico de retenciones: ${describeReadError(error)}`,
            'Revisa los filtros de año, mes y rol.',
          );
        }

        const calculations = (result.data ?? []).map((row: any) => {
          const supplier = row.supplier
            ? {
                id: row.supplier.id ?? null,
                name: row.supplier.name ?? null,
                tax_id: row.supplier.tax_id ?? null,
              }
            : null;
          const customer = row.customer
            ? {
                id: row.customer.id ?? null,
                name:
                  [row.customer.first_name, row.customer.last_name]
                    .filter(Boolean)
                    .join(' ') || null,
                email: row.customer.email ?? null,
              }
            : null;
          return {
            id: row.id,
            year: row.year ?? null,
            role: row.role ?? null,
            counterparty_type: row.counterparty_type ?? null,
            withholding_type: row.withholding_type ?? null,
            concept: row.concept
              ? {
                  id: row.concept_id ?? null,
                  code: row.concept.code ?? null,
                  name: row.concept.name ?? null,
                }
              : { id: row.concept_id ?? null, code: null, name: null },
            base_amount: toNumberOrNull(row.base_amount),
            withholding_rate: toNumberOrNull(row.withholding_rate),
            withholding_amount: toNumberOrNull(row.withholding_amount),
            uvt_value_used: toNumberOrNull(row.uvt_value_used),
            supplier,
            customer,
            invoice: row.invoice
              ? {
                  id: row.invoice.id ?? null,
                  invoice_number: row.invoice.invoice_number ?? null,
                }
              : null,
            accounting_entity_id: row.accounting_entity_id ?? null,
            created_at: toIsoDate(row.created_at),
          };
        });

        const page = result.page ?? 1;
        const limit = result.limit ?? calculations.length;
        const total = result.total ?? calculations.length;
        const payload: Record<string, unknown> = {
          calculations,
          page,
          limit,
          total,
          total_pages: limit > 0 ? Math.ceil(total / limit) : 0,
        };

        if (args.include_stats === true) {
          try {
            payload.stats = await withholdingTaxService.getStats();
          } catch (error) {
            return readToolError(
              `No se pudo leer el resumen de retenciones: ${describeReadError(error)}`,
              'Reintenta sin include_stats para ver solo el histórico.',
            );
          }
        }

        return JSON.stringify(payload);
      },
    },

    // ─── F-40: calculate_withholding ───────────────────────────────────
    {
      name: 'calculate_withholding',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Calcula una retención sin persistir nada, resolviendo por rol: practiced calcula sobre un concepto exacto (concept_code + monto, compra a proveedor); suffered resuelve por tipo de operación vía el flujo determinista (venta a cliente agente retenedor, nunca cálculo directo). Lee primero preview_withholding (F-39) para proyectar y list_withholding_calculations (F-41) para el histórico. Requiere role.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['practiced', 'suffered'],
            description:
              'practiced: la tienda compra y retiene (pide amount + concept_code). suffered: la tienda vende y la retienen (pide base + contraparte).',
          },
          amount: {
            type: 'number',
            description:
              'Solo practiced: monto base del cálculo por concepto.',
          },
          concept_code: {
            type: 'string',
            description:
              'Solo practiced: código del concepto de retención (p. ej. RTE_COMPRAS).',
          },
          supplier_type: {
            type: 'string',
            description:
              'Solo practiced: tipo de contraparte cuando el concepto lo exige.',
          },
          base: {
            type: 'number',
            description: 'Solo suffered: subtotal de la venta.',
          },
          iva_amount: {
            type: 'number',
            description:
              'Solo suffered: IVA de la venta (solo mueve reteIVA).',
          },
          customer_id: {
            type: 'number',
            description:
              'Solo suffered: cliente agente retenedor. Sin cliente, el resultado es lines vacía.',
          },
          product_type: {
            type: 'string',
            description:
              "Solo suffered: 'service' resuelve como servicio; lo demás cuenta como bien.",
          },
          year: {
            type: 'number',
            description:
              'Solo suffered: año gravable para la UVT. Por defecto el año en curso.',
          },
        },
        required: ['role'],
      },
      requiredPermissions: ['withholding:read'],
      handler: async (args, context: ToolExecutionContext) => {
        const role = args.role;
        if (role !== 'practiced' && role !== 'suffered') {
          return readToolError(
            "role inválido: debe ser 'practiced' (compra) o 'suffered' (venta).",
            'Indica el rol de la operación antes de calcular.',
          );
        }

        // ── practiced: cálculo por concepto exacto (sin persistencia) ──
        if (role === 'practiced') {
          const validated = toValidatedDto(CalculateWithholdingDto, {
            ...(args.amount !== undefined &&
              args.amount !== null && { amount: args.amount }),
            ...(args.concept_code !== undefined &&
              args.concept_code !== null && {
                concept_code: args.concept_code,
              }),
            ...(args.supplier_type !== undefined &&
              args.supplier_type !== null && {
                supplier_type: args.supplier_type,
              }),
          });
          if (!validated.ok) {
            return readToolError(
              validated.message,
              'Envía amount (≥ 0) y concept_code del cálculo practicado.',
            );
          }
          let result: any;
          try {
            result = await withholdingTaxService.calculateWithholding(
              validated.dto.amount,
              validated.dto.concept_code,
              validated.dto.supplier_type,
            );
          } catch (error) {
            return readToolError(
              `No se pudo calcular la retención: ${describeReadError(error)}`,
              'Verifica que el concepto exista y esté activo, y que la UVT del año esté cargada.',
            );
          }
          return JSON.stringify({
            role: 'practiced',
            concept_code: validated.dto.concept_code,
            amount: toNumberOrNull(validated.dto.amount),
            withholding_amount: toNumberOrNull(
              result?.withholding_amount ?? result?.amount,
            ),
            withholding_rate: toNumberOrNull(
              result?.withholding_rate ?? result?.rate,
            ),
            result,
          });
        }

        // ── suffered: SIEMPRE por tipo de operación, nunca directo ──
        const organizationId = toPositiveInt(context.organization_id);
        if (!organizationId) {
          return readToolError(
            'Sin organización en contexto: el cálculo sufrido se resuelve siempre dentro de un tenant.',
            'Reintenta desde una sesión con tienda seleccionada.',
          );
        }
        const base = toNumberOrNull(args.base);
        if (base === null || base < 0) {
          return readToolError(
            'base inválida: el cálculo sufrido exige el subtotal de la venta (≥ 0).',
            'Indica el subtotal de la venta en base.',
          );
        }
        const ivaAmount = toNumberOrNull(args.iva_amount) ?? 0;
        if (ivaAmount < 0) {
          return readToolError(
            'iva_amount inválido: debe ser un número mayor o igual a cero.',
            'Indica el IVA de la venta o omite iva_amount.',
          );
        }
        const customerId =
          args.customer_id === undefined || args.customer_id === null
            ? null
            : toPositiveInt(args.customer_id);
        if (
          args.customer_id !== undefined &&
          args.customer_id !== null &&
          !customerId
        ) {
          return readToolError(
            'customer_id inválido: debe ser un entero positivo.',
            'Omite customer_id para una venta anónima (el resultado será lines vacía).',
          );
        }
        const year: number | undefined =
          args.year === undefined || args.year === null
            ? undefined
            : (toPositiveInt(args.year) ?? undefined);
        if (args.year !== undefined && args.year !== null && !year) {
          return readToolError(
            'year inválido: debe ser un año gravable entero positivo.',
            'Omite year para usar el año en curso.',
          );
        }
        const items: SufferedOperationItem[] = [
          {
            product_type:
              typeof args.product_type === 'string'
                ? args.product_type
                : null,
            base,
            ivaAmount,
          },
        ];
        let resolution: WithholdingResolution;
        try {
          resolution =
            await withholdingFlowService.resolveSufferedByOperation({
              organization_id: organizationId,
              store_id: context.store_id ?? null,
              customer_id: customerId,
              items,
              ...(year !== undefined && { year }),
            });
        } catch (error) {
          return readToolError(
            `No se pudo calcular la retención sufrida: ${describeReadError(error)}`,
            'Verifica la contraparte y que la UVT del año esté cargada.',
          );
        }
        const lines = resolution.lines ?? [];
        return JSON.stringify({
          role: 'suffered',
          lines,
          total_withholding: lines.reduce(
            (sum, line) => sum + (Number(line.amount) || 0),
            0,
          ),
          uvt_value_used: resolution.uvt_value_used ?? 0,
          counterparty_type: resolution.counterparty_type ?? null,
        });
      },
    },

    // ─── F-42: get_withholding_certificate ─────────────────────────────
    {
      name: 'get_withholding_certificate',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Certificado anual de retenciones: practiced agrega lo retenido a un proveedor; suffered agrega lo que un cliente o proveedor le retuvo a la tienda (crédito a favor, nunca saldo a pagar); employee es el certificado de ingresos y retenciones de un empleado (formulario 220). Requiere kind y el id de la contraparte.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['practiced', 'suffered', 'employee'],
            description:
              'practiced: certificado por proveedor. suffered: certificado de lo sufrido ante una contraparte. employee: certificado laboral por empleado.',
          },
          supplier_id: {
            type: 'number',
            description: 'Solo practiced: proveedor al que se le retuvo.',
          },
          counterparty_type: {
            type: 'string',
            enum: ['customer', 'supplier'],
            description:
              'Solo suffered: tipo de la contraparte que retuvo a la tienda.',
          },
          counterparty_id: {
            type: 'number',
            description:
              'Solo suffered: id de la contraparte que retuvo a la tienda.',
          },
          employee_id: {
            type: 'number',
            description: 'Solo employee: empleado del certificado.',
          },
          year: {
            type: 'number',
            description:
              'Año gravable del certificado. Por defecto el año en curso.',
          },
        },
        required: ['kind'],
      },
      requiredPermissions: ['withholding:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const kind = args.kind;
        if (kind !== 'practiced' && kind !== 'suffered' && kind !== 'employee') {
          return readToolError(
            "kind inválido: usa 'practiced', 'suffered' o 'employee'.",
            'Indica qué certificado necesitas antes de generarlo.',
          );
        }
        const year = resolveCertificateYear(args.year);
        if (!year) {
          return readToolError(
            `year inválido: debe estar entre ${CERTIFICATE_MIN_YEAR} y ${CERTIFICATE_MAX_YEAR}.`,
            'Omite year para usar el año en curso.',
          );
        }
        try {
          if (kind === 'practiced') {
            const supplierId = toPositiveInt(args.supplier_id);
            if (!supplierId) {
              return readToolError(
                'supplier_id inválido: el certificado practicado exige el proveedor.',
                'Indica el proveedor al que se le retuvo.',
              );
            }
            const certificate =
              await withholdingTaxService.generateCertificate(
                supplierId,
                year,
              );
            return JSON.stringify({ ...certificate, kind, year });
          }
          if (kind === 'suffered') {
            const counterpartyType = args.counterparty_type;
            if (
              counterpartyType !== 'customer' &&
              counterpartyType !== 'supplier'
            ) {
              return readToolError(
                'counterparty_type inválido: usa customer o supplier.',
                'Indica quién le retuvo a la tienda.',
              );
            }
            const counterpartyId = toPositiveInt(args.counterparty_id);
            if (!counterpartyId) {
              return readToolError(
                'counterparty_id inválido: debe ser un entero positivo.',
                'Indica la contraparte que le retuvo a la tienda.',
              );
            }
            const certificate =
              await withholdingTaxService.generateSufferedCertificate(
                counterpartyType,
                counterpartyId,
                year,
              );
            return JSON.stringify({ ...certificate, kind, year });
          }
          const employeeId = toPositiveInt(args.employee_id);
          if (!employeeId) {
            return readToolError(
              'employee_id inválido: el certificado laboral exige el empleado.',
              'Indica el empleado del certificado.',
            );
          }
          const certificate =
            await withholdingTaxService.generateEmployeeCertificate(
              employeeId,
              year,
            );
          return JSON.stringify({ ...certificate, kind, year });
        } catch (error) {
          return readToolError(
            `No se pudo generar el certificado: ${describeReadError(error)}`,
            'Verifica la contraparte y el año gravable.',
          );
        }
      },
    },

    // ─── F-43: list_exogenous_reports ──────────────────────────────────
    {
      name: 'list_exogenous_reports',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Reportes de información exógena del año: formato 1001 (retenciones practicadas a proveedores) y 1003 (retenciones que le practicaron a la tienda, crédito a favor). Es la lectura habilitante de generate_exogenous_report (F-45) y get_exogenous_status (F-44).',
      parameters: {
        type: 'object',
        properties: {
          fiscal_year: {
            type: 'number',
            description: 'Año fiscal de los reportes.',
          },
          status: {
            type: 'string',
            description:
              'Filtra por estado (generating, generated, submitted, draft).',
          },
          page: {
            type: 'number',
            description: 'Página, desde 1. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Filas por página. Por defecto 20.',
          },
        },
        required: [],
      },
      requiredPermissions: ['exogenous:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const validated = toValidatedDto(QueryReportsDto, {
          ...(args.fiscal_year !== undefined &&
            args.fiscal_year !== null && { fiscal_year: args.fiscal_year }),
          ...(args.status !== undefined &&
            args.status !== null && { status: args.status }),
          ...(args.page !== undefined &&
            args.page !== null && { page: args.page }),
          ...(args.limit !== undefined &&
            args.limit !== null && {
              limit: clampLimit(args.limit, 20, 100),
            }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa fiscal_year, status, page y limit.',
          );
        }
        let result: any;
        try {
          result = await exogenousService.findAll(validated.dto);
        } catch (error) {
          return readToolError(
            `No se pudieron leer los reportes exógenos: ${describeReadError(error)}`,
            'Revisa el año fiscal y el estado.',
          );
        }
        const reports = (result?.data ?? []).map((row: any) => ({
          id: row.id,
          fiscal_year: row.fiscal_year ?? null,
          format_code: row.format_code ?? null,
          format_name: row.format_name ?? null,
          role: EXOGENOUS_FORMAT_ROLES[row.format_code] ?? null,
          status: row.status ?? null,
          line_count: row.line_count ?? null,
          total_records: toNumberOrNull(row.total_records),
          total_amount: toNumberOrNull(row.total_amount),
          submitted_at: toIsoDate(row.submitted_at),
          created_at: toIsoDate(row.created_at),
        }));
        return JSON.stringify({
          reports,
          page: result?.meta?.page ?? 1,
          limit: result?.meta?.limit ?? reports.length,
          total: result?.meta?.total ?? reports.length,
          total_pages: result?.meta?.total_pages ?? 0,
        });
      },
    },

    // ─── F-44: get_exogenous_status ────────────────────────────────────
    {
      name: 'get_exogenous_status',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Estado de un reporte exógeno: su cabecera (formato, estado, líneas, totales) más la completitud del año fiscal (errores que bloquearían la presentación). Es la lectura habilitante de generate_exogenous_report (F-45) y submit_exogenous_report (F-46). Requiere report_id.',
      parameters: {
        type: 'object',
        properties: {
          report_id: {
            type: 'number',
            description: 'ID del reporte exógeno.',
          },
        },
        required: ['report_id'],
      },
      requiredPermissions: ['exogenous:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const reportId = toPositiveInt(args.report_id);
        if (!reportId) {
          return readToolError(
            'report_id inválido: debe ser un entero positivo.',
            'Obtén el id con list_exogenous_reports (F-43).',
          );
        }
        let report: any;
        try {
          report = await exogenousService.findOne(reportId);
        } catch (error) {
          return readToolError(
            `No se pudo leer el reporte ${reportId}: ${describeReadError(error)}`,
            'Obtén el id con list_exogenous_reports (F-43).',
          );
        }
        let completeness: any = null;
        try {
          completeness = await exogenousService.validateYear(
            report.fiscal_year,
          );
        } catch (error) {
          return readToolError(
            `No se pudo validar la completitud del año ${report.fiscal_year}: ${describeReadError(error)}`,
            'Revisa el año fiscal del reporte.',
          );
        }
        return JSON.stringify({
          report: {
            id: report.id,
            fiscal_year: report.fiscal_year ?? null,
            format_code: report.format_code ?? null,
            format_name: report.format_name ?? null,
            role: EXOGENOUS_FORMAT_ROLES[report.format_code] ?? null,
            status: report.status ?? null,
            line_count: report.line_count ?? null,
            total_records: toNumberOrNull(report.total_records),
            total_amount: toNumberOrNull(report.total_amount),
            submitted_at: toIsoDate(report.submitted_at),
          },
          completeness: {
            is_complete: completeness?.is_complete === true,
            error_count: completeness?.error_count ?? 0,
            errors: completeness?.errors ?? [],
          },
        });
      },
    },

    // ─── F-45: generate_exogenous_report ───────────────────────────────
    {
      name: 'generate_exogenous_report',
      version: '1',
      domain: 'withholding',
      description:
        'Genera (o regenera) un reporte exógeno 1001 (practicadas a proveedores) o 1003 (sufridas ante clientes, crédito a favor y nunca saldo a pagar). Lee primero list_exogenous_reports (F-43) y get_exogenous_status (F-44). Requiere fiscal_year y format_code.',
      parameters: {
        type: 'object',
        properties: {
          fiscal_year: {
            type: 'number',
            description: 'Año fiscal del reporte (2020-2099).',
          },
          format_code: {
            type: 'string',
            enum: ['1001', '1003'],
            description:
              '1001: retenciones practicadas. 1003: retenciones que le practicaron.',
          },
        },
        required: ['fiscal_year', 'format_code'],
      },
      requiredPermissions: ['exogenous:write'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        if (!VEXI_EXOGENOUS_FORMATS.includes(args.format_code)) {
          return {
            status: 'error',
            target: 'Generar reporte exógeno',
            changes: [],
            message:
              'format_code inválido: Solo se generan 1001 (practicadas) y 1003 (sufridas). Para otros formatos usa el módulo de exógena.',
          };
        }
        const validated = toValidatedDto(GenerateReportDto, {
          ...(args.fiscal_year !== undefined &&
            args.fiscal_year !== null && { fiscal_year: args.fiscal_year }),
          format_code: args.format_code,
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Generar reporte exógeno',
            changes: [],
            message: `${validated.message} El año fiscal va de 2020 a 2099.`,
          };
        }
        const formatName =
          EXOGENOUS_FORMATS[
            validated.dto.format_code as keyof typeof EXOGENOUS_FORMATS
          ]?.name ?? validated.dto.format_code;
        let completeness: any = null;
        try {
          completeness = await exogenousService.validateYear(
            validated.dto.fiscal_year,
          );
        } catch {
          completeness = null;
        }
        const errorCount = completeness?.error_count ?? 0;
        let existing: any = null;
        try {
          const found = await exogenousService.findAll({
            fiscal_year: validated.dto.fiscal_year,
          } as QueryReportsDto);
          existing = (found?.data ?? []).find(
            (row: any) => row.format_code === validated.dto.format_code,
          );
        } catch {
          existing = null;
        }
        return {
          status: errorCount > 0 ? 'warning' : 'ok',
          target: `Reporte exógeno ${validated.dto.format_code} (${formatName}) del año ${validated.dto.fiscal_year}`,
          changes: [
            {
              field: 'reporte',
              label: 'Reporte',
              from: existing ? `existente (id ${existing.id}, estado ${existing.status})` : null,
              to: existing ? 'regenerado' : 'generado',
            },
            {
              field: 'rol',
              label: 'Rol legal',
              from: null,
              to:
                validated.dto.format_code === '1001'
                  ? 'practiced (tercero proveedor)'
                  : 'suffered (tercero cliente agente; crédito a favor, nunca saldo a pagar)',
            },
          ],
          ...(errorCount > 0
            ? {
                message: `El año trae ${errorCount} error(es) de completitud: el reporte se genera igual pero conviene corregirlos antes de presentar.`,
              }
            : {}),
          domain: 'withholding',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        if (!VEXI_EXOGENOUS_FORMATS.includes(args.format_code)) {
          return writeToolError(
            'format_code inválido: solo se generan 1001 y 1003.',
            'Para otros formatos usa el módulo de exógena.',
          );
        }
        const validated = toValidatedDto(GenerateReportDto, {
          ...(args.fiscal_year !== undefined &&
            args.fiscal_year !== null && { fiscal_year: args.fiscal_year }),
          format_code: args.format_code,
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa el año fiscal (2020-2099) y el formato.',
          );
        }
        let generated: any;
        try {
          generated = await exogenousService.generateReport(validated.dto);
        } catch (error) {
          return writeToolError(
            `No se pudo generar el reporte: ${describeReadError(error)}`,
            'Revisa la completitud del año con get_exogenous_status (F-44).',
          );
        }
        return JSON.stringify({
          report_id: generated?.report?.id ?? generated?.id ?? null,
          fiscal_year: validated.dto.fiscal_year,
          format_code: validated.dto.format_code,
          role: EXOGENOUS_FORMAT_ROLES[validated.dto.format_code],
          status: generated?.report?.status ?? generated?.status ?? null,
          total_records: toNumberOrNull(
            generated?.report?.total_records ?? generated?.total_records,
          ),
          total_amount: toNumberOrNull(
            generated?.report?.total_amount ?? generated?.total_amount,
          ),
        });
      },
    },

    // ─── F-46: submit_exogenous_report ─────────────────────────────────
    {
      name: 'submit_exogenous_report',
      version: '1',
      domain: 'withholding',
      description:
        'Marca un reporte exógeno generado como presentado ante la DIAN. Solo procede sobre un reporte en estado generated: lee primero get_exogenous_status (F-44) para verificarlo. Requiere report_id.',
      parameters: {
        type: 'object',
        properties: {
          report_id: {
            type: 'number',
            description: 'ID del reporte a marcar como presentado.',
          },
        },
        required: ['report_id'],
      },
      requiredPermissions: ['exogenous:write'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const reportId = toPositiveInt(args.report_id);
        if (!reportId) {
          return {
            status: 'error',
            target: 'Presentar reporte exógeno',
            changes: [],
            message:
              'report_id inválido: debe ser un entero positivo. Obtén el id con list_exogenous_reports (F-43).',
          };
        }
        let report: any;
        try {
          report = await exogenousService.findOne(reportId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Presentar reporte exógeno',
            changes: [],
            message: `No se pudo leer el reporte ${reportId}: ${describeReadError(error)}. Obtén el id con list_exogenous_reports (F-43).`,
          };
        }
        if (report?.status !== 'generated') {
          const hint =
            report?.status === 'submitted'
              ? 'Ya está marcado como presentado.'
              : report?.status === 'generating'
                ? 'Aún se está generando: espera a que termine.'
                : 'Regenéralo con generate_exogenous_report (F-45) antes de presentarlo.';
          return {
            status: 'error',
            target: `Presentar reporte exógeno #${reportId}`,
            changes: [],
            message: `El reporte está en estado '${report?.status ?? 'desconocido'}': solo se presenta desde generated. ${hint}`,
          };
        }
        return {
          status: 'warning',
          target: `Presentar reporte exógeno ${report.format_code} del año ${report.fiscal_year}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: 'generated',
              to: 'submitted',
            },
            {
              field: 'alcance',
              label: 'Líneas presentadas',
              from: null,
              to: `${report.line_count ?? 0} línea(s)`,
            },
          ],
          message:
            'Verifica que el archivo ya se haya presentado de verdad ante la DIAN: esta marca es el registro interno de esa presentación.',
          domain: 'withholding',
        };
      },
      handler: async (args, _context: ToolExecutionContext) => {
        const reportId = toPositiveInt(args.report_id);
        if (!reportId) {
          return writeToolError(
            'report_id inválido: debe ser un entero positivo.',
            'Obtén el id con list_exogenous_reports (F-43).',
          );
        }
        let report: any;
        try {
          report = await exogenousService.findOne(reportId);
        } catch (error) {
          return writeToolError(
            `No se pudo leer el reporte ${reportId}: ${describeReadError(error)}`,
            'Obtén el id con list_exogenous_reports (F-43).',
          );
        }
        if (report?.status !== 'generated') {
          return writeToolError(
            `El reporte ${reportId} está en '${report?.status ?? 'desconocido'}' y ya no admite presentación.`,
            'Verifica su estado con get_exogenous_status (F-44).',
          );
        }
        let submitted: any;
        try {
          submitted = await exogenousService.markAsSubmitted(reportId);
        } catch (error) {
          return writeToolError(
            `No se pudo marcar el reporte ${reportId}: ${describeReadError(error)}`,
            'Verifica su estado con get_exogenous_status (F-44).',
          );
        }
        return JSON.stringify({
          report_id: submitted?.id ?? reportId,
          format_code: submitted?.format_code ?? null,
          fiscal_year: submitted?.fiscal_year ?? null,
          status: submitted?.status ?? 'submitted',
          submitted_at: toIsoDate(submitted?.submitted_at),
        });
      },
    },

    // ─── F-47: list_tax_categories ─────────────────────────────────────
    {
      name: 'list_tax_categories',
      version: '1',
      domain: 'withholding',
      readOnly: true,
      description:
        'Categorías de impuestos de la tienda con su clasificación fiscal (tax_type) y sus tarifas. Una categoría sin tax_type se comporta como IVA en todos los filtros. Es la lectura habilitante de create_tax_category (F-48) y update_tax_category (F-49).',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Filtra por nombre de la categoría.',
          },
          page: {
            type: 'number',
            description: 'Página, desde 1. Por defecto 1.',
          },
          limit: {
            type: 'number',
            description: 'Filas por página. Por defecto 10.',
          },
        },
        required: [],
      },
      requiredPermissions: ['store:taxes:read'],
      handler: async (args, _context: ToolExecutionContext) => {
        const validated = toValidatedDto(TaxCategoryQueryDto, {
          ...(args.search !== undefined &&
            args.search !== null && { search: args.search }),
          ...(args.page !== undefined &&
            args.page !== null && { page: args.page }),
          ...(args.limit !== undefined &&
            args.limit !== null && {
              limit: clampLimit(args.limit, 10, 100),
            }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa search, page y limit.',
          );
        }
        let result: any;
        try {
          result = await taxesService.findAll(validated.dto);
        } catch (error) {
          return readToolError(
            `No se pudieron leer las categorías: ${describeReadError(error)}`,
            'Revisa los filtros de búsqueda.',
          );
        }
        const categories = (result?.data ?? []).map((row: any) => ({
          id: row.id,
          name: row.name ?? null,
          description: row.description ?? null,
          tax_type: row.tax_type ?? null,
          status: row.status ?? null,
          rates: (row.tax_rates ?? []).map((rate: any) => ({
            id: rate.id ?? null,
            name: rate.name ?? null,
            rate: toNumberOrNull(rate.rate),
            is_compound: rate.is_compound ?? null,
          })),
        }));
        return JSON.stringify({
          categories,
          page: result?.meta?.page ?? 1,
          limit: result?.meta?.limit ?? categories.length,
          total: result?.meta?.total ?? categories.length,
          total_pages: result?.meta?.totalPages ?? 0,
        });
      },
    },

    // ─── F-48: create_tax_category ─────────────────────────────────────
    {
      name: 'create_tax_category',
      version: '1',
      domain: 'withholding',
      description:
        'Crea una categoría de impuesto con su tarifa. El tax_type es OBLIGATORIO (iva, inc, ica, withholding, reteiva, reteica): nunca se asume IVA por defecto, porque una categoría INC mal tipada se declararía como un IVA del 8 % que no existe. La tasa (rate) va en porcentaje 0-100. Lee primero list_tax_categories (F-47). Requiere name, type, rate y tax_type.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Nombre de la categoría (p. ej. IVA general 19%).',
          },
          type: {
            type: 'string',
            enum: ['percentage', 'fixed'],
            description:
              'Método de cálculo: percentage (sobre la base) o fixed (valor fijo).',
          },
          rate: {
            type: 'number',
            description:
              'Tasa en PORCENTAJE 0-100 (19 = 19 %; el servicio la guarda como fracción).',
          },
          tax_type: {
            type: 'string',
            enum: [
              'iva',
              'inc',
              'ica',
              'withholding',
              'reteiva',
              'reteica',
            ],
            description:
              'Clasificación fiscal OBLIGATORIA: a qué impuesto pertenece.',
          },
          description: {
            type: 'string',
            description: 'Descripción opcional de la categoría.',
          },
          is_inclusive: {
            type: 'boolean',
            description: 'Si el impuesto va incluido en el precio.',
          },
          is_compound: {
            type: 'boolean',
            description: 'Si se calcula sobre otros impuestos.',
          },
          sort_order: {
            type: 'number',
            description: 'Orden de aplicación.',
          },
        },
        required: ['name', 'type', 'rate', 'tax_type'],
      },
      requiredPermissions: ['store:taxes:create'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        // Anti-`?? 'iva'`: el default vive en el servicio por compatibilidad
        // con llamadas viejas; la vía agéntica lo exige explícito y falla
        // antes de validar el DTO, para que el mensaje culpe al campo.
        if (!isTaxFiscalType(args.tax_type)) {
          return {
            status: 'error',
            target: 'Crear categoría de impuesto',
            changes: [],
            message:
              'tax_type es obligatorio (iva, inc, ica, withholding, reteiva o reteica): nunca se asume IVA. Indica a qué impuesto pertenece la categoría.',
          };
        }
        if (!isTaxCalcType(args.type)) {
          return {
            status: 'error',
            target: 'Crear categoría de impuesto',
            changes: [],
            message:
              'type es obligatorio: percentage (sobre la base) o fixed (valor fijo).',
          };
        }
        const validated = toValidatedDto(CreateTaxCategoryDto, {
          ...(args.name !== undefined && args.name !== null && { name: args.name }),
          ...(args.description !== undefined &&
            args.description !== null && { description: args.description }),
          type: args.type,
          tax_type: args.tax_type,
          ...(args.rate !== undefined &&
            args.rate !== null && { rate: args.rate }),
          ...(args.is_inclusive !== undefined &&
            args.is_inclusive !== null && { is_inclusive: args.is_inclusive }),
          ...(args.is_compound !== undefined &&
            args.is_compound !== null && { is_compound: args.is_compound }),
          ...(args.sort_order !== undefined &&
            args.sort_order !== null && { sort_order: args.sort_order }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Crear categoría de impuesto',
            changes: [],
            message: validated.message,
          };
        }
        return {
          status: 'ok',
          target: `Categoría ${validated.dto.name} (${validated.dto.tax_type} ${validated.dto.rate}%)`,
          changes: [
            { field: 'nombre', label: 'Nombre', from: null, to: validated.dto.name },
            {
              field: 'tipo_fiscal',
              label: 'Clasificación fiscal',
              from: null,
              to: `${validated.dto.tax_type} → ${TAX_TYPE_ROUTING[validated.dto.tax_type as string] ?? 'ver mapeo contable'}`,
            },
            {
              field: 'tasa',
              label: 'Tasa',
              from: null,
              to: `${validated.dto.rate}% (${validated.dto.type})`,
            },
          ],
          message:
            'Si ya existe una categoría con ese nombre en la tienda, se actualiza en vez de duplicarse.',
          domain: 'withholding',
        };
      },
      handler: async (args, context: ToolExecutionContext) => {
        if (!isTaxFiscalType(args.tax_type)) {
          return writeToolError(
            'tax_type es obligatorio: iva, inc, ica, withholding, reteiva o reteica.',
            'Indica a qué impuesto pertenece la categoría; nunca se asume IVA.',
          );
        }
        if (!isTaxCalcType(args.type)) {
          return writeToolError(
            'type es obligatorio: percentage o fixed.',
            'Indica el método de cálculo de la categoría.',
          );
        }
        const validated = toValidatedDto(CreateTaxCategoryDto, {
          ...(args.name !== undefined && args.name !== null && { name: args.name }),
          ...(args.description !== undefined &&
            args.description !== null && { description: args.description }),
          type: args.type,
          tax_type: args.tax_type,
          ...(args.rate !== undefined &&
            args.rate !== null && { rate: args.rate }),
          ...(args.is_inclusive !== undefined &&
            args.is_inclusive !== null && { is_inclusive: args.is_inclusive }),
          ...(args.is_compound !== undefined &&
            args.is_compound !== null && { is_compound: args.is_compound }),
          ...(args.sort_order !== undefined &&
            args.sort_order !== null && { sort_order: args.sort_order }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa nombre, tasa (0-100) y tipo de la categoría.',
          );
        }
        let created: any;
        try {
          created = await taxesService.create(validated.dto, {
            id: context.user_id ?? null,
          });
        } catch (error) {
          return writeToolError(
            `No se pudo crear la categoría: ${describeReadError(error)}`,
            'Verifica que no exista otra categoría con el mismo nombre.',
          );
        }
        return JSON.stringify({
          category_id: created?.id ?? null,
          name: created?.name ?? null,
          tax_type: created?.tax_type ?? null,
          rates: (created?.tax_rates ?? []).map((rate: any) => ({
            id: rate.id ?? null,
            rate: toNumberOrNull(rate.rate),
          })),
        });
      },
    },

    // ─── F-49: update_tax_category ─────────────────────────────────────
    {
      name: 'update_tax_category',
      version: '1',
      domain: 'withholding',
      description:
        'Actualiza una categoría de impuesto existente (nombre, descripción, método, tasa en porcentaje 0-100 o clasificación fiscal). Solo viajan los campos enviados; cambiar el tax_type re-rutea el impuesto a otra cuenta PUC y otra declaración. Lee primero list_tax_categories (F-47). Requiere category_id.',
      parameters: {
        type: 'object',
        properties: {
          category_id: {
            type: 'number',
            description: 'ID de la categoría a actualizar.',
          },
          name: { type: 'string', description: 'Nuevo nombre.' },
          description: { type: 'string', description: 'Nueva descripción.' },
          type: {
            type: 'string',
            enum: ['percentage', 'fixed'],
            description: 'Nuevo método de cálculo.',
          },
          rate: {
            type: 'number',
            description: 'Nueva tasa en PORCENTAJE 0-100.',
          },
          tax_type: {
            type: 'string',
            enum: [
              'iva',
              'inc',
              'ica',
              'withholding',
              'reteiva',
              'reteica',
            ],
            description:
              'Nueva clasificación fiscal (re-rutea PUC y declaración).',
          },
          is_inclusive: { type: 'boolean' },
          is_compound: { type: 'boolean' },
          sort_order: { type: 'number' },
        },
        required: ['category_id'],
      },
      requiredPermissions: ['store:taxes:update'],
      requiresConfirmation: true,
      preview: async (args, _context): Promise<ToolPreview> => {
        const categoryId = toPositiveInt(args.category_id);
        if (!categoryId) {
          return {
            status: 'error',
            target: 'Actualizar categoría de impuesto',
            changes: [],
            message:
              'category_id inválido: debe ser un entero positivo. Obtén el id con list_tax_categories (F-47).',
          };
        }
        if (args.tax_type !== undefined && args.tax_type !== null && !isTaxFiscalType(args.tax_type)) {
          return {
            status: 'error',
            target: 'Actualizar categoría de impuesto',
            changes: [],
            message:
              'tax_type inválido: usa iva, inc, ica, withholding, reteiva o reteica.',
          };
        }
        if (args.type !== undefined && args.type !== null && !isTaxCalcType(args.type)) {
          return {
            status: 'error',
            target: 'Actualizar categoría de impuesto',
            changes: [],
            message: 'type inválido: usa percentage o fixed.',
          };
        }
        const patch: Record<string, unknown> = {};
        for (const field of [
          'name',
          'description',
          'type',
          'rate',
          'tax_type',
          'is_inclusive',
          'is_compound',
          'sort_order',
        ]) {
          if (args[field] !== undefined && args[field] !== null) {
            patch[field] = args[field];
          }
        }
        if (!Object.keys(patch).length) {
          return {
            status: 'error',
            target: 'Actualizar categoría de impuesto',
            changes: [],
            message:
              'Sin cambios: envía al menos un campo a actualizar además de category_id.',
          };
        }
        const validated = toValidatedDto(UpdateTaxCategoryDto, patch);
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Actualizar categoría de impuesto',
            changes: [],
            message: validated.message,
          };
        }
        let current: any;
        try {
          current = await taxesService.findOne(categoryId, null);
        } catch (error) {
          return {
            status: 'error',
            target: 'Actualizar categoría de impuesto',
            changes: [],
            message: `No se pudo leer la categoría ${categoryId}: ${describeReadError(error)}. Obtén el id con list_tax_categories (F-47).`,
          };
        }
        const labels: Record<string, string> = {
          name: 'Nombre',
          description: 'Descripción',
          type: 'Método de cálculo',
          rate: 'Tasa (%)',
          tax_type: 'Clasificación fiscal',
          is_inclusive: 'Incluido en precio',
          is_compound: 'Compuesto',
          sort_order: 'Orden',
        };
        const changes: ToolPreview['changes'] = Object.entries(
          validated.dto as Record<string, unknown>,
        ).map(([field, value]) => ({
          field,
          label: labels[field] ?? field,
          from: current?.[field] ?? null,
          to:
            field === 'tax_type'
              ? `${value} → ${TAX_TYPE_ROUTING[value as string] ?? 'ver mapeo contable'}`
              : value,
        }));
        return {
          status: patch.tax_type ? 'warning' : 'ok',
          target: `Actualizar categoría ${current?.name ?? `#${categoryId}`}`,
          changes,
          ...(patch.tax_type
            ? {
                message:
                  'Cambiar el tax_type re-rutea el impuesto a otra cuenta PUC y otra declaración fiscal.',
              }
            : {}),
          domain: 'withholding',
        };
      },
      handler: async (args, context: ToolExecutionContext) => {
        const categoryId = toPositiveInt(args.category_id);
        if (!categoryId) {
          return writeToolError(
            'category_id inválido: debe ser un entero positivo.',
            'Obtén el id con list_tax_categories (F-47).',
          );
        }
        if (args.tax_type !== undefined && args.tax_type !== null && !isTaxFiscalType(args.tax_type)) {
          return writeToolError(
            'tax_type inválido: usa iva, inc, ica, withholding, reteiva o reteica.',
            'Revisa la clasificación fiscal a asignar.',
          );
        }
        if (args.type !== undefined && args.type !== null && !isTaxCalcType(args.type)) {
          return writeToolError(
            'type inválido: usa percentage o fixed.',
            'Revisa el método de cálculo a asignar.',
          );
        }
        const patch: Record<string, unknown> = {};
        for (const field of [
          'name',
          'description',
          'type',
          'rate',
          'tax_type',
          'is_inclusive',
          'is_compound',
          'sort_order',
        ]) {
          if (args[field] !== undefined && args[field] !== null) {
            patch[field] = args[field];
          }
        }
        if (!Object.keys(patch).length) {
          return writeToolError(
            'Sin cambios: envía al menos un campo a actualizar.',
            'Indica qué campo de la categoría quieres cambiar.',
          );
        }
        const validated = toValidatedDto(UpdateTaxCategoryDto, patch);
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa los campos a actualizar.',
          );
        }
        try {
          await taxesService.findOne(categoryId, null);
        } catch (error) {
          return writeToolError(
            `No se pudo leer la categoría ${categoryId}: ${describeReadError(error)}`,
            'Obtén el id con list_tax_categories (F-47).',
          );
        }
        let updated: any;
        try {
          updated = await taxesService.update(
            categoryId,
            validated.dto,
            { id: context.user_id ?? null },
          );
        } catch (error) {
          return writeToolError(
            `No se pudo actualizar la categoría ${categoryId}: ${describeReadError(error)}`,
            'Revisa los campos con list_tax_categories (F-47).',
          );
        }
        return JSON.stringify({
          category_id: updated?.id ?? categoryId,
          name: updated?.name ?? null,
          tax_type: updated?.tax_type ?? null,
        });
      },
    },
  ];
}

export { WITHHOLDING_ROLES };

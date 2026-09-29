import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { WithholdingTaxService } from '../../../domains/store/withholding-tax/withholding-tax.service';
import {
  SufferedOperationItem,
  WithholdingFlowService,
  WithholdingResolution,
} from '../../../domains/store/withholding-tax/withholding-flow.service';
import {
  CalculationsQueryDto,
  PreviewWithholdingDto,
} from '../../../domains/store/withholding-tax/dto';

export interface WithholdingToolDeps {
  withholdingTaxService: WithholdingTaxService;
  withholdingFlowService: WithholdingFlowService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F (misma que `writes.tools.ts` para el fallo: los
// handlers NO lanzan, devuelven `{error, next_step}` en español; cero
// `prisma.` aquí — toda lectura va al service dueño del scope tenant).
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

export function createWithholdingTools(
  deps: WithholdingToolDeps,
): RegisteredTool[] {
  const { withholdingTaxService, withholdingFlowService } = deps;

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
  ];
}

export { WITHHOLDING_ROLES };

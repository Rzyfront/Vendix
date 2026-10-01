import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  return_order_status_enum,
  return_order_type_enum,
} from '@prisma/client';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { ReturnOrdersService } from '../../../domains/store/orders/return-orders/return-orders.service';
import { CreateReturnOrderDto } from '../../../domains/store/orders/return-orders/dto/create-return-order.dto';
import { UpdateReturnOrderDto } from '../../../domains/store/orders/return-orders/dto/update-return-order.dto';

export interface ReturnToolDeps {
  returnOrdersService: ReturnOrdersService;
}

const RETURN_TYPES = Object.values(return_order_type_enum);
const PROCESS_ACTIONS = ['restock', 'write_off', 'repair'] as const;
const ITEM_CONDITIONS = ['good', 'damaged'] as const;

const RETURN_TYPE_LABEL: Record<string, string> = {
  purchase_return: 'devolución de compra (al proveedor)',
  sales_return: 'devolución de venta (del cliente)',
};

const PROCESS_ACTION_LABEL: Record<string, string> = {
  restock: 'reingresar a inventario',
  write_off: 'dar de baja',
  repair: 'enviar a reparación',
};

function toolError(
  message: string,
  nextStep?: string,
  code?: string,
): string {
  return JSON.stringify({
    error: message,
    ...(nextStep ? { next_step: nextStep } : {}),
    ...(code ? { code } : {}),
  });
}

function previewError(
  target: string,
  message: string,
  domain = 'returns',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

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
    const response = error.getResponse() as
      | { message?: unknown; error_code?: string }
      | string;
    if (typeof response === 'string') return { message: response };
    const raw = response?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
    return {
      ...(response?.error_code && { code: response.error_code }),
      message,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function compactReturnLine(item: any) {
  const product =
    item.products?.name ?? item.product?.name ?? `#${item.product_id}`;
  return {
    line_id: item.id,
    product,
    quantity: Number(item.quantity ?? 0),
    condition: item.condition ?? null,
  };
}

function returnLabel(r: any): string {
  const kind =
    RETURN_TYPE_LABEL[String(r.type)] ?? `devolución ${r.type ?? ''}`;
  return `Devolución #${r.id} — ${kind} (${r.status})`;
}

/**
 * O-29 — Devoluciones (P1 operativo, paso 10 del plan consolidado).
 *
 * Familia propia (no va en `orders.tools.ts`, de otro track): CRUD +
 * process/cancel sobre `ReturnOrdersService`. Solo el borrador (draft) acepta
 * edición o procesamiento; procesar mueve stock real (reingreso/baja) y emite
 * `refund.completed` para contabilidad; cancelar cierra sin mover stock.
 * La lectura (findOne/findAll) vive en el preview y en la re-verificación del
 * handler, porque el preview es proyección, no transacción.
 */
export function createReturnTools(deps: ReturnToolDeps): RegisteredTool[] {
  const { returnOrdersService } = deps;

  async function resolveReturnOrPreviewError(
    returnId: number,
  ): Promise<{ ok: true; order: any } | { ok: false; preview: ToolPreview }> {
    try {
      const order = await returnOrdersService.findOne(returnId);
      return { ok: true, order };
    } catch (error) {
      const info = describeError(error);
      return {
        ok: false,
        preview: previewError(
          `Devolución #${returnId}`,
          info.message || `La devolución ${returnId} no existe.`,
        ),
      };
    }
  }

  function buildCreateDto(args: Record<string, any>) {
    return toValidatedDto(CreateReturnOrderDto, {
      ...(args.type ? { type: String(args.type) } : {}),
      ...(args.related_order_id !== undefined
        ? { related_order_id: Number(args.related_order_id) }
        : {}),
      ...(args.related_order_type
        ? { related_order_type: String(args.related_order_type) }
        : {}),
      ...(args.related_dispatch_id !== undefined
        ? { related_dispatch_id: Number(args.related_dispatch_id) }
        : {}),
      ...(args.partner_id !== undefined
        ? { partner_id: Number(args.partner_id) }
        : {}),
      ...(args.partner_type ? { partner_type: String(args.partner_type) } : {}),
      ...(args.reason_id !== undefined
        ? { reason_id: Number(args.reason_id) }
        : {}),
      items: (Array.isArray(args.lines) ? args.lines : []).map(
        (line: any) => ({
          product_id: Number(line?.product_id),
          ...(line?.product_variant_id !== undefined &&
          line?.product_variant_id !== null
            ? { product_variant_id: Number(line.product_variant_id) }
            : {}),
          quantity: Number(line?.quantity),
          ...(line?.condition ? { condition: String(line.condition) } : {}),
        }),
      ),
    });
  }

  return [
    // ─── O-29: manage_return_orders (WRITE) ──────────────────────────────
    {
      name: 'manage_return_orders',
      version: '1',
      domain: 'returns',
      description:
        'Crea, edita, procesa, cancela o elimina devoluciones de compra/venta. Solo el borrador acepta edición o proceso; procesar mueve stock (reingreso/baja/reparación) y genera el reembolso contable; cancelar cierra sin mover stock. Acciones: create (type + lines), update (solo borrador, sin líneas), process (process_items con acción por línea), cancel, delete.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'process', 'cancel', 'delete'],
            description: 'Acción sobre la devolución.',
          },
          return_id: {
            type: 'number',
            description:
              'ID de la devolución (requerido para update, process, cancel y delete).',
          },
          type: {
            type: 'string',
            enum: RETURN_TYPES,
            description:
              'Clase de devolución (requerido para create): purchase_return al proveedor, sales_return del cliente.',
          },
          related_order_id: {
            type: 'number',
            description: 'Orden vinculada (venta o compra).',
          },
          related_order_type: {
            type: 'string',
            enum: ['purchase_order', 'sales_order'],
          },
          related_dispatch_id: { type: 'number' },
          partner_id: {
            type: 'number',
            description: 'Cliente o proveedor, según partner_type.',
          },
          partner_type: {
            type: 'string',
            enum: ['customer', 'supplier'],
          },
          reason_id: { type: 'number' },
          lines: {
            type: 'array',
            description:
              'Líneas (requerido para create): product_id, quantity y condition opcional.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
                condition: { type: 'string', enum: ITEM_CONDITIONS },
              },
              required: ['product_id', 'quantity'],
            },
          },
          process_items: {
            type: 'array',
            description:
              'Líneas a procesar (requerido para process): id de línea + action (restock/write_off/repair) + location_id opcional.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                action: { type: 'string', enum: PROCESS_ACTIONS },
                location_id: { type: 'number' },
              },
              required: ['id', 'action'],
            },
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:orders:return_orders:create',
        'store:orders:return_orders:update',
        'store:orders:return_orders:process',
        'store:orders:return_orders:cancel',
        'store:orders:return_orders:delete',
      ],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context) => {
        const action = String(args.action ?? '');
        if (
          !['create', 'update', 'process', 'cancel', 'delete'].includes(action)
        ) {
          return previewError(
            'Devolución',
            `action "${action}" inválida. Usa create, update, process, cancel o delete.`,
          );
        }

        if (!context.store_id && !context.organization_id) {
          return previewError(
            'Devolución',
            'Sin tienda ni organización en contexto.',
          );
        }

        try {
          if (action === 'create') {
            const checked = buildCreateDto(args);
            if (!checked.ok) {
              return previewError('Nueva devolución', checked.message);
            }
            const kind =
              RETURN_TYPE_LABEL[checked.dto.type] ?? checked.dto.type;
            const detail = checked.dto.items
              .map(
                (line: any) =>
                  `producto #${line.product_id} x${line.quantity} (${line.condition ?? 'good'})`,
              )
              .join('; ');
            return {
              status: 'ok',
              target: `Nueva devolución — ${kind}`,
              changes: [
                { field: 'type', label: 'Clase', from: null, to: kind },
                {
                  field: 'lines',
                  label: `Líneas (${checked.dto.items.length})`,
                  from: null,
                  to: detail,
                },
                {
                  field: 'status',
                  label: 'Estado inicial',
                  from: null,
                  to: 'draft (procesar mueve stock)',
                },
              ],
              domain: 'returns',
            };
          }

          const returnId = toPositiveInt(args.return_id);
          if (!returnId) {
            return previewError(
              'Devolución',
              `${action} exige return_id.`,
            );
          }
          const resolved = await resolveReturnOrPreviewError(returnId);
          if (!resolved.ok) return resolved.preview;
          const order = resolved.order;
          const label = returnLabel(order);
          const lines = (order.return_order_items ?? []).map(
            compactReturnLine,
          );

          if (action === 'update') {
            if (order.status !== return_order_status_enum.draft) {
              return previewError(
                label,
                `La devolución está en «${order.status}»: solo un borrador acepta ediciones.`,
              );
            }
            if (Array.isArray(args.lines) && args.lines.length) {
              return previewError(
                label,
                'Las líneas no se editan por esta vía: manda solo campos escalares (type, referencias, socio, motivo).',
              );
            }
            return {
              status: 'ok',
              target: label,
              changes: [
                {
                  field: 'return',
                  label: 'Edición',
                  from: 'draft actual',
                  to: 'draft actualizado',
                },
              ],
              domain: 'returns',
            };
          }

          if (action === 'process') {
            if (order.status !== return_order_status_enum.draft) {
              return previewError(
                label,
                `La devolución está en «${order.status}»: solo un borrador puede procesarse.`,
              );
            }
            const items = Array.isArray(args.process_items)
              ? args.process_items
              : [];
            if (!items.length) {
              return previewError(
                label,
                'process exige process_items con id de línea + action.',
              );
            }
            const unknown = items.find(
              (raw: any) =>
                !lines.some((l: any) => l.line_id === Number(raw.id)),
            );
            if (unknown) {
              return previewError(
                label,
                `La línea #${unknown.id} no pertenece a esta devolución (líneas: ${lines.map((l: any) => l.line_id).join(', ') || 'ninguna'}).`,
              );
            }
            const detail = items
              .map((raw: any) => {
                const line = lines.find(
                  (l: any) => l.line_id === Number(raw.id),
                );
                const what =
                  PROCESS_ACTION_LABEL[String(raw.action)] ?? raw.action;
                return `${line?.product ?? `línea #${raw.id}`} x${line?.quantity ?? '?'} → ${what}`;
              })
              .join('; ');
            return {
              status: 'warning',
              target: label,
              changes: [
                {
                  field: 'status',
                  label: 'Estado',
                  from: 'draft',
                  to: 'processed (mueve stock + reembolso contable)',
                },
                {
                  field: 'items',
                  label: 'Líneas',
                  from: null,
                  to: detail,
                },
              ],
              message:
                'Procesar es irreversible: reingresa o da de baja el stock y emite el evento contable del reembolso.',
              domain: 'returns',
            };
          }

          if (action === 'cancel') {
            if (order.status === return_order_status_enum.processed) {
              return previewError(
                label,
                'La devolución ya está procesada: no puede cancelarse.',
              );
            }
            if (order.status === return_order_status_enum.cancelled) {
              return previewError(
                label,
                'La devolución ya está cancelada: nada que cancelar.',
              );
            }
            return {
              status: 'warning',
              target: label,
              changes: [
                {
                  field: 'status',
                  label: 'Estado',
                  from: order.status,
                  to: 'cancelled (sin mover stock)',
                },
              ],
              message:
                'Cancelar cierra la devolución sin reingresar ni dar de baja nada.',
              domain: 'returns',
            };
          }

          // delete
          const processed = order.status === return_order_status_enum.processed;
          return {
            status: 'warning',
            target: label,
            changes: [
              {
                field: 'return',
                label: 'Registro',
                from: label,
                to: 'eliminado',
              },
            ],
            message: processed
              ? 'Borra el registro de una devolución PROCESADA: el stock ya se movió y NO se revierte. Solo hazlo si el registro es un duplicado o una prueba.'
              : 'Borra el borrador sin mover stock.',
            domain: 'returns',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Devolución', info.message);
        }
      },
      handler: async (args) => {
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            const checked = buildCreateDto(args);
            if (!checked.ok) return toolError(checked.message);
            const created = await returnOrdersService.create(checked.dto);
            const kind =
              RETURN_TYPE_LABEL[String(created.type)] ?? created.type;
            return JSON.stringify({
              resumen: `Devolución #${created.id} creada (${kind}, borrador)`,
              return_id: created.id,
              status: created.status ?? 'draft',
              siguiente_paso:
                'Procésala con manage_return_orders (process) indicando la acción por línea.',
            });
          }

          const returnId = toPositiveInt(args.return_id);
          if (!returnId) {
            return toolError(`${action} exige return_id.`);
          }
          // Re-verificación común: sigue existiendo y se re-lee su estado.
          let fresh: any;
          try {
            fresh = await returnOrdersService.findOne(returnId);
          } catch {
            return toolError(
              `La devolución ${returnId} ya no existe.`,
            );
          }

          if (action === 'update') {
            if (fresh.status !== return_order_status_enum.draft) {
              return toolError(
                `La devolución ${returnId} pasó a «${fresh.status}»: solo un borrador acepta ediciones.`,
              );
            }
            if (Array.isArray(args.lines) && args.lines.length) {
              return toolError(
                'Las líneas no se editan por esta vía: manda solo campos escalares.',
              );
            }
            const checked = toValidatedDto(UpdateReturnOrderDto, {
              ...(args.type ? { type: String(args.type) } : {}),
              ...(args.related_order_id !== undefined
                ? { related_order_id: Number(args.related_order_id) }
                : {}),
              ...(args.related_order_type
                ? { related_order_type: String(args.related_order_type) }
                : {}),
              ...(args.related_dispatch_id !== undefined
                ? { related_dispatch_id: Number(args.related_dispatch_id) }
                : {}),
              ...(args.partner_id !== undefined
                ? { partner_id: Number(args.partner_id) }
                : {}),
              ...(args.partner_type
                ? { partner_type: String(args.partner_type) }
                : {}),
              ...(args.reason_id !== undefined
                ? { reason_id: Number(args.reason_id) }
                : {}),
            });
            if (!checked.ok) return toolError(checked.message);
            const updated = await returnOrdersService.update(
              returnId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `Devolución #${returnId} actualizada (sigue en ${updated.status ?? 'draft'})`,
              return_id: returnId,
              status: updated.status ?? 'draft',
            });
          }

          if (action === 'process') {
            if (fresh.status !== return_order_status_enum.draft) {
              return toolError(
                `La devolución ${returnId} pasó a «${fresh.status}»: solo un borrador puede procesarse.`,
              );
            }
            const items = Array.isArray(args.process_items)
              ? args.process_items
              : [];
            if (!items.length) {
              return toolError(
                'process exige process_items con id de línea + action.',
              );
            }
            const lines = (fresh.return_order_items ?? []).map(
              compactReturnLine,
            );
            for (const raw of items) {
              if (
                !lines.some((l: any) => l.line_id === Number(raw.id))
              ) {
                return toolError(
                  `La línea #${raw.id} no pertenece a la devolución ${returnId}.`,
                );
              }
              if (
                !(PROCESS_ACTIONS as readonly string[]).includes(
                  String(raw.action),
                )
              ) {
                return toolError(
                  `action "${raw.action}" inválida en la línea #${raw.id}. Usa restock, write_off o repair.`,
                );
              }
              if (
                raw.location_id !== undefined &&
                raw.location_id !== null &&
                !toPositiveInt(raw.location_id)
              ) {
                return toolError(
                  `location_id inválido en la línea #${raw.id}.`,
                );
              }
            }
            const processed = await returnOrdersService.process(
              returnId,
              items.map((raw: any) => ({
                id: Number(raw.id),
                action: String(raw.action),
                ...(raw.location_id !== undefined &&
                raw.location_id !== null
                  ? { location_id: Number(raw.location_id) }
                  : {}),
              })),
            );
            return JSON.stringify({
              resumen: `Devolución #${returnId} procesada: ${items.length} línea(s) con stock movido y reembolso contable emitido`,
              return_id: returnId,
              status: processed.status ?? 'processed',
            });
          }

          if (action === 'cancel') {
            if (fresh.status === return_order_status_enum.processed) {
              return toolError(
                `La devolución ${returnId} ya está procesada: no puede cancelarse.`,
              );
            }
            if (fresh.status === return_order_status_enum.cancelled) {
              return toolError(
                `La devolución ${returnId} ya está cancelada: nada que cancelar.`,
              );
            }
            const cancelled = await returnOrdersService.cancel(returnId);
            return JSON.stringify({
              resumen: `Devolución #${returnId} cancelada (sin mover stock)`,
              return_id: returnId,
              status: cancelled.status ?? 'cancelled',
            });
          }

          if (action === 'delete') {
            await returnOrdersService.remove(returnId);
            return JSON.stringify({
              resumen: `Devolución #${returnId} eliminada`,
              return_id: returnId,
            });
          }

          return toolError(
            `action "${action}" inválida. Usa create, update, process, cancel o delete.`,
          );
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Lee la devolución (GET /store/return-orders/:id) para ver su estado y líneas actuales.',
            info.code,
          );
        }
      },
    },
  ];
}

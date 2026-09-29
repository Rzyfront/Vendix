import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { purchase_order_status_enum } from '@prisma/client';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { PurchaseOrdersService } from '../../../domains/store/orders/purchase-orders/purchase-orders.service';
import { SuppliersService } from '../../../domains/store/inventory/suppliers/suppliers.service';
import { CreatePurchaseOrderDto } from '../../../domains/store/orders/purchase-orders/dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from '../../../domains/store/orders/purchase-orders/dto/update-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../../../domains/store/orders/purchase-orders/dto/receive-purchase-order.dto';
import { PurchaseOrderQueryDto } from '../../../domains/store/orders/purchase-orders/dto/purchase-order-query.dto';

export interface PurchasingToolDeps {
  purchaseOrdersService: PurchaseOrdersService;
  suppliersService: SuppliersService;
}

const PO_STATUSES = Object.values(purchase_order_status_enum);

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
  domain = 'purchasing',
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

function compactPurchaseOrder(o: any) {
  return {
    purchase_order_id: o.id,
    order_number: o.order_number,
    supplier_id: o.supplier_id,
    supplier: o.suppliers?.name ?? null,
    location: o.location?.name ?? null,
    status: o.status,
    payment_status: o.payment_status ?? null,
    subtotal: o.subtotal_amount !== undefined ? Number(o.subtotal_amount) : null,
    tax: o.tax_amount !== undefined ? Number(o.tax_amount) : null,
    total: o.total_amount !== undefined ? Number(o.total_amount) : null,
    order_date: o.order_date ?? null,
    expected_date: o.expected_date ?? null,
    next_payment_date: o.next_payment_date ?? null,
    lines_count: Array.isArray(o.purchase_order_items)
      ? o.purchase_order_items.length
      : undefined,
  };
}

function compactPurchaseOrderLine(item: any) {
  const ordered = Number(item.quantity_ordered ?? item.quantity ?? 0);
  const received = Number(item.quantity_received ?? 0);
  return {
    line_id: item.id,
    product_id: item.product_id,
    product: item.products?.name ?? null,
    sku: item.products?.sku ?? null,
    variant_id: item.product_variant_id ?? null,
    variant: item.product_variants?.name ?? null,
    ordered,
    received,
    pending: ordered - received,
    unit_cost:
      item.unit_cost !== undefined && item.unit_cost !== null
        ? Number(item.unit_cost)
        : null,
  };
}

/**
 * O-33..O-36 — Compras P0 (paso 7 del lote O).
 *
 * Subdominio con 0 cobertura. Los reads (O-33, O-34) son la cadena de
 * validación obligatoria de los writes: el agente lista/lee la OC —con sus
 * recepciones y su resumen de costos— antes de proponer crear, editar,
 * aprobar, recibir o cancelar.
 *
 * La recepción impacta stock y costos vía `PurchaseOrdersService`, dueño de la
 * guarda PO_VARIANT_001: una línea base (sin variante) sobre un producto CON
 * variantes se rechaza, nunca se auto-asigna variante. El handler la propaga
 * con su código para que el modelo ofrezca el escape hatch (cancelar la OC).
 */
export function createPurchasingTools(
  deps: PurchasingToolDeps,
): RegisteredTool[] {
  const { purchaseOrdersService, suppliersService } = deps;

  async function resolveOrderOrPreviewError(
    purchaseOrderId: number,
  ): Promise<{ ok: true; order: any } | { ok: false; preview: ToolPreview }> {
    try {
      const order = await purchaseOrdersService.findOne(purchaseOrderId);
      return { ok: true, order };
    } catch (error) {
      const info = describeError(error);
      return {
        ok: false,
        preview: previewError(
          `Orden de compra #${purchaseOrderId}`,
          info.message ||
            `La orden de compra ${purchaseOrderId} no existe en esta tienda.`,
        ),
      };
    }
  }

  return [
    // ─── O-33: list_purchase_orders (READ) ─────────────────────────────
    {
      name: 'list_purchase_orders',
      version: '1',
      domain: 'purchasing',
      readOnly: true,
      description:
        'Lista órdenes de compra de la tienda filtradas por proveedor, bodega, estado, texto o rango de montos, con paginación. Úsala para "¿qué OCs tengo pendientes?", "las compras a este proveedor" o "¿qué falta por recibir?". Devuelve filas compactas: para el detalle llama después a get_purchase_order.',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: {
            type: 'number',
            description: 'Filtra por proveedor (resuélvelo con find_supplier).',
          },
          location_id: {
            type: 'number',
            description: 'Filtra por bodega de recepción.',
          },
          status: {
            type: 'string',
            enum: PO_STATUSES,
            description: 'Filtra por estado de la orden.',
          },
          search: {
            type: 'string',
            description: 'Texto libre: número de orden, proveedor, notas.',
          },
          min_total: {
            type: 'number',
            description: 'Monto total mínimo.',
          },
          max_total: {
            type: 'number',
            description: 'Monto total máximo.',
          },
          page: {
            type: 'number',
            description: 'Página (por defecto 1).',
          },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 10, máximo 50).',
          },
        },
      },
      requiredPermissions: ['store:orders:purchase_orders:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: las órdenes de compra están acotadas por tenant.',
          });
        }

        if (args.status !== undefined && !PO_STATUSES.includes(args.status)) {
          return JSON.stringify({
            error: `status "${args.status}" inválido. Valores válidos: ${PO_STATUSES.join(', ')}.`,
          });
        }

        try {
          const query: PurchaseOrderQueryDto = {
            page: Math.max(Number(args.page) || 1, 1),
            limit: Math.min(Math.max(Number(args.limit) || 10, 1), 50),
            ...(args.supplier_id
              ? { supplier_id: Number(args.supplier_id) }
              : {}),
            ...(args.location_id
              ? { location_id: Number(args.location_id) }
              : {}),
            ...(args.status ? { status: args.status } : {}),
            ...(args.search ? { search: String(args.search) } : {}),
            ...(args.min_total !== undefined
              ? { min_total: Number(args.min_total) }
              : {}),
            ...(args.max_total !== undefined
              ? { max_total: Number(args.max_total) }
              : {}),
          };
          const result = await purchaseOrdersService.findAll(query);
          const rows = (result.data ?? []).map(compactPurchaseOrder);

          return JSON.stringify({
            resumen: `${rows.length} orden(es) de ${result.meta?.total ?? rows.length} en total`,
            pagina: result.meta?.page ?? 1,
            paginas: result.meta?.total_pages ?? 1,
            ordenes: rows,
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo listar las órdenes de compra: ${info.message}`,
          });
        }
      },
    },

    // ─── O-34: get_purchase_order (READ) ───────────────────────────────
    {
      name: 'get_purchase_order',
      version: '1',
      domain: 'purchasing',
      readOnly: true,
      description:
        'Detalle completo de una orden de compra: proveedor, bodega, líneas con cantidades pedidas/recibidas/pendientes, calendario de pagos, recepciones registradas y resumen de costos. Cadena obligatoria antes de manage_purchase_orders y approve_receive_purchase_order.',
      parameters: {
        type: 'object',
        properties: {
          purchase_order_id: {
            type: 'number',
            description: 'ID de la orden de compra.',
          },
          include_receptions: {
            type: 'boolean',
            description:
              'Incluye el historial de recepciones (por defecto true).',
          },
          include_cost_summary: {
            type: 'boolean',
            description:
              'Incluye el resumen de costos de la orden (por defecto true).',
          },
        },
        required: ['purchase_order_id'],
      },
      requiredPermissions: ['store:orders:purchase_orders:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: las órdenes de compra están acotadas por tenant.',
          });
        }

        const purchaseOrderId = toPositiveInt(args.purchase_order_id);
        if (!purchaseOrderId) {
          return JSON.stringify({ error: 'purchase_order_id inválido.' });
        }

        try {
          const withReceptions = args.include_receptions !== false;
          const withCosts = args.include_cost_summary !== false;

          const [order, receptions, costSummary] = await Promise.all([
            purchaseOrdersService.findOne(purchaseOrderId),
            withReceptions
              ? purchaseOrdersService.getReceptions(purchaseOrderId)
              : Promise.resolve(null),
            withCosts
              ? purchaseOrdersService.getCostSummary(purchaseOrderId)
              : Promise.resolve(null),
          ]);

          return JSON.stringify({
            orden: {
              ...compactPurchaseOrder(order),
              payment_terms: order.payment_terms ?? null,
              notes: order.notes ?? null,
              lineas: (order.purchase_order_items ?? []).map(
                compactPurchaseOrderLine,
              ),
              calendario_pagos: order.payment_schedules ?? [],
            },
            ...(receptions ? { recepciones: receptions } : {}),
            ...(withCosts ? { resumen_costos: costSummary } : {}),
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo leer la orden de compra ${purchaseOrderId}: ${info.message}`,
            next_step:
              'Verifica el ID con list_purchase_orders: la orden puede no existir en esta tienda.',
          });
        }
      },
    },

    // ─── O-35: manage_purchase_orders (WRITE) ──────────────────────────
    {
      name: 'manage_purchase_orders',
      version: '1',
      domain: 'purchasing',
      description:
        'Crea, edita o cancela órdenes de compra. Toda orden nace en borrador (draft): la aprobación y la recepción van por approve_receive_purchase_order. Lee primero la orden con get_purchase_order. Acciones: create (supplier_id + location_id + items), update (solo borrador), cancel.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'cancel'],
            description: 'Acción a ejecutar sobre la orden de compra.',
          },
          purchase_order_id: {
            type: 'number',
            description: 'ID de la orden (requerido para update y cancel).',
          },
          supplier_id: {
            type: 'number',
            description:
              'Proveedor (requerido para create; resuélvelo con find_supplier).',
          },
          location_id: {
            type: 'number',
            description:
              'Bodega donde se recibirá (requerida para create; resuélvela con get_inventory_locations).',
          },
          items: {
            type: 'array',
            description:
              'Líneas de la orden (requerido para create): product_id, quantity (entero ≥1) y unit_price (costo unitario, 0 para bonificación).',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                discount_percentage: { type: 'number' },
                tax_rate: { type: 'number' },
                notes: { type: 'string' },
              },
              required: ['product_id', 'quantity', 'unit_price'],
            },
          },
          expected_date: {
            type: 'string',
            description: 'Fecha esperada de entrega (YYYY-MM-DD).',
          },
          payment_terms: {
            type: 'string',
            description: 'Condiciones de pago (texto libre).',
          },
          notes: {
            type: 'string',
            description: 'Notas de la orden.',
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:orders:purchase_orders:create',
        'store:orders:purchase_orders:update',
        'store:orders:purchase_orders:cancel',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const action = String(args.action ?? '');
        if (!['create', 'update', 'cancel'].includes(action)) {
          return previewError(
            'Orden de compra',
            `action "${action}" inválida. Usa create, update o cancel.`,
          );
        }

        if (!context.store_id && !context.organization_id) {
          return previewError(
            'Orden de compra',
            'Sin tienda ni organización en contexto.',
          );
        }

        try {
          if (action === 'create') {
            const supplierId = toPositiveInt(args.supplier_id);
            const locationId = toPositiveInt(args.location_id);
            if (!supplierId || !locationId) {
              return previewError(
                'Nueva orden de compra',
                'create exige supplier_id y location_id.',
              );
            }
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return previewError(
                'Nueva orden de compra',
                'create exige al menos una línea en items.',
              );
            }
            const supplier = await suppliersService
              .findOne(supplierId)
              .catch(() => null);
            const estimated = items.reduce(
              (sum: number, line: any) =>
                sum +
                Number(line?.quantity ?? 0) * Number(line?.unit_price ?? 0),
              0,
            );
            return {
              status: 'ok',
              target: `Nueva OC — ${supplier?.name ?? `proveedor #${supplierId}`}`,
              changes: [
                {
                  field: 'supplier',
                  label: 'Proveedor',
                  from: null,
                  to: supplier?.name ?? `#${supplierId}`,
                },
                {
                  field: 'items',
                  label: 'Líneas',
                  from: null,
                  to: `${items.length} línea(s), estimado $${Math.round(estimated * 100) / 100}`,
                },
                {
                  field: 'status',
                  label: 'Estado inicial',
                  from: null,
                  to: 'draft (la aprobación es un acto aparte)',
                },
              ],
              domain: 'purchasing',
            };
          }

          const purchaseOrderId = toPositiveInt(args.purchase_order_id);
          if (!purchaseOrderId) {
            return previewError(
              'Orden de compra',
              `${action} exige purchase_order_id.`,
            );
          }
          const resolved = await resolveOrderOrPreviewError(purchaseOrderId);
          if (!resolved.ok) return resolved.preview;
          const order = resolved.order;
          const label = order.order_number
            ? `OC ${order.order_number} — ${order.suppliers?.name ?? 'sin proveedor'}`
            : `OC #${order.id}`;

          if (action === 'cancel') {
            if (['received', 'cancelled'].includes(order.status)) {
              return previewError(
                label,
                `La orden está en estado «${order.status}» y ya no puede cancelarse.`,
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
                  to: 'cancelled',
                },
              ],
              message:
                'Cancelar cierra la orden: lo ya recibido queda en stock y no se puede reabrir.',
              domain: 'purchasing',
            };
          }

          // update: solo borrador acepta ediciones escalares.
          if (order.status !== 'draft') {
            return previewError(
              label,
              `La orden está en estado «${order.status}»: solo un borrador (draft) acepta ediciones.`,
            );
          }
          return {
            status: 'ok',
            target: label,
            changes: [
              {
                field: 'order',
                label: 'Edición',
                from: 'draft actual',
                to: 'draft actualizado',
              },
            ],
            domain: 'purchasing',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Orden de compra', info.message);
        }
      },
      handler: async (args, context) => {
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            // Re-verificación: el proveedor sigue existiendo y el DTO valida.
            const supplierId = toPositiveInt(args.supplier_id);
            const locationId = toPositiveInt(args.location_id);
            const items = Array.isArray(args.items) ? args.items : [];
            if (!supplierId || !locationId || !items.length) {
              return toolError(
                'create exige supplier_id, location_id y al menos una línea en items.',
              );
            }
            const supplier = await suppliersService
              .findOne(supplierId)
              .catch(() => null);
            if (!supplier) {
              return toolError(
                `El proveedor ${supplierId} ya no existe en esta tienda.`,
                'Resuelve el proveedor de nuevo con find_supplier.',
              );
            }
            const checked = toValidatedDto(CreatePurchaseOrderDto, {
              supplier_id: supplierId,
              location_id: locationId,
              items: items.map((line: any) => ({
                product_id: Number(line.product_id),
                ...(line.product_variant_id !== undefined
                  ? { product_variant_id: Number(line.product_variant_id) }
                  : {}),
                quantity: Number(line.quantity),
                unit_price: Number(line.unit_price),
                ...(line.discount_percentage !== undefined
                  ? { discount_percentage: Number(line.discount_percentage) }
                  : {}),
                ...(line.tax_rate !== undefined
                  ? { tax_rate: Number(line.tax_rate) }
                  : {}),
                ...(line.notes ? { notes: String(line.notes) } : {}),
              })),
              ...(args.expected_date
                ? { expected_date: String(args.expected_date) }
                : {}),
              ...(args.payment_terms
                ? { payment_terms: String(args.payment_terms) }
                : {}),
              ...(args.notes ? { notes: String(args.notes) } : {}),
            });
            if (!checked.ok) return toolError(checked.message);
            const created =
              await purchaseOrdersService.create(checked.dto);
            return JSON.stringify({
              resumen: `OC ${created.order_number ?? created.id} creada en borrador para ${supplier.name}`,
              purchase_order_id: created.id,
              order_number: created.order_number ?? null,
              status: created.status ?? 'draft',
              siguiente_paso:
                'La orden nació en draft: apruébala con approve_receive_purchase_order (approve) cuando esté lista.',
            });
          }

          const purchaseOrderId = toPositiveInt(args.purchase_order_id);
          if (!purchaseOrderId) {
            return toolError(`${action} exige purchase_order_id.`);
          }

          if (action === 'cancel') {
            // Re-verificación: la orden sigue siendo cancelable.
            const fresh =
              await purchaseOrdersService.findOne(purchaseOrderId);
            if (['received', 'cancelled'].includes(fresh.status)) {
              return toolError(
                `La OC ${fresh.order_number ?? purchaseOrderId} ya está en «${fresh.status}»: nada que cancelar.`,
              );
            }
            const cancelled =
              await purchaseOrdersService.cancel(purchaseOrderId);
            return JSON.stringify({
              resumen: `OC ${cancelled.order_number ?? purchaseOrderId} cancelada`,
              purchase_order_id: purchaseOrderId,
              status: cancelled.status ?? 'cancelled',
            });
          }

          if (action === 'update') {
            // Re-verificación: la orden sigue en borrador.
            const fresh =
              await purchaseOrdersService.findOne(purchaseOrderId);
            if (fresh.status !== 'draft') {
              return toolError(
                `La OC ${fresh.order_number ?? purchaseOrderId} pasó a «${fresh.status}»: solo un borrador acepta ediciones.`,
              );
            }
            const checked = toValidatedDto(UpdatePurchaseOrderDto, {
              ...(args.supplier_id
                ? { supplier_id: Number(args.supplier_id) }
                : {}),
              ...(args.location_id
                ? { location_id: Number(args.location_id) }
                : {}),
              ...(args.expected_date
                ? { expected_date: String(args.expected_date) }
                : {}),
              ...(args.payment_terms
                ? { payment_terms: String(args.payment_terms) }
                : {}),
              ...(args.notes ? { notes: String(args.notes) } : {}),
            });
            if (!checked.ok) return toolError(checked.message);
            const updated = await purchaseOrdersService.update(
              purchaseOrderId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `OC ${updated.order_number ?? purchaseOrderId} actualizada (sigue en draft)`,
              purchase_order_id: purchaseOrderId,
              status: updated.status ?? 'draft',
            });
          }

          return toolError(
            `action "${action}" inválida. Usa create, update o cancel.`,
          );
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Lee la orden con get_purchase_order para ver su estado actual antes de reintentar.',
            info.code,
          );
        }
      },
    },

    // ─── O-36: approve_receive_purchase_order (WRITE) ──────────────────
    {
      name: 'approve_receive_purchase_order',
      version: '1',
      domain: 'purchasing',
      description:
        'Aprueba una OC en borrador y/o recibe mercancía contra ella. La recepción mueve stock real y recalcula costos: exige líneas con cantidad recibida. Guarda PO_VARIANT_001: una línea base sobre un producto con variantes se rechaza (cancela la OC y recrérala con variante). Lee primero con get_purchase_order.',
      parameters: {
        type: 'object',
        properties: {
          purchase_order_id: {
            type: 'number',
            description: 'ID de la orden de compra.',
          },
          action: {
            type: 'string',
            enum: ['approve', 'receive', 'approve_and_receive'],
            description:
              'approve: draft→approved. receive: registra ingreso de mercancía (mueve stock). approve_and_receive: ambas en secuencia.',
          },
          items: {
            type: 'array',
            description:
              'Líneas a recibir (requerido para receive): id de la línea de la OC y quantity_received en unidades de stock.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                quantity_received: { type: 'number' },
                serial_numbers: {
                  type: 'array',
                  items: { type: 'string' },
                },
                new_base_price: { type: 'number' },
                new_profit_margin: { type: 'number' },
              },
              required: ['id', 'quantity_received'],
            },
          },
          notes: {
            type: 'string',
            description: 'Notas de la recepción.',
          },
          supplier_invoice_number: {
            type: 'string',
            description: 'Número de factura del proveedor para esta compra.',
          },
          supplier_invoice_date: {
            type: 'string',
            description:
              'Fecha de la factura del proveedor (YYYY-MM-DD): ubica el IVA descontable en el periodo correcto.',
          },
        },
        required: ['purchase_order_id', 'action'],
      },
      requiredPermissions: [
        'store:orders:purchase_orders:approve',
        'store:orders:purchase_orders:receive',
      ],
      requiresConfirmation: true,
      preview: async (args) => {
        const action = String(args.action ?? '');
        if (!['approve', 'receive', 'approve_and_receive'].includes(action)) {
          return previewError(
            'Orden de compra',
            `action "${action}" inválida. Usa approve, receive o approve_and_receive.`,
          );
        }

        const purchaseOrderId = toPositiveInt(args.purchase_order_id);
        if (!purchaseOrderId) {
          return previewError('Orden de compra', 'purchase_order_id inválido.');
        }

        try {
          const resolved = await resolveOrderOrPreviewError(purchaseOrderId);
          if (!resolved.ok) return resolved.preview;
          const order = resolved.order;
          const label = order.order_number
            ? `OC ${order.order_number} — ${order.suppliers?.name ?? 'sin proveedor'}`
            : `OC #${order.id}`;

          if (action === 'approve' || action === 'approve_and_receive') {
            if (action === 'approve' && order.status !== 'draft') {
              return previewError(
                label,
                `La orden está en «${order.status}»: solo un borrador (draft) puede aprobarse.`,
              );
            }
            if (action === 'approve_and_receive' && order.status !== 'draft') {
              return previewError(
                label,
                `approve_and_receive exige la orden en borrador (está en «${order.status}»): usa receive directamente.`,
              );
            }
          }

          if (action === 'receive' || action === 'approve_and_receive') {
            if (
              action === 'receive' &&
              !['approved', 'partial'].includes(order.status)
            ) {
              return previewError(
                label,
                `La orden está en «${order.status}»: solo una orden aprobada (o parcial) recibe mercancía.`,
              );
            }
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return previewError(
                label,
                'receive exige al menos una línea en items (id de línea + quantity_received).',
              );
            }
            const lines = (order.purchase_order_items ?? []).map(
              compactPurchaseOrderLine,
            );
            const detail = items
              .map((raw: any) => {
                const line = lines.find((l: any) => l.line_id === Number(raw.id));
                const name = line?.product ?? `línea #${raw.id}`;
                const pending = line ? ` (pendiente ${line.pending})` : '';
                return `${name}: ${raw.quantity_received}u${pending}`;
              })
              .join('; ');
            return {
              status: action === 'receive' ? 'warning' : 'ok',
              target: label,
              changes: [
                ...(action === 'approve_and_receive'
                  ? [
                      {
                        field: 'status',
                        label: 'Estado',
                        from: order.status,
                        to: 'approved → recepción',
                      },
                    ]
                  : []),
                {
                  field: 'reception',
                  label: 'Recepción',
                  from: null,
                  to: detail,
                },
              ],
              message:
                'La recepción mueve stock real a la bodega y recalcula costos. Guarda PO_VARIANT_001: una línea sin variante sobre un producto con variantes rechaza la recepción.',
              domain: 'purchasing',
            };
          }

          return {
            status: 'ok',
            target: label,
            changes: [
              {
                field: 'status',
                label: 'Estado',
                from: order.status,
                to: 'approved',
              },
            ],
            domain: 'purchasing',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Orden de compra', info.message);
        }
      },
      handler: async (args) => {
        const action = String(args.action ?? '');
        const purchaseOrderId = toPositiveInt(args.purchase_order_id);
        if (!purchaseOrderId) {
          return toolError('purchase_order_id inválido.');
        }

        const buildReceiveDto = () =>
          toValidatedDto(ReceivePurchaseOrderDto, {
            items: (Array.isArray(args.items) ? args.items : []).map(
              (raw: any) => ({
                id: Number(raw.id),
                quantity_received: Number(raw.quantity_received),
                ...(raw.serial_numbers
                  ? { serial_numbers: raw.serial_numbers.map(String) }
                  : {}),
                ...(raw.new_base_price !== undefined
                  ? { new_base_price: Number(raw.new_base_price) }
                  : {}),
                ...(raw.new_profit_margin !== undefined
                  ? { new_profit_margin: Number(raw.new_profit_margin) }
                  : {}),
              }),
            ),
            ...(args.notes ? { notes: String(args.notes) } : {}),
            ...(args.supplier_invoice_number
              ? { supplier_invoice_number: String(args.supplier_invoice_number) }
              : {}),
            ...(args.supplier_invoice_date
              ? { supplier_invoice_date: String(args.supplier_invoice_date) }
              : {}),
          });

        try {
          if (action === 'approve') {
            // Re-verificación: la orden sigue en borrador.
            const fresh = await purchaseOrdersService.findOne(purchaseOrderId);
            if (fresh.status !== 'draft') {
              return toolError(
                `La OC ${fresh.order_number ?? purchaseOrderId} ya está en «${fresh.status}»: nada que aprobar.`,
              );
            }
            const approved =
              await purchaseOrdersService.approve(purchaseOrderId);
            return JSON.stringify({
              resumen: `OC ${approved.order_number ?? purchaseOrderId} aprobada`,
              purchase_order_id: purchaseOrderId,
              status: approved.status ?? 'approved',
              siguiente_paso:
                'Recibe la mercancía con approve_receive_purchase_order (receive) cuando llegue a bodega.',
            });
          }

          if (action === 'receive' || action === 'approve_and_receive') {
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return toolError(
                'receive exige al menos una línea en items.',
                'Lee la OC con get_purchase_order para ver los IDs de línea y sus pendientes.',
              );
            }
            const checked = buildReceiveDto();
            if (!checked.ok) return toolError(checked.message);

            if (action === 'approve_and_receive') {
              // Re-verificación: la orden sigue en borrador antes de aprobar.
              const fresh =
                await purchaseOrdersService.findOne(purchaseOrderId);
              if (fresh.status !== 'draft') {
                return toolError(
                  `La OC ${fresh.order_number ?? purchaseOrderId} ya está en «${fresh.status}»: usa receive directamente.`,
                );
              }
              await purchaseOrdersService.approve(purchaseOrderId);
            } else {
              // Re-verificación: la orden sigue siendo receivable.
              const fresh =
                await purchaseOrdersService.findOne(purchaseOrderId);
              if (!['approved', 'partial'].includes(fresh.status)) {
                return toolError(
                  `La OC ${fresh.order_number ?? purchaseOrderId} está en «${fresh.status}»: solo una orden aprobada o parcial recibe mercancía.`,
                );
              }
            }

            try {
              const received = await purchaseOrdersService.receive(
                purchaseOrderId,
                checked.dto,
              );
              return JSON.stringify({
                resumen: `Recepción registrada en OC ${received.order_number ?? purchaseOrderId}: ${items.length} línea(s)`,
                purchase_order_id: purchaseOrderId,
                status: received.status ?? null,
              });
            } catch (error) {
              const info = describeError(error);
              // PO_VARIANT_001 se propaga con su código: el modelo ofrece el
              // escape hatch (cancelar la OC y recrearla con variante).
              if (info.code === 'PO_VARIANT_001') {
                return toolError(
                  info.message,
                  'Cancela esta OC con manage_purchase_orders (cancel) y créala de nuevo indicando la variante (product_variant_id) en cada línea del producto.',
                  info.code,
                );
              }
              throw error;
            }
          }

          return toolError(
            `action "${action}" inválida. Usa approve, receive o approve_and_receive.`,
          );
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Lee la orden con get_purchase_order para ver su estado y recepciones actuales.',
            info.code,
          );
        }
      },
    },
  ];
}

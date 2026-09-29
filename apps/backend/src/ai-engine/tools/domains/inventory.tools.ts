import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { StockLevelsService } from '../../../domains/store/inventory/stock-levels/stock-levels.service';
import { InventoryIntegrationService } from '../../../domains/store/inventory/shared/services/inventory-integration.service';
import { InventoryAdjustmentsService } from '../../../domains/store/inventory/adjustments/inventory-adjustments.service';
import { MovementsService } from '../../../domains/store/inventory/movements/movements.service';
import { LocationsService } from '../../../domains/store/inventory/locations/locations.service';
import { StockTransfersService } from '../../../domains/store/orders/stock-transfers/stock-transfers.service';
import { CreateTransferDto } from '../../../domains/store/orders/stock-transfers/dto/create-transfer.dto';
import { UpdateTransferDto } from '../../../domains/store/orders/stock-transfers/dto/update-transfer.dto';
import { CompleteTransferDto } from '../../../domains/store/orders/stock-transfers/dto/complete-transfer.dto';

export interface InventoryToolServices {
  stockLevelsService: StockLevelsService;
  inventoryIntegrationService: InventoryIntegrationService;
  adjustmentsService: InventoryAdjustmentsService;
  movementsService: MovementsService;
  locationsService: LocationsService;
  transfersService: StockTransfersService;
}

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
  domain = 'inventory',
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

function compactTransferLine(item: any) {
  return {
    line_id: item.id,
    product_id: item.product_id,
    product: item.products?.name ?? null,
    sku: item.products?.sku ?? null,
    variant_id: item.product_variant_id ?? null,
    variant: item.product_variants?.name ?? null,
    quantity: item.quantity !== undefined ? Number(item.quantity) : null,
    quantity_received:
      item.quantity_received !== undefined && item.quantity_received !== null
        ? Number(item.quantity_received)
        : null,
  };
}

function transferLabel(t: any): string {
  const number = t.transfer_number ? ` ${t.transfer_number}` : ` #${t.id}`;
  const from = t.from_location?.name ?? `#${t.from_location_id}`;
  const to = t.to_location?.name ?? `#${t.to_location_id}`;
  return `Transferencia${number} — ${from} → ${to}`;
}

const ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
] as const;

const MOVEMENT_TYPES = [
  'stock_in',
  'stock_out',
  'transfer',
  'adjustment',
  'sale',
  'return',
  'damage',
  'expiration',
] as const;

const LOCATION_TYPES = [
  'warehouse',
  'store',
  'production_area',
  'receiving_area',
  'shipping_area',
  'quarantine',
  'damaged_goods',
] as const;

export function createInventoryTools(
  services: InventoryToolServices,
): RegisteredTool[] {
  return [
    // ─── Tool 1: get_stock_levels ───────────────────────────────────
    {
      name: 'get_stock_levels',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'Get current stock levels for products, optionally filtered by product, location, or low-stock status. Returns on_hand, reserved, and available quantities per location.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'Filter by specific product ID',
          },
          location_id: {
            type: 'number',
            description: 'Filter by specific inventory location ID',
          },
          low_stock_only: {
            type: 'boolean',
            description:
              'Only show products below their reorder point (default: false)',
          },
        },
      },
      requiredPermissions: ['store:inventory:stock_levels:read'],
      handler: async (args, context) => {
        const query: any = {};
        if (args.product_id) query.product_id = Number(args.product_id);
        if (args.location_id) query.location_id = Number(args.location_id);

        let results;
        if (args.low_stock_only) {
          results = await services.stockLevelsService.getStockAlerts(query);
        } else {
          results = await services.stockLevelsService.findAll(query);
        }

        const formatted = results.map((r: any) => ({
          product_id: r.product_id,
          product: r.products?.name,
          sku: r.products?.sku,
          location: r.inventory_locations?.name,
          location_type: r.inventory_locations?.type,
          on_hand: r.quantity_on_hand,
          reserved: r.quantity_reserved,
          available: r.quantity_available,
          reorder_point: r.reorder_point,
        }));

        return JSON.stringify({
          summary: `Found ${formatted.length} stock level record(s)`,
          data: formatted,
        });
      },
    },

    // ─── Tool 2: get_low_stock_alerts ────────────────────────────────
    {
      name: 'get_low_stock_alerts',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'Get products that are below their minimum stock threshold and need reordering, with current stock vs reorder point per location.',
      parameters: {
        type: 'object',
        properties: {
          location_id: {
            type: 'number',
            description: 'Filter alerts by specific location ID',
          },
          limit: {
            type: 'number',
            description: 'Maximum alerts to return (default: 20, max: 100)',
          },
        },
      },
      requiredPermissions: ['store:inventory:stock_levels:read'],
      handler: async (args, context) => {
        const orgId = context.organization_id;
        if (!orgId) {
          return JSON.stringify({
            error: 'Organization context is required',
          });
        }

        const limit = Math.min(Number(args.limit) || 20, 100);
        const locationId = args.location_id
          ? Number(args.location_id)
          : undefined;

        const alerts =
          await services.inventoryIntegrationService.getLowStockAlerts(
            orgId,
            locationId,
          );

        const formatted = alerts.slice(0, limit).map((a: any) => ({
          product_id: a.productId,
          product: a.productName,
          location_id: a.locationId,
          location: a.locationName,
          current_stock: a.currentStock,
          reorder_point: a.reorderPoint,
          deficit: a.reorderPoint - a.currentStock,
        }));

        return JSON.stringify({
          summary: `${formatted.length} product(s) below reorder point`,
          data: formatted,
        });
      },
    },

    // ─── Tool 3: check_stock_availability ────────────────────────────
    {
      name: 'check_stock_availability',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'Check if sufficient stock is available for a product across all locations. Returns availability status, total available quantity, per-location breakdown, and suggested allocation.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'Product ID to check availability for',
          },
          quantity: {
            type: 'number',
            description: 'Required quantity',
          },
          product_variant_id: {
            type: 'number',
            description: 'Product variant ID (if checking a specific variant)',
          },
        },
        required: ['product_id', 'quantity'],
      },
      requiredPermissions: ['store:inventory:stock_levels:read'],
      handler: async (args, context) => {
        const orgId = context.organization_id;
        if (!orgId) {
          return JSON.stringify({
            error: 'Organization context is required',
          });
        }

        const result =
          await services.inventoryIntegrationService.validateConsolidatedStockAvailability(
            orgId,
            Number(args.product_id),
            Number(args.quantity),
            args.product_variant_id
              ? Number(args.product_variant_id)
              : undefined,
          );

        return JSON.stringify({
          summary: result.isAvailable
            ? `Stock available: ${result.totalAvailable} units across ${result.locations.length} location(s)`
            : `Insufficient stock: ${result.totalAvailable} available, ${args.quantity} needed`,
          is_available: result.isAvailable,
          total_available: result.totalAvailable,
          required: Number(args.quantity),
          locations: result.locations,
          suggested_allocation: result.suggestedAllocation,
        });
      },
    },

    // ─── Tool 4: get_stock_movements ─────────────────────────────────
    {
      name: 'get_stock_movements',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'Query inventory movement history with filters for product, location, movement type, and date range.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'Filter by product ID',
          },
          from_location_id: {
            type: 'number',
            description: 'Filter by source location',
          },
          to_location_id: {
            type: 'number',
            description: 'Filter by destination location',
          },
          movement_type: {
            type: 'string',
            enum: MOVEMENT_TYPES,
            description: 'Filter by movement type',
          },
          start_date: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD)',
          },
          end_date: {
            type: 'string',
            description: 'End date (YYYY-MM-DD)',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 20, max: 50)',
          },
        },
      },
      requiredPermissions: ['store:inventory:movements:read'],
      handler: async (args, context) => {
        const query: any = {};
        if (args.product_id) query.product_id = Number(args.product_id);
        if (args.from_location_id)
          query.from_location_id = Number(args.from_location_id);
        if (args.to_location_id)
          query.to_location_id = Number(args.to_location_id);
        if (args.movement_type) query.movement_type = args.movement_type;
        if (args.start_date) query.start_date = args.start_date;
        if (args.end_date) query.end_date = args.end_date;

        const limit = Math.min(Number(args.limit) || 20, 50);
        const paginated = await services.movementsService.findAll({
          ...query,
          page: 1,
          limit,
        });
        const results = paginated.data;
        const formatted = results.map((m: any) => ({
          id: m.id,
          product: m.products?.name,
          sku: m.products?.sku,
          from_location: m.from_location?.name,
          to_location: m.to_location?.name,
          quantity: m.quantity,
          type: m.movement_type,
          reason: m.reason,
          date: m.created_at,
        }));

        return JSON.stringify({
          summary: `${formatted.length} movement(s) found`,
          data: formatted,
        });
      },
    },

    // ─── Tool 5: get_inventory_locations ─────────────────────────────
    {
      name: 'get_inventory_locations',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'List active inventory locations (warehouses, stores, etc.) with their type and code. Useful for finding location IDs needed by other tools.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: LOCATION_TYPES,
            description: 'Filter by location type',
          },
          search: {
            type: 'string',
            description: 'Search by location name or code',
          },
        },
      },
      requiredPermissions: ['store:inventory:locations:read'],
      handler: async (args, context) => {
        const query: any = { is_active: true };
        if (args.type) query.type = args.type;
        if (args.search) query.search = args.search;

        const result = await services.locationsService.findAll(query);

        const formatted = result.data.map((loc: any) => ({
          id: loc.id,
          name: loc.name,
          code: loc.code,
          type: loc.type,
          is_active: loc.is_active,
        }));

        return JSON.stringify({
          summary: `${formatted.length} location(s) found`,
          data: formatted,
        });
      },
    },

    // ─── Tool 6: get_stock_adjustments ───────────────────────────────
    {
      name: 'get_stock_adjustments',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'Query inventory adjustment history (damage, loss, theft, expiration, count corrections) with filters for product, location, type, and date range.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'Filter by product ID',
          },
          location_id: {
            type: 'number',
            description: 'Filter by location ID',
          },
          adjustment_type: {
            type: 'string',
            enum: ADJUSTMENT_TYPES,
            description: 'Filter by adjustment type',
          },
          start_date: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD)',
          },
          end_date: {
            type: 'string',
            description: 'End date (YYYY-MM-DD)',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 20, max: 50)',
          },
          offset: {
            type: 'number',
            description: 'Offset for pagination (default: 0)',
          },
        },
      },
      requiredPermissions: ['store:inventory:adjustments:read'],
      handler: async (args, context) => {
        const orgId = context.organization_id;
        if (!orgId) {
          return JSON.stringify({
            error: 'Organization context is required',
          });
        }

        const query: any = {
          organizationId: orgId,
          limit: Math.min(Number(args.limit) || 20, 50),
          offset: Number(args.offset) || 0,
        };
        if (args.product_id) query.productId = Number(args.product_id);
        if (args.location_id) query.locationId = Number(args.location_id);
        if (args.adjustment_type) query.type = args.adjustment_type;
        if (args.start_date) query.startDate = new Date(args.start_date);
        if (args.end_date) query.endDate = new Date(args.end_date);

        const result = await services.adjustmentsService.getAdjustments(query);

        const formatted = result.adjustments.map((a: any) => ({
          id: a.id,
          product: a.products?.name,
          sku: a.products?.sku,
          variant: a.product_variants?.name,
          location: a.inventory_locations?.name,
          type: a.adjustment_type,
          quantity_before: a.quantity_before,
          quantity_after: a.quantity_after,
          quantity_change: a.quantity_change,
          description: a.description,
          status: a.approved_by_user_id ? 'approved' : 'pending',
          created_at: a.created_at,
        }));

        return JSON.stringify({
          summary: `${formatted.length} adjustment(s) found (${result.total} total)`,
          data: formatted,
          total: result.total,
          has_more: result.hasMore,
        });
      },
    },

    // ─── Tool 7: create_stock_adjustment (WRITE) ─────────────────────
    {
      name: 'create_stock_adjustment',
      version: '1',
      domain: 'inventory',
      description:
        'Create an inventory stock adjustment for damage, loss, theft, expiration, count variance, or manual correction. This changes the stock quantity at a specific location.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'Product ID to adjust',
          },
          location_id: {
            type: 'number',
            description:
              'Location ID where stock resides. Use get_inventory_locations to find IDs.',
          },
          quantity_after: {
            type: 'number',
            description:
              'The new total quantity on hand after the adjustment (not the delta)',
          },
          adjustment_type: {
            type: 'string',
            enum: ADJUSTMENT_TYPES,
            description: 'Type of adjustment',
          },
          reason: {
            type: 'string',
            description:
              'Description/reason for the adjustment (recommended for audit trail)',
          },
          product_variant_id: {
            type: 'number',
            description: 'Product variant ID (if adjusting a specific variant)',
          },
        },
        required: [
          'product_id',
          'location_id',
          'quantity_after',
          'adjustment_type',
        ],
      },
      requiredPermissions: ['store:inventory:adjustments:create'],
      requiresConfirmation: true,
      handler: async (args, context) => {
        const orgId = context.organization_id;
        const userId = context.user_id;

        if (!orgId || !userId) {
          return JSON.stringify({
            error:
              'Organization and user context are required for stock adjustments',
          });
        }

        // `organization_id` y `created_by_user_id` los resuelve el servicio del
        // contexto de la petición; ya no se aceptan en el DTO.
        const adjustment = await services.adjustmentsService.createAdjustment({
          product_id: Number(args.product_id),
          product_variant_id: args.product_variant_id
            ? Number(args.product_variant_id)
            : undefined,
          location_id: Number(args.location_id),
          type: args.adjustment_type,
          quantity_after: Number(args.quantity_after),
          description: args.reason || undefined,
        });

        return JSON.stringify({
          summary: `Stock adjustment created: ${adjustment.adjustment_type}, quantity ${adjustment.quantity_before} → ${adjustment.quantity_after}`,
          data: {
            id: adjustment.id,
            product_id: adjustment.product_id,
            location_id: adjustment.location_id,
            type: adjustment.adjustment_type,
            quantity_before: adjustment.quantity_before,
            quantity_after: adjustment.quantity_after,
            quantity_change: adjustment.quantity_change,
            status: adjustment.approved_by_user_id ? 'approved' : 'pending',
            created_at: adjustment.created_at,
          },
        });
      },
    },

    // ─── O-14: manage_stock_transfers (WRITE) ──────────────────────────
    // Flujo draft→pending→in_transit→received preservado: la tool delega en
    // `StockTransfersService`, que es quien muta stock vía `StockLevelManager`
    // (reserva al aprobar, mueve al completar, libera al cancelar). La tool
    // jamás toca `stock_levels` directo. Cadena: get_stock_levels /
    // get_inventory_locations → write.
    {
      name: 'manage_stock_transfers',
      version: '1',
      domain: 'inventory',
      description:
        'Crea, edita, aprueba, completa o cancela transferencias de stock entre bodegas. Flujo: create (borrador) → approve (reserva en origen, pasa a tránsito) → complete (mueve el stock a destino) o cancel (libera reservas). Lee primero get_stock_levels y resuelve bodegas con get_inventory_locations.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'approve', 'complete', 'cancel'],
            description: 'Acción sobre la transferencia.',
          },
          transfer_id: {
            type: 'number',
            description:
              'ID de la transferencia (requerido para update, approve, complete y cancel).',
          },
          from_location_id: {
            type: 'number',
            description: 'Bodega origen (requerida para create).',
          },
          to_location_id: {
            type: 'number',
            description: 'Bodega destino (requerida para create).',
          },
          items: {
            type: 'array',
            description:
              'Líneas (requerido para create): product_id, quantity y product_variant_id opcional. Para complete: id de línea + quantity_received.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
                quantity_received: { type: 'number' },
                cost_per_unit: { type: 'number' },
                notes: { type: 'string' },
              },
            },
          },
          notes: {
            type: 'string',
            description: 'Notas de la transferencia (create/update).',
          },
          expected_date: {
            type: 'string',
            description: 'Fecha esperada (YYYY-MM-DD, create/update).',
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:stock-transfers:create',
        'store:stock-transfers:update',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        const action = String(args.action ?? '');
        if (
          !['create', 'update', 'approve', 'complete', 'cancel'].includes(
            action,
          )
        ) {
          return previewError(
            'Transferencia de stock',
            `action "${action}" inválida. Usa create, update, approve, complete o cancel.`,
          );
        }

        if (!context.store_id && !context.organization_id) {
          return previewError(
            'Transferencia de stock',
            'Sin tienda ni organización en contexto.',
          );
        }

        try {
          if (action === 'create') {
            const fromId = toPositiveInt(args.from_location_id);
            const toId = toPositiveInt(args.to_location_id);
            if (!fromId || !toId) {
              return previewError(
                'Nueva transferencia',
                'create exige from_location_id y to_location_id.',
              );
            }
            if (fromId === toId) {
              return previewError(
                'Nueva transferencia',
                'Origen y destino no pueden ser la misma bodega.',
              );
            }
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return previewError(
                'Nueva transferencia',
                'create exige al menos una línea en items.',
              );
            }
            const locations = await services.locationsService
              .findAll({ is_active: true, limit: 100 } as any)
              .catch(() => ({ data: [] }));
            const byId = new Map(
              ((locations as any)?.data ?? []).map((loc: any) => [
                loc.id,
                loc.name,
              ]),
            );
            const from = byId.get(fromId) ?? `bodega #${fromId}`;
            const to = byId.get(toId) ?? `bodega #${toId}`;
            const totalUnits = items.reduce(
              (sum: number, line: any) => sum + Number(line?.quantity ?? 0),
              0,
            );
            const detail = items
              .map(
                (line: any) =>
                  `producto #${line?.product_id}${line?.product_variant_id ? ` (variante #${line.product_variant_id})` : ''} x${line?.quantity ?? '?'}`,
              )
              .join('; ');
            return {
              status: 'ok',
              target: `Nueva transferencia — ${from} → ${to}`,
              changes: [
                {
                  field: 'route',
                  label: 'Ruta',
                  from: null,
                  to: `${from} → ${to}`,
                },
                {
                  field: 'items',
                  label: `Líneas (${totalUnits} unidades)`,
                  from: null,
                  to: detail,
                },
                {
                  field: 'status',
                  label: 'Estado inicial',
                  from: null,
                  to: 'pending (aprobar reserva en origen)',
                },
              ],
              domain: 'inventory',
            };
          }

          const transferId = toPositiveInt(args.transfer_id);
          if (!transferId) {
            return previewError(
              'Transferencia de stock',
              `${action} exige transfer_id.`,
            );
          }
          const transfer =
            await services.transfersService.findOne(transferId);
          if (!transfer) {
            return previewError(
              `Transferencia #${transferId}`,
              `La transferencia ${transferId} no existe en esta tienda.`,
            );
          }
          const label = transferLabel(transfer);
          const lines = (transfer.stock_transfer_items ?? []).map(
            compactTransferLine,
          );
          const lineDetail =
            lines
              .map(
                (line: any) =>
                  `${line.product ?? `producto #${line.product_id}`} x${line.quantity}`,
              )
              .join('; ') || 'sin líneas';

          if (action === 'update') {
            if (!['draft', 'pending'].includes(transfer.status)) {
              return previewError(
                label,
                `La transferencia está en «${transfer.status}»: solo un borrador/pendiente acepta ediciones.`,
              );
            }
            return {
              status: 'ok',
              target: label,
              changes: [
                {
                  field: 'transfer',
                  label: 'Edición',
                  from: `${transfer.status}, ${lineDetail}`,
                  to: 'transferencia actualizada',
                },
              ],
              domain: 'inventory',
            };
          }

          if (action === 'approve') {
            if (!['draft', 'pending'].includes(transfer.status)) {
              return previewError(
                label,
                `La transferencia está en «${transfer.status}»: solo una pendiente puede aprobarse.`,
              );
            }
            return {
              status: 'warning',
              target: label,
              changes: [
                {
                  field: 'status',
                  label: 'Estado',
                  from: transfer.status,
                  to: 'in_transit (reserva en origen)',
                },
                { field: 'items', label: 'Líneas', from: null, to: lineDetail },
              ],
              message:
                'Aprobar reserva las unidades en la bodega origen: quedan apartadas hasta completar o cancelar.',
              domain: 'inventory',
            };
          }

          if (action === 'complete') {
            if (transfer.status !== 'in_transit') {
              return previewError(
                label,
                `La transferencia está en «${transfer.status}»: solo una en tránsito (in_transit) puede completarse.`,
              );
            }
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return previewError(
                label,
                'complete exige items con id de línea + quantity_received.',
              );
            }
            const over = items.find((raw: any) => {
              const line = lines.find(
                (l: any) => l.line_id === Number(raw.id),
              );
              return (
                line && Number(raw.quantity_received) > Number(line.quantity)
              );
            });
            if (over) {
              return previewError(
                label,
                `La línea #${over.id} recibe ${over.quantity_received}u pero solo se despacharon ${lines.find((l: any) => l.line_id === Number(over.id))?.quantity}u: no se puede recibir más de lo enviado.`,
              );
            }
            const received = items
              .map((raw: any) => {
                const line = lines.find(
                  (l: any) => l.line_id === Number(raw.id),
                );
                return `${line?.product ?? `línea #${raw.id}`}: ${raw.quantity_received}u`;
              })
              .join('; ');
            return {
              status: 'warning',
              target: label,
              changes: [
                {
                  field: 'status',
                  label: 'Estado',
                  from: 'in_transit',
                  to: 'received (mueve stock a destino)',
                },
                {
                  field: 'reception',
                  label: 'Recepción',
                  from: null,
                  to: received,
                },
              ],
              message:
                'Completar descuenta en origen y acredita en destino con costeo: es el movimiento real de stock.',
              domain: 'inventory',
            };
          }

          // cancel
          if (['completed', 'received', 'cancelled'].includes(transfer.status)) {
            return previewError(
              label,
              `La transferencia está en «${transfer.status}» y ya no puede cancelarse.`,
            );
          }
          return {
            status: 'warning',
            target: label,
            changes: [
              {
                field: 'status',
                label: 'Estado',
                from: transfer.status,
                to: 'cancelled (libera reservas en origen)',
              },
            ],
            message:
              'Cancelar libera las reservas en origen. Lo ya recibido no se revierte por esta vía.',
            domain: 'inventory',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Transferencia de stock', info.message);
        }
      },
      handler: async (args, context) => {
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            const fromId = toPositiveInt(args.from_location_id);
            const toId = toPositiveInt(args.to_location_id);
            const items = Array.isArray(args.items) ? args.items : [];
            if (!fromId || !toId || !items.length) {
              return toolError(
                'create exige from_location_id, to_location_id y al menos una línea en items.',
              );
            }
            if (fromId === toId) {
              return toolError(
                'Origen y destino no pueden ser la misma bodega.',
              );
            }
            const checked = toValidatedDto(CreateTransferDto, {
              from_location_id: fromId,
              to_location_id: toId,
              items: items.map((line: any) => ({
                product_id: Number(line.product_id),
                ...(line.product_variant_id !== undefined
                  ? {
                      product_variant_id: Number(line.product_variant_id),
                    }
                  : {}),
                quantity: Number(line.quantity),
                ...(line.cost_per_unit !== undefined
                  ? { cost_per_unit: Number(line.cost_per_unit) }
                  : {}),
                ...(line.notes ? { notes: String(line.notes) } : {}),
              })),
              ...(args.notes ? { notes: String(args.notes) } : {}),
              ...(args.expected_date
                ? { expected_date: new Date(String(args.expected_date)) }
                : {}),
            });
            if (!checked.ok) return toolError(checked.message);
            const created =
              await services.transfersService.create(checked.dto);
            return JSON.stringify({
              resumen: `Transferencia ${created.transfer_number ?? `#${created.id}`} creada (pendiente de aprobación)`,
              transfer_id: created.id,
              transfer_number: created.transfer_number ?? null,
              status: created.status ?? 'pending',
              siguiente_paso:
                'Apruébala con manage_stock_transfers (approve) para reservar en origen.',
            });
          }

          const transferId = toPositiveInt(args.transfer_id);
          if (!transferId) {
            return toolError(`${action} exige transfer_id.`);
          }

          // Re-verificación común: la transferencia sigue existiendo y se
          // re-lee su estado actual (el preview es proyección, no transacción).
          const fresh = await services.transfersService.findOne(transferId);
          if (!fresh) {
            return toolError(
              `La transferencia ${transferId} ya no existe en esta tienda.`,
            );
          }

          if (action === 'update') {
            if (!['draft', 'pending'].includes(fresh.status)) {
              return toolError(
                `La transferencia ${transferId} pasó a «${fresh.status}»: solo un borrador/pendiente acepta ediciones.`,
              );
            }
            const checked = toValidatedDto(UpdateTransferDto, {
              ...(args.from_location_id
                ? { from_location_id: Number(args.from_location_id) }
                : {}),
              ...(args.to_location_id
                ? { to_location_id: Number(args.to_location_id) }
                : {}),
              ...(args.notes ? { notes: String(args.notes) } : {}),
              ...(args.expected_date
                ? { expected_date: new Date(String(args.expected_date)) }
                : {}),
            });
            if (!checked.ok) return toolError(checked.message);
            const updated = await services.transfersService.update(
              transferId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `Transferencia ${updated.transfer_number ?? `#${transferId}`} actualizada (sigue en ${updated.status ?? fresh.status})`,
              transfer_id: transferId,
              status: updated.status ?? fresh.status,
            });
          }

          if (action === 'approve') {
            if (!['draft', 'pending'].includes(fresh.status)) {
              return toolError(
                `La transferencia ${transferId} ya está en «${fresh.status}»: nada que aprobar.`,
              );
            }
            const approved =
              await services.transfersService.approve(transferId);
            return JSON.stringify({
              resumen: `Transferencia ${approved.transfer_number ?? `#${transferId}`} aprobada: en tránsito con reserva en origen`,
              transfer_id: transferId,
              status: approved.status ?? 'in_transit',
              siguiente_paso:
                'Complétala con manage_stock_transfers (complete) cuando la mercancía llegue a destino.',
            });
          }

          if (action === 'complete') {
            if (fresh.status !== 'in_transit') {
              return toolError(
                `La transferencia ${transferId} está en «${fresh.status}»: solo una en tránsito puede completarse.`,
              );
            }
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return toolError(
                'complete exige items con id de línea + quantity_received.',
                'Lee la transferencia (GET /store/stock-transfers/:id) para ver los IDs de línea y lo despachado.',
              );
            }
            const checked = toValidatedDto(CompleteTransferDto, {
              items: items.map((raw: any) => ({
                id: Number(raw.id),
                quantity_received: Number(raw.quantity_received),
              })),
            });
            if (!checked.ok) return toolError(checked.message);
            const completed = await services.transfersService.complete(
              transferId,
              checked.dto.items,
            );
            return JSON.stringify({
              resumen: `Transferencia ${(completed as any)?.transfer_number ?? `#${transferId}`} completada: stock movido a destino`,
              transfer_id: transferId,
              status: (completed as any)?.status ?? 'received',
            });
          }

          if (action === 'cancel') {
            if (
              ['completed', 'received', 'cancelled'].includes(fresh.status)
            ) {
              return toolError(
                `La transferencia ${transferId} ya está en «${fresh.status}»: nada que cancelar.`,
              );
            }
            const cancelled =
              await services.transfersService.cancel(transferId);
            return JSON.stringify({
              resumen: `Transferencia ${(cancelled as any)?.transfer_number ?? `#${transferId}`} cancelada (reservas liberadas)`,
              transfer_id: transferId,
              status: (cancelled as any)?.status ?? 'cancelled',
            });
          }

          return toolError(
            `action "${action}" inválida. Usa create, update, approve, complete o cancel.`,
          );
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Verifica la transferencia y el stock en origen (get_stock_levels) antes de reintentar.',
            info.code,
          );
        }
      },
    },

    // ─── O-15: approve_stock_adjustment (WRITE) ────────────────────────
    // Aprueba ajustes pendientes (uno o varios). El ajuste YA movió stock al
    // crearse vía `InventoryAdjustmentsService` → `StockLevelManager`; aprobar
    // es el acto de control que lo sella con aprobador y fecha. Cadena:
    // get_stock_adjustments → write.
    {
      name: 'approve_stock_adjustment',
      version: '1',
      domain: 'inventory',
      description:
        'Aprueba uno o varios ajustes de inventario pendientes (daño, pérdida, merma, conteo). El ajuste ya movió el stock al crearse; aprobar lo sella con aprobador y fecha. Lee primero con get_stock_adjustments para ver los pendientes con producto, bodega y cantidades.',
      parameters: {
        type: 'object',
        properties: {
          adjustment_ids: {
            type: 'array',
            description: 'IDs de los ajustes a aprobar.',
            items: { type: 'number' },
          },
        },
        required: ['adjustment_ids'],
      },
      requiredPermissions: ['store:inventory:adjustments:approve'],
      requiresConfirmation: true,
      preview: async (args) => {
        const ids = Array.isArray(args.adjustment_ids)
          ? args.adjustment_ids.map(Number).filter((n) => Number.isInteger(n))
          : [];
        if (!ids.length) {
          return previewError(
            'Aprobación de ajustes',
            'adjustment_ids vacío: indica al menos un ID de ajuste.',
          );
        }

        try {
          const adjustments = await Promise.all(
            ids.map((id) =>
              services.adjustmentsService.getAdjustmentById(id).catch(() => null),
            ),
          );
          const missing = ids.filter((_, index) => !adjustments[index]);
          if (missing.length) {
            return previewError(
              'Aprobación de ajustes',
              `Los ajustes ${missing.join(', ')} no existen en esta tienda.`,
            );
          }
          const already = adjustments.filter(
            (a: any) => a.approved_by_user_id || a.approved_at,
          );
          if (already.length) {
            return previewError(
              'Aprobación de ajustes',
              `Los ajustes ${already.map((a: any) => a.id).join(', ')} ya están aprobados: nada que aprobar.`,
            );
          }
          const detail = adjustments
            .map((a: any) => {
              const product =
                a.products?.name ??
                a.product?.name ??
                `producto #${a.product_id}`;
              const before = Number(a.quantity_before ?? 0);
              const after = Number(a.quantity_after ?? 0);
              return `${product}: ${before} → ${after} (${a.adjustment_type ?? a.type ?? 'ajuste'})`;
            })
            .join('; ');
          return {
            status: 'ok',
            target:
              adjustments.length === 1
                ? `Aprobar ajuste #${(adjustments[0] as any).id} — ${detail}`
                : `Aprobar ${adjustments.length} ajustes`,
            changes: [
              {
                field: 'approval',
                label: 'Ajustes',
                from: 'pendientes',
                to: detail,
              },
            ],
            domain: 'inventory',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Aprobación de ajustes', info.message);
        }
      },
      handler: async (args, context) => {
        const ids = Array.isArray(args.adjustment_ids)
          ? args.adjustment_ids.map(Number).filter((n) => Number.isInteger(n))
          : [];
        if (!ids.length) {
          return toolError('adjustment_ids vacío: nada que aprobar.');
        }

        try {
          const approved: number[] = [];
          for (const id of ids) {
            // Re-verificación por ajuste: sigue existiendo y sigue pendiente.
            const fresh =
              await services.adjustmentsService.getAdjustmentById(id);
            if (!fresh) {
              return toolError(
                `El ajuste ${id} ya no existe en esta tienda. Se aprobaron ${approved.length} antes de este.`,
              );
            }
            if ((fresh as any).approved_by_user_id || (fresh as any).approved_at) {
              return toolError(
                `El ajuste ${id} ya fue aprobado por otra persona. Se aprobaron ${approved.length} antes de este.`,
              );
            }
            await services.adjustmentsService.approveAdjustment(
              id,
              context.user_id,
            );
            approved.push(id);
          }
          return JSON.stringify({
            resumen:
              approved.length === 1
                ? `Ajuste #${approved[0]} aprobado`
                : `${approved.length} ajustes aprobados: ${approved.join(', ')}`,
            adjustment_ids: approved,
          });
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Lee los pendientes con get_stock_adjustments para ver su estado actual.',
            info.code,
          );
        }
      },
    },
  ];
}

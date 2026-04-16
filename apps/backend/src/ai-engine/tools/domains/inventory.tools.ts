import { RegisteredTool } from '../interfaces/tool.interface';
import { StockLevelsService } from '../../../domains/store/inventory/stock-levels/stock-levels.service';
import { InventoryIntegrationService } from '../../../domains/store/inventory/shared/services/inventory-integration.service';
import { InventoryAdjustmentsService } from '../../../domains/store/inventory/adjustments/inventory-adjustments.service';
import { MovementsService } from '../../../domains/store/inventory/movements/movements.service';
import { LocationsService } from '../../../domains/store/inventory/locations/locations.service';

export interface InventoryToolServices {
  stockLevelsService: StockLevelsService;
  inventoryIntegrationService: InventoryIntegrationService;
  adjustmentsService: InventoryAdjustmentsService;
  movementsService: MovementsService;
  locationsService: LocationsService;
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
      domain: 'inventory',
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
      domain: 'inventory',
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
      domain: 'inventory',
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
            description:
              'Product variant ID (if checking a specific variant)',
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
            args.product_variant_id ? Number(args.product_variant_id) : undefined,
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
      domain: 'inventory',
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

        const results = await services.movementsService.findAll(query);

        const limit = Math.min(Number(args.limit) || 20, 50);
        const formatted = results.slice(0, limit).map((m: any) => ({
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
      domain: 'inventory',
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
      domain: 'inventory',
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

        const result =
          await services.adjustmentsService.getAdjustments(query);

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
            description:
              'Product variant ID (if adjusting a specific variant)',
          },
        },
        required: ['product_id', 'location_id', 'quantity_after', 'adjustment_type'],
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

        const adjustment = await services.adjustmentsService.createAdjustment({
          organization_id: orgId,
          product_id: Number(args.product_id),
          product_variant_id: args.product_variant_id
            ? Number(args.product_variant_id)
            : undefined,
          location_id: Number(args.location_id),
          type: args.adjustment_type,
          quantity_after: Number(args.quantity_after),
          description: args.reason || undefined,
          created_by_user_id: userId,
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
            status: adjustment.approved_by_user_id
              ? 'approved'
              : 'pending',
            created_at: adjustment.created_at,
          },
        });
      },
    },
  ];
}

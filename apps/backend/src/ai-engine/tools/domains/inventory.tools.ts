import { RegisteredTool } from '../interfaces/tool.interface';

export const inventoryTools: RegisteredTool[] = [
  {
    name: 'get_stock_levels',
    domain: 'inventory',
    description:
      'Get current stock levels for products, optionally filtered by product ID or category',
    parameters: {
      type: 'object',
      properties: {
        product_id: {
          type: 'number',
          description: 'Specific product ID (optional)',
        },
        category_id: {
          type: 'number',
          description: 'Filter by category (optional)',
        },
        low_stock_only: {
          type: 'boolean',
          description: 'Only show products below reorder point',
        },
      },
    },
    handler: async (args, context) => {
      return JSON.stringify({
        store_id: context.store_id,
        filters: args,
        message:
          'Stock levels tool connected. Actual data will come from InventoryService.',
      });
    },
  },
  {
    name: 'get_low_stock_alerts',
    domain: 'inventory',
    description:
      'Get products that are below their minimum stock threshold and need reordering',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum alerts to return (default 20)',
        },
      },
    },
    handler: async (args, context) => {
      return JSON.stringify({
        store_id: context.store_id,
        limit: args.limit || 20,
        message:
          'Low stock alerts tool connected. Actual data will come from InventoryService.',
      });
    },
  },
];

import { RegisteredTool } from '../interfaces/tool.interface';

export const salesTools: RegisteredTool[] = [
  {
    name: 'get_sales_report',
    domain: 'sales',
    description:
      'Get a sales report for a given date range with totals, order count, and average order value',
    parameters: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['date_from', 'date_to'],
    },
    handler: async (args, context) => {
      return JSON.stringify({
        period: { from: args.date_from, to: args.date_to },
        store_id: context.store_id,
        message:
          'Sales report tool connected. Actual data will come from OrdersService.',
      });
    },
  },
  {
    name: 'get_top_products',
    domain: 'sales',
    description:
      'Get the top selling products by revenue or quantity for a date range',
    parameters: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: {
          type: 'number',
          description: 'Number of products to return (default 10)',
        },
        sort_by: {
          type: 'string',
          enum: ['revenue', 'quantity'],
          description: 'Sort criteria',
        },
      },
      required: ['date_from', 'date_to'],
    },
    handler: async (args, context) => {
      return JSON.stringify({
        period: { from: args.date_from, to: args.date_to },
        store_id: context.store_id,
        limit: args.limit || 10,
        sort_by: args.sort_by || 'revenue',
        message:
          'Top products tool connected. Actual data will come from ProductsService.',
      });
    },
  },
];

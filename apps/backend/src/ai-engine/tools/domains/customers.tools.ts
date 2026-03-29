import { RegisteredTool } from '../interfaces/tool.interface';

export const customerTools: RegisteredTool[] = [
  {
    name: 'get_customer_segments',
    domain: 'customers',
    description:
      'Get customer segmentation analysis (RFM: Recency, Frequency, Monetary)',
    parameters: {
      type: 'object',
      properties: {
        criteria: {
          type: 'string',
          enum: ['rfm', 'spending', 'frequency'],
          description: 'Segmentation criteria',
        },
      },
    },
    handler: async (args, context) => {
      return JSON.stringify({
        store_id: context.store_id,
        criteria: args.criteria || 'rfm',
        message:
          'Customer segments tool connected. Actual data will come from CustomersService.',
      });
    },
  },
  {
    name: 'get_customer_history',
    domain: 'customers',
    description:
      'Get the purchase history and profile of a specific customer',
    parameters: {
      type: 'object',
      properties: {
        customer_id: { type: 'number', description: 'Customer ID' },
      },
      required: ['customer_id'],
    },
    handler: async (args, context) => {
      return JSON.stringify({
        customer_id: args.customer_id,
        store_id: context.store_id,
        message:
          'Customer history tool connected. Actual data will come from CustomersService.',
      });
    },
  },
];

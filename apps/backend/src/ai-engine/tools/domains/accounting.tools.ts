import { RegisteredTool } from '../interfaces/tool.interface';

export const accountingTools: RegisteredTool[] = [
  {
    name: 'get_profit_and_loss',
    domain: 'accounting',
    description: 'Get the profit and loss (P&L) report for a given period',
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
        organization_id: context.organization_id,
        message:
          'P&L tool connected. Actual data will come from AccountingService.',
      });
    },
  },
  {
    name: 'get_account_entries',
    domain: 'accounting',
    description:
      'Get journal entries for a specific account code and date range',
    parameters: {
      type: 'object',
      properties: {
        account_code: { type: 'string', description: 'PUC account code' },
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['account_code'],
    },
    handler: async (args, context) => {
      return JSON.stringify({
        account_code: args.account_code,
        organization_id: context.organization_id,
        message:
          'Account entries tool connected. Actual data will come from AccountingService.',
      });
    },
  },
];

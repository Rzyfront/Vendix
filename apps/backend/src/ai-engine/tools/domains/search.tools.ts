import { RegisteredTool } from '../interfaces/tool.interface';

export const searchTools: RegisteredTool[] = [
  {
    name: 'semantic_search',
    domain: 'search',
    description:
      'Search the business database using natural language. Finds products, customers, or other entities by meaning, not just keywords.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        entity_types: {
          type: 'array',
          items: { type: 'string', enum: ['product', 'customer'] },
          description: 'Types of entities to search (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 5)',
        },
      },
      required: ['query'],
    },
    handler: async (args, context) => {
      // This will be connected to EmbeddingService.searchByText() at runtime
      // The actual connection happens via dependency injection in the tool registration
      return JSON.stringify({
        query: args.query,
        store_id: context.store_id,
        entity_types: args.entity_types,
        limit: args.limit || 5,
        message:
          'Semantic search tool connected. Will use EmbeddingService.searchByText() when fully wired.',
      });
    },
  },
];

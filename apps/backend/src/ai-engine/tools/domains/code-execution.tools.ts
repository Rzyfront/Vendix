import type { SandboxBrokerService } from '../../sandbox/sandbox-broker.service';
import type { RegisteredTool } from '../interfaces/tool.interface';

/** Read-only computation, not a confirmation shortcut or a general runtime. */
export function createCodeExecutionTools(
  broker: SandboxBrokerService,
): RegisteredTool[] {
  return [
    {
      name: 'run_readonly_script',
      version: '1',
      domain: 'sandbox',
      readOnly: true,
      description:
        'Opcional: fan-out, paginación o join complejo del catálogo con JS limitado (TypeScript sólo sintaxis JS/JSDoc). Preferir list_products, vex_block_transform o reporte para consultas simples. Sólo tools.list_products(args) auditada en el working set; sin imports/red/fs/env/SQL/escrituras/UI. return JSON compacto; dinero con enteros/escalas decimales, nunca sumas floats. Disponibilidad Linux aislado requerida; no reintentar automáticamente. Código no verifica objetivos.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: {
            type: 'string',
            description:
              'Cuerpo async import-free, <=32KiB, return valor JSON.',
          },
          language: { type: 'string', enum: ['javascript', 'typescript'] },
          tools: {
            type: 'array',
            items: { type: 'string', enum: ['list_products'] },
          },
          purpose: { type: 'string', enum: ['fanout', 'pagination', 'join'] },
        },
        required: ['source', 'language', 'tools', 'purpose'],
      },
      handler: async (args) => broker.run(args),
    },
  ];
}

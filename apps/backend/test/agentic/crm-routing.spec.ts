import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import {
  buildToolManifest,
  localToolRanking,
  localToolScores,
} from '../../src/ai-engine/tools/tool-catalog';
import * as factories from '../../src/ai-engine/tools';
import { createDiscoveryTools } from '../../src/ai-engine/tools/domains/discovery.tools';

/**
 * QUI-1042 routing: owner phrases about customers and CRM must reach the CRM
 * tool that does the job, ranked by the lexical branch alone (the branch that
 * survives when embeddings are degraded). Built from every factory of the
 * barrel, so a CRM tool competes against the real catalog: reminders,
 * workflows, upsert_customer, orders.
 */

const TOP_K = 5;

/** phrase → tool that must rank inside TOP_K. */
const CASES: Array<[string, string]> = [
  ['Muéstrame la ficha completa de Ana Gómez', 'get_customer_crm_profile'],
  ['Archiva al cliente Pedro Ruiz', 'archive_customer'],
  [
    'Asigna a Carlos como vendedor responsable de estos clientes',
    'assign_customer_owner',
  ],
  [
    'Agrega una nota a la ficha de Ana: prefiere entregas en la tarde',
    'add_customer_note',
  ],
  ['Qué notas tiene el cliente Luis', 'list_customer_notes'],
  ['Qué etiquetas de clientes tengo', 'list_crm_tags'],
  ['Crea la etiqueta VIP de color dorado', 'save_crm_tag'],
  ['Borra la etiqueta Moroso', 'delete_crm_tag'],
  ['Ponle la etiqueta VIP a Ana Gómez y a Luis Pérez', 'tag_customers'],
  ['Qué segmentos de clientes tengo', 'list_crm_segments'],
  ['Quiénes están en el segmento Mayoristas', 'get_crm_segment_members'],
  ['Qué clientes compraron más de 3 veces', 'find_customers_by_criteria'],
  [
    'Crea un segmento con los clientes que gastaron más de un millón',
    'save_crm_segment',
  ],
  ['Elimina el segmento Inactivos', 'delete_crm_segment'],
  ['Agrega a Ana y a Luis al segmento Mayoristas', 'update_segment_members'],
  ['Cómo va el embudo de ventas', 'get_crm_pipeline'],
  ['Qué oportunidades abiertas hay en el pipeline', 'list_crm_opportunities'],
  [
    'Crea una oportunidad de venta para Ana por 2 millones',
    'create_crm_opportunity',
  ],
  [
    'Mueve la oportunidad de Ana a la etapa negociación',
    'move_crm_opportunity',
  ],
  ['Marca como ganada la oportunidad de Luis', 'set_crm_opportunity_result'],
  ['Qué tareas de seguimiento tengo pendientes con clientes', 'list_crm_tasks'],
  ['Crea una tarea para llamar a Luis mañana', 'create_crm_task'],
  ['Completa la tarea de llamar a Ana', 'complete_crm_task'],
  ['Qué campañas de WhatsApp tengo', 'list_crm_campaigns'],
  [
    'Prepara un borrador de campaña de navidad para el segmento VIP',
    'create_crm_campaign_draft',
  ],
  ['Envía la campaña de navidad', 'send_crm_campaign'],
];

let docs: ReturnType<typeof buildToolManifest>['documents'];

beforeAll(() => {
  const registry = new AIToolRegistry({} as any);
  // Factory declarations only, with inert dependencies (same as b-routing).
  for (const [name, factory] of Object.entries(factories)) {
    if (name.startsWith('create') && typeof factory === 'function')
      registry.registerMany(
        (factory as Function)({
          embeddingService: { isAvailable: () => true },
        }),
      );
  }
  registry.registerMany(createDiscoveryTools());
  docs = buildToolManifest(registry).documents;
});

describe('CRM routing over the real catalog (QUI-1042)', () => {
  it.each(CASES)('«%s» → %s', (phrase, tool) => {
    const ranking = localToolRanking(phrase, docs);
    expect(ranking).toContain(tool);
    const position = ranking.indexOf(tool);
    if (position >= TOP_K) {
      const scores = localToolScores(phrase, docs);
      throw new Error(
        `${tool} quedó en la posición ${position + 1}; top ${TOP_K}: ${ranking
          .slice(0, TOP_K)
          .map((n) => `${n}=${scores.get(n)}`)
          .join(', ')} (${tool}=${scores.get(tool)})`,
      );
    }
  });
});

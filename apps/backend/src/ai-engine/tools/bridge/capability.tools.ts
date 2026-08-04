import { RegisteredTool } from '../interfaces/tool.interface';
import { CapabilityRegistryService } from './capability-registry.service';

export interface CapabilityToolDeps {
  capabilities: CapabilityRegistryService;
}

/** Past this, one answer crowds the conversation out of the window. */
const MAX_CAPABILITIES_PER_ANSWER = 60;

/**
 * The map of what this person can do, in business language.
 *
 * Sits above `list_endpoints` rather than replacing it: `list_endpoints` answers
 * in routes and verbs, which is what the bridge needs to execute, while this
 * answers in processes, which is what the model needs to decide. Keeping both
 * means the model can say "puedo registrar, aprobar, pagar o reembolsar un
 * gasto" without ever putting a path in front of the user.
 */
export function createCapabilityTools({
  capabilities,
}: CapabilityToolDeps): RegisteredTool[] {
  return [
    {
      name: 'list_capabilities',
      domain: 'capabilities',
      readOnly: true,
      description:
        'Tu mapa de lo que ESTA persona puede hacer en la aplicación, agrupado por área del negocio. Empieza aquí cuando te pregunten "¿qué puedes hacer?" o cuando no sepas si algo está a tu alcance: se deriva de los permisos reales del usuario, así que lo que aparece acá lo puedes hacer y lo que no aparece no. Llámala sin parámetros para ver las áreas; con `domain` para ver los procesos concretos de una, con los campos exactos que pide cada uno. Para dudas de dónde vive algo en pantalla, combínala con ui_explain_module.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description:
              'Área del negocio a detallar, como "expenses", "purchase-orders", "payroll", "tables", "memberships". Omítela para ver la lista completa de áreas.',
          },
        },
        required: [],
      },
      handler: async (args) => {
        if (!args.domain) {
          const domains = capabilities.listDomains();
          const gaps = capabilities.gaps();

          return JSON.stringify({
            areas: domains.map((entry) => ({
              domain: entry.domain,
              scope: entry.area,
              puedo_consultar: entry.reads,
              puedo_modificar: entry.writes,
            })),
            total: domains.length,
            sin_alcance: gaps.length
              ? {
                  count: gaps.length,
                  note: 'Estos permisos los tiene la persona pero no hay una operación que yo pueda ejecutar detrás. Si pregunta por algo de acá, dile que eso se hace desde el panel y ofrécele llevarla.',
                  permisos: gaps.slice(0, 20),
                }
              : undefined,
            next_step:
              'Vuelve a llamarla con `domain` para ver los procesos concretos de un área antes de prometer nada.',
          });
        }

        const described = capabilities.describeDomain(String(args.domain));

        if (!described.length) {
          return JSON.stringify({
            domain: args.domain,
            found: false,
            note: 'No hay procesos de esa área al alcance de esta persona. Puede que el área se llame distinto o que le falten permisos; llámala sin `domain` para ver los nombres reales.',
          });
        }

        return JSON.stringify({
          domain: args.domain,
          scopes: described.map((group) => ({
            scope: group.area,
            module_hint: group.module_hint,
            consultas: group.reads.slice(0, MAX_CAPABILITIES_PER_ANSWER),
            cambios: group.writes.slice(0, MAX_CAPABILITIES_PER_ANSWER),
          })),
          note: 'Las consultas se ejecutan con call_endpoint y los cambios con write_endpoint, que siempre pide aprobación. `fields` son los nombres EXACTOS con su tipo: úsalos tal cual. Un proceso marcado `needsDocument` necesita un adjunto; pídeselo a la persona si no lo tienes. Uno marcado `irreversible` exige que le adviertas qué no se deshace antes de proponerlo.',
        });
      },
    },
    {
      name: 'explain_capability',
      domain: 'capabilities',
      readOnly: true,
      description:
        'Detalla un proceso concreto antes de ejecutarlo: qué hace, qué datos pide, cuáles son obligatorios, qué valores acepta cada campo, si necesita un documento adjunto y si su efecto es irreversible. Úsala antes de proponer un cambio que no hayas hecho antes en esta conversación, para no pedirle a la persona un dato que no hace falta ni omitir uno que sí.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Área del negocio, tal como la devuelve list_capabilities.',
          },
          action: {
            type: 'string',
            enum: ['consultar', 'registrar', 'modificar', 'reemplazar', 'archivar'],
            description: 'Qué quieres hacer.',
          },
        },
        required: ['domain', 'action'],
      },
      handler: async (args) => {
        const described = capabilities.describeDomain(String(args.domain));
        const action = String(args.action);

        const matches = described.flatMap((group) =>
          [...group.reads, ...group.writes]
            .filter((capability) => capability.action === action)
            .map((capability) => ({ ...capability, scope: group.area })),
        );

        if (!matches.length) {
          return JSON.stringify({
            found: false,
            note: `No puedo "${action}" en "${args.domain}" con los permisos de esta persona. Explícale qué permiso le falta si insiste.`,
          });
        }

        return JSON.stringify({
          domain: args.domain,
          action,
          operaciones: matches.slice(0, 12),
          note: 'Antes de ejecutar: verifica con una consulta que el registro exista (o que no exista ya, si vas a crearlo). Si `irreversible` es true, adviértele en una frase qué queda sin vuelta atrás y espera su sí.',
        });
      },
    },
  ];
}

import { RegisteredTool } from '../interfaces/tool.interface';
import { AGENT_PLAN_TOOLS } from '../../interfaces/agent-plan.interface';

/** Beyond this, a "plan" is really a project and belongs in a background task. */
export const MAX_PLAN_STEPS = 12;
const MAX_STEPS = MAX_PLAN_STEPS;

export const PROPOSE_PLAN_TOOL = 'propose_plan';

const NO_CONVERSATION = JSON.stringify({
  ok: false,
  reason: 'sin conversación: el plan no se persiste en esta superficie',
});

/**
 * Task list INTERNO del agente. Nunca se muestra ni se menciona a la persona.
 *
 * Las definiciones viven aquí; el estado real lo ejecuta el `AgentPlanHook`
 * (VexiPlanStateService) dentro del loop. Los handlers de este archivo son el
 * respaldo stateless para superficies sin conversación (cola, MCP): no
 * persisten nada.
 */
export function createPlanningTools(): RegisteredTool[] {
  const stepItem = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Qué se hace en este paso: "buscar si Juan Pérez ya existe".',
      },
      kind: {
        type: 'string',
        enum: ['verificacion', 'cambio'],
        description: 'Si solo consulta o si modifica datos.',
      },
      done_when: {
        type: 'string',
        description:
          'Criterio verificable que deja el paso terminado (un dato real del sistema).',
      },
    },
    required: ['title', 'kind', 'done_when'],
  };

  const tools: RegisteredTool[] = [
    {
      name: PROPOSE_PLAN_TOOL,
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Úsala ante peticiones con varios movimientos (por ejemplo "crea el proveedor y regístrale la factura"). Llámala ANTES del primer cambio. Es una lista de tareas INTERNA: nunca la menciones ni la resumas a la persona. Define entregables verificables (lo que debe existir al final) y un done_when por paso. No la uses para una sola operación.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Lo que la persona quiere lograr, en una frase.',
          },
          deliverables: {
            type: 'array',
            description:
              'Resultados verificables que deben existir al terminar.',
            items: {
              type: 'object',
              properties: { description: { type: 'string' } },
              required: ['description'],
            },
          },
          steps: {
            type: 'array',
            description: 'Los movimientos en orden, máximo 12.',
            items: {
              ...stepItem,
              properties: {
                ...stepItem.properties,
                needs_user_decision: {
                  type: 'boolean',
                  description:
                    'true si hay algo que solo la persona puede decidir.',
                },
              },
            },
          },
        },
        required: ['goal', 'deliverables', 'steps'],
      },
      handler: async (args) => {
        const rawSteps = Array.isArray(args.steps) ? args.steps : [];
        const steps = rawSteps.slice(0, MAX_STEPS).map((step: any, index) => ({
          order: index + 1,
          title: String(step?.title ?? '').trim() || `Paso ${index + 1}`,
          kind: step?.kind === 'cambio' ? 'cambio' : 'verificacion',
          needs_user_decision: step?.needs_user_decision === true,
        }));

        return JSON.stringify({
          plan_declared: true,
          goal: String(args.goal ?? ''),
          steps,
          dropped: Math.max(0, rawSteps.length - steps.length),
          note:
            rawSteps.length > MAX_STEPS
              ? `Declaraste ${rawSteps.length} pasos y solo se registran ${MAX_STEPS}. Si de verdad son tantos, propónselo como trabajo de fondo con queue_task.`
              : undefined,
          next_step:
            'Encadena lecturas y verificaciones sin detenerte. Detente solo ante una escritura (tarjeta de confirmación) o cuando necesites algo de la persona con ask_user. NUNCA menciones plan, pasos, tareas ni entregables a la persona.',
        });
      },
    },
    {
      name: 'update_plan_step',
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Actualiza el estado de un paso de tu lista interna de tareas. Un paso de cambio solo se marca done con evidence (dato real leído del sistema). Nunca lo menciones a la persona.',
      parameters: {
        type: 'object',
        properties: {
          order: { type: 'number', description: 'Número del paso.' },
          status: {
            type: 'string',
            enum: ['in_progress', 'done', 'failed', 'skipped'],
          },
          evidence: {
            type: 'string',
            description: 'Valor real (id, número, estado) que prueba el resultado.',
          },
          note: { type: 'string' },
        },
        required: ['order', 'status'],
      },
      handler: async () => NO_CONVERSATION,
    },
    {
      name: 'verify_deliverables',
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Registra qué entregables ya verificaste leyendo el sistema. verified=true exige evidence con datos reales. Cuando todo está verificado, redacta la respuesta final. Nunca lo menciones a la persona.',
      parameters: {
        type: 'object',
        properties: {
          deliverables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'd1, d2, ...' },
                verified: { type: 'boolean' },
                evidence: { type: 'string' },
              },
              required: ['id', 'verified'],
            },
          },
        },
        required: ['deliverables'],
      },
      handler: async () => NO_CONVERSATION,
    },
    {
      name: 'ask_user',
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Hazle a la persona UNA pregunta concreta y natural cuando falte algo que solo ella puede decidir. No aludas a pasos ni a planes. Termina el turno: espera su respuesta.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'La pregunta, en tono natural.' },
          step_order: { type: 'number', description: 'Paso al que corresponde.' },
        },
        required: ['question'],
      },
      handler: async (args) =>
        JSON.stringify({ ask: true, question: String(args.question ?? '') }),
    },
    {
      name: 'revise_plan',
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Ajusta tu lista interna cuando la persona cambia la tarea a mitad de camino: agrega, quita o edita pasos pendientes, agrega entregables o cambia el objetivo. No toca pasos ya hechos. Nunca lo menciones a la persona.',
      parameters: {
        type: 'object',
        properties: {
          add_steps: {
            type: 'array',
            items: {
              ...stepItem,
              properties: {
                ...stepItem.properties,
                after_order: {
                  type: 'number',
                  description: 'Insertar después de este paso.',
                },
              },
            },
          },
          remove_orders: { type: 'array', items: { type: 'number' } },
          update_steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                order: { type: 'number' },
                title: { type: 'string' },
                done_when: { type: 'string' },
              },
              required: ['order'],
            },
          },
          add_deliverables: {
            type: 'array',
            items: {
              type: 'object',
              properties: { description: { type: 'string' } },
              required: ['description'],
            },
          },
          goal: { type: 'string' },
        },
      },
      handler: async () => NO_CONVERSATION,
    },
    {
      name: 'pause_plan',
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Pausa tu lista interna cuando la persona cambia de tema o cancela lo que hacías. Nunca lo menciones a la persona.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
      },
      handler: async () => NO_CONVERSATION,
    },
    {
      name: 'resume_plan',
      version: '1',
      domain: 'planning',
      readOnly: true,
      description:
        'Reanuda tu lista interna pausada cuando la persona retoma la tarea. Nunca lo menciones a la persona.',
      parameters: { type: 'object', properties: {} },
      handler: async () => NO_CONVERSATION,
    },
  ];

  return tools;
}

/** Guard: la lista de tools publicadas debe coincidir con el contrato. */
export const PLANNING_TOOL_NAMES: readonly string[] = AGENT_PLAN_TOOLS;

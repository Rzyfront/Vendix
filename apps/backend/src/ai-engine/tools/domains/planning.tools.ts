import { RegisteredTool } from '../interfaces/tool.interface';

/** Beyond this, a "plan" is really a project and belongs in a background task. */
const MAX_STEPS = 12;

export const PROPOSE_PLAN_TOOL = 'propose_plan';

/**
 * Makes a multi-step request explicit before any of it happens.
 *
 * The problem this solves is not presentation. A request like "crea el usuario
 * Juan y ponle rol administrador" is four movements — look Juan up, propose
 * creating him, verify he exists, propose the role — and each write ends the turn
 * waiting for approval. Without a declared plan the model re-derives what is left
 * on every turn, and what it re-derives drifts: it would forget the role, or
 * re-propose the user it already created, or claim both were done after one.
 *
 * Declaring the plan gives three things at once: the person sees the whole scope
 * before authorising the first piece, the panel can render it as a checklist, and
 * the agent loop gets a signal to widen its iteration budget for this turn
 * (`ai-agent.service.ts`), because the default ten rounds are sized for a single
 * question, not for a chain.
 *
 * `readOnly: true` is exact: proposing changes nothing. Every step still goes
 * through its own confirmation gate — a plan the user read is not a plan the user
 * pre-approved.
 */
export function createPlanningTools(): RegisteredTool[] {
  return [
    {
      name: PROPOSE_PLAN_TOOL,
      domain: 'planning',
      readOnly: true,
      description:
        'Declara el plan cuando lo que te piden son VARIOS cambios encadenados (por ejemplo "crea el proveedor y regístrale la factura", o "sube estos productos y ponles precio"). Llámala ANTES del primer cambio, con un paso por cada movimiento real, y luego ejecútalos uno por uno: cada uno con su verificación previa y su propia aprobación. No la uses para una sola operación: ahí sobra. Declarar el plan no autoriza nada — la persona sigue aprobando paso por paso.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description:
              'Lo que la persona quiere lograr, en una frase y en sus términos.',
          },
          steps: {
            type: 'array',
            description:
              'Los movimientos en orden. Un paso por cada verificación o cambio, no uno por cada frase.',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    'Qué se hace en este paso, en lenguaje de negocio: "buscar si Juan Pérez ya existe".',
                },
                kind: {
                  type: 'string',
                  enum: ['verificacion', 'cambio'],
                  description:
                    'Si solo consulta o si modifica datos. Todo cambio pide aprobación aparte.',
                },
                needs_user_decision: {
                  type: 'boolean',
                  description:
                    'true si en este paso hay algo que solo la persona puede decidir (una variante, un peso, una fecha de reserva).',
                },
              },
              required: ['title', 'kind'],
            },
          },
        },
        required: ['goal', 'steps'],
      },
      handler: async (args) => {
        const rawSteps = Array.isArray(args.steps) ? args.steps : [];

        const steps = rawSteps.slice(0, MAX_STEPS).map((step: any, index) => ({
          order: index + 1,
          title: String(step?.title ?? '').trim() || `Paso ${index + 1}`,
          kind: step?.kind === 'cambio' ? 'cambio' : 'verificacion',
          needs_user_decision: step?.needs_user_decision === true,
        }));

        const changes = steps.filter((step) => step.kind === 'cambio').length;

        return JSON.stringify({
          plan_declared: true,
          goal: String(args.goal ?? ''),
          steps,
          dropped: Math.max(0, rawSteps.length - steps.length),
          note:
            rawSteps.length > MAX_STEPS
              ? `Declaraste ${rawSteps.length} pasos y solo se registran ${MAX_STEPS}. Si de verdad son tantos, esto es un trabajo de fondo: propónselo como tal con queue_task.`
              : undefined,
          next_step: `Resúmele el plan en una o dos frases —${steps.length} paso(s), ${changes} de ellos cambian datos— y arranca por el primero. Ejecuta un paso por turno: verifica, propone, espera el sí. No juntes cambios en una sola propuesta ni des por hecho un paso que no verificaste.`,
        });
      },
    },
  ];
}

import { RegisteredTool } from '../interfaces/tool.interface';
import {
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
} from '../interfaces/tool.interface';
import type { WriteBatchService } from '../../../domains/store/vex/services/write-batch.service';
import type { WriteBatchStepInput } from '../../../domains/store/vex/services/write-batch.types';

export const PROPOSE_WRITE_BATCH = 'propose_write_batch';

/**
 * Hard ceiling of steps one call may carry. D1 caps ONE confirmation at 25
 * steps (more are split into parts by the service); this bounds how many
 * parts a single call can open, so a runaway model cannot flood the thread.
 */
export const WRITE_BATCH_MAX_STEPS_PER_CALL = 100;

export interface WriteBatchToolDeps {
  batches: WriteBatchService;
}

/**
 * F5 (T34) — `propose_write_batch`, the Vex-only entry of the batch circuit.
 *
 * It PROPOSES, it never writes a business record: the service runs every
 * step through the T13 role gate and the step tool's real `preview()` and
 * persists an `ai_agent_write_batches` row plus its `write_batch` block. The
 * writes run only when the owner approves the card
 * (`POST /store/vex/batches/:id/approve`). That is why it is `readOnly`, like
 * the `vex_render_*` tools: persisting the proposal mutates the agent's own
 * workspace, and routing it through the confirmation circuit would ask the
 * person to approve being asked.
 *
 * `access: 'public'` is deliberate and safe: the tool grants nothing by
 * itself — each step carries its own `requiredPermissions`, checked before the
 * batch exists (one denied step = no batch) and again when it executes.
 */
export function createWriteBatchTools({
  batches,
}: WriteBatchToolDeps): RegisteredTool[] {
  return [
    {
      name: PROPOSE_WRITE_BATCH,
      access: 'public',
      accessReason:
        'Proposes only: every step is gated by its own tool permissions (T13) and real preview before the batch exists, and re-checked at execution; nothing is written until the owner approves the card.',
      version: '1',
      domain: 'vex_batches',
      readOnly: true,
      // Loaded by discovery, not by Vex's fixed core: the core has a token
      // budget (tool-router.agent-core.spec.ts) that F7 already exceeds.
      discovery: {
        synonyms: [
          'varios cambios a la vez',
          'cambios en lote',
          'aprobar todo de una vez',
          'cambio masivo',
          'actualizar varios productos',
          'etiquetar varios clientes',
        ],
      },
      description:
        'Propone VARIOS cambios reversibles para que la persona los apruebe con UN solo clic en una tarjeta. Úsala cuando la persona pide dos o más cambios (subir precios de varios productos, etiquetar clientes, actualizar varios datos). Cada paso es una herramienta de escritura con sus argumentos exactos. No uses esta herramienta para acciones irreversibles (anular, eliminar, enviar campañas, emitir a la DIAN): esas van solas con su propia confirmación. Máximo 25 pasos por tarjeta (si son más, se parten en varias) y 500 registros por lote. Si un paso no está permitido para el rol o no es válido, NO se crea ningún lote: repite la explicación a la persona tal cual. Nunca digas que algo se aplicó: se aplica solo cuando la persona aprueba la tarjeta.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'number',
            description:
              'No lo envíes: el servidor siempre usa la conversación actual y reemplaza cualquier valor.',
          },
          goal: {
            type: 'string',
            description:
              'Objetivo del lote en palabras de la persona: «Subir 5 % las bebidas».',
          },
          steps: {
            type: 'array',
            description:
              'Pasos en el orden en que se aplican. Cada paso: {tool, arguments, label, depends_on?}.',
            items: {
              type: 'object',
              properties: {
                tool: {
                  type: 'string',
                  description: 'Nombre exacto de la herramienta de escritura.',
                },
                arguments: {
                  type: 'object',
                  description: 'Argumentos exactos de esa herramienta.',
                },
                label: {
                  type: 'string',
                  description:
                    'Frase corta que la persona entiende: «Subir 5 % Coca Cola 1L».',
                },
                depends_on: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'step_id (s1, s2…) de pasos previos que necesita.',
                },
              },
              required: ['tool', 'arguments', 'label'],
            },
          },
        },
        required: ['goal', 'steps'],
      },
      handler: async (args) => {
        // The agent turn always sets this to its own conversation
        // (`withTurnConversation`); the service refuses `no_conversation`
        // when it is missing or not this user's.
        const rawConversationId = Number(args.conversation_id);
        const conversationId =
          Number.isInteger(rawConversationId) && rawConversationId > 0
            ? rawConversationId
            : null;
        const steps = Array.isArray(args.steps)
          ? (args.steps as WriteBatchStepInput[])
          : [];
        if (steps.length > WRITE_BATCH_MAX_STEPS_PER_CALL) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              PROPOSE_WRITE_BATCH,
              `Son ${steps.length} cambios y el máximo por llamada es ${WRITE_BATCH_MAX_STEPS_PER_CALL}. No propuse el lote.`,
              'Divide el trabajo en lotes más pequeños y propónlos uno por uno.',
            ),
          );
        }
        const result = await batches.propose({
          conversationId,
          goal: typeof args.goal === 'string' ? args.goal : '',
          steps,
        });
        if ('refused' in result) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              PROPOSE_WRITE_BATCH,
              result.explanation,
              result.reason === 'irreversible'
                ? 'Repite la explicación a la persona. Propón el lote sin ese paso y deja el paso irreversible para su propia confirmación.'
                : 'Repite la explicación a la persona tal cual. No digas que se aplicó nada.',
            ),
          );
        }
        const first = result.batches[0];
        const total = result.batches.reduce((n, b) => n + b.step_count, 0);
        return JSON.stringify(
          buildToolSuccessEnvelope(PROPOSE_WRITE_BATCH, {
            block_id: first?.block_id,
            kind: 'write_batch',
            block: first?.block,
            // Parts 2..n of a split batch: each one is its own card/frame.
            part_blocks: result.batches
              .slice(1)
              .map((b) => b.block)
              .filter((b) => !!b),
            group_id: result.group_id,
            batches: result.batches.map(({ block: _block, ...rest }) => rest),
            proposed_steps: total,
            summary:
              result.batches.length > 1
                ? `Propuse ${total} cambios en ${result.batches.length} tarjetas; cada una se aprueba por separado.`
                : `Propuse ${total} ${total === 1 ? 'cambio' : 'cambios'} en una tarjeta.`,
            next_step:
              'Dile a la persona que revise la tarjeta y la apruebe. Nada se aplicó todavía.',
          }),
        );
      },
    },
  ];
}

import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Turn-close contract of the chat agents (Vex/Vexi). A chat turn ends
 * legitimately only when it ran at least one tool or called this one; a turn
 * that ends in prose with neither is treated as incomplete by the loop (it
 * resumes it once, then closes it flagged `pending_continuation`).
 */
export const FINISH_TURN_TOOL = 'finish_turn';

/** Ownerless loop scaffolding: no effects, no data, nothing to confirm. */
export function createTurnTools(): RegisteredTool[] {
  return [
    {
      name: FINISH_TURN_TOOL,
      access: 'public',
      accessReason:
        'Loop scaffolding with no effect: it only marks that the agent closed its turn; it reads and writes nothing.',
      version: '1',
      domain: 'turn',
      readOnly: true,
      requiresConfirmation: false,
      description:
        'Llama a esta herramienta SOLO cuando ya terminaste tu turno: ejecutaste lo que tenías que hacer o ya diste la respuesta completa. No la uses para anunciar algo que vas a hacer después.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'Opcional: una línea interna con lo que cerraste. La persona no la ve.',
          },
        },
      },
      handler: async () => JSON.stringify({ status: 'closed' }),
    },
  ];
}

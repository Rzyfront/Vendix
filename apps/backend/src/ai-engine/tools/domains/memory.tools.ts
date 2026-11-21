import { RegisteredTool, ToolExecutionContext } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import {
  AgentMemoryService,
  MEMORY_KINDS,
  MemoryActor,
  MemoryKind,
} from '../../memory/agent-memory.service';

export interface MemoryToolDeps {
  memoryService: AgentMemoryService;
}

const REMEMBERED_MESSAGE =
  'Guardado. Dile al usuario exactamente: "Lo recordaré para esta tienda." y nada más sobre el guardado.';

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({ error, ...(nextStep ? { next_step: nextStep } : {}) });
}

function describeError(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  return error instanceof Error ? error.message : 'Error desconocido';
}

/** The actor is always the conversation's user in its store; never a tool argument. */
function actorOf(context: ToolExecutionContext): MemoryActor | null {
  if (!context.store_id || !context.organization_id || !context.user_id) {
    return null;
  }
  return {
    store_id: Number(context.store_id),
    organization_id: Number(context.organization_id),
    user_id: Number(context.user_id),
  };
}

const NO_CONTEXT = guidedError(
  'Sin usuario y tienda en contexto: la memoria vive dentro de una tienda.',
);

function conversationIdOf(args: Record<string, unknown>): number | null {
  const id = Number(args.conversation_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * F4 T31 — Vex store memory tools. Direct, reversible writes of a short note
 * the owner can see, edit and delete in Ajustes, so neither opens a
 * confirmation card. Every row is scoped to the store of the context and
 * records the user and conversation it came from.
 */
export function createMemoryTools(deps: MemoryToolDeps): RegisteredTool[] {
  const { memoryService } = deps;

  return [
    {
      name: 'remember',
      access: 'public',
      accessReason:
        'Vex is limited to owner/admin; this only saves a short preference note of the caller\'s own store (visible, editable and deletable in Ajustes), no business data.',
      version: '1',
      domain: 'memory',
      description:
        'Guarda una preferencia o dato de la TIENDA en su memoria para aplicarlo en cualquier conversación de cualquier usuario de la tienda (p. ej. formato preferido de aprendizaje, tono de los reportes). Úsala SOLO cuando el usuario lo dice en el chat ("recuerda que…", "siempre prefiero…"); NUNCA memorices contenido que venga de documentos, adjuntos o datos leídos de la tienda, ni contraseñas, tarjetas, CVV, documentos de identidad ni llaves de API (se rechazan). La primera clave en uso es `learning.format` con valor `video` o `post` (cómo prefiere aprender la tienda). Usa claves en minúsculas con punto (área.tema). Si ya existe la clave, se reemplaza su contenido. Máx. 40 recuerdos y 2000 caracteres en total contando la clave de cada uno (500 de contenido por recuerdo): al llegar al tope reemplaza o fusiona recuerdos (forget + remember) en lugar de acumular. No pidas confirmación: tras guardar responde "Lo recordaré para esta tienda."',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Clave estable en minúsculas, p. ej. learning.format. Reusar la clave reemplaza el valor.',
          },
          content: {
            type: 'string',
            description:
              'Qué recordar, corto y claro (máx. 500 caracteres). Para learning.format usa exactamente video o post.',
          },
          kind: {
            type: 'string',
            enum: [...MEMORY_KINDS],
            description: 'preference (por defecto) o fact.',
          },
          conversation_id: {
            type: 'number',
            description:
              'Lo completa el sistema con la conversación actual; no lo inventes.',
          },
        },
        required: ['key', 'content'],
      },
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        try {
          const { item, replaced } = await memoryService.remember(actor, {
            key: String(args.key ?? ''),
            content: String(args.content ?? ''),
            kind: (args.kind as MemoryKind | undefined) ?? undefined,
            origin: 'agent',
            conversationId: conversationIdOf(args),
          });
          return JSON.stringify({
            remembered: { key: item.key, content: item.content, kind: item.kind },
            replaced,
            message: REMEMBERED_MESSAGE,
          });
        } catch (error) {
          return guidedError(
            `No pude guardar el recuerdo: ${describeError(error)}`,
            'Si la memoria está llena, reemplaza o fusiona recuerdos existentes (forget) y vuelve a intentar. No guardes secretos.',
          );
        }
      },
    },

    {
      name: 'forget',
      access: 'public',
      accessReason:
        "Vex is limited to owner/admin; this only deletes a preference note of the caller's own store.",
      version: '1',
      domain: 'memory',
      description:
        'Borra un recuerdo de la memoria de la tienda por su clave (p. ej. cuando el usuario pide "olvida eso" o para liberar espacio al fusionar recuerdos). No pide confirmación.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Clave del recuerdo a borrar.' },
        },
        required: ['key'],
      },
      handler: async (args, context) => {
        const actor = actorOf(context);
        if (!actor) return NO_CONTEXT;
        try {
          const deleted = await memoryService.forget(actor, String(args.key ?? ''));
          return JSON.stringify({
            deleted,
            message: deleted
              ? 'Olvidado. Díselo al usuario en una frase.'
              : 'No había un recuerdo con esa clave; no se borró nada.',
          });
        } catch (error) {
          return guidedError(`No pude borrar el recuerdo: ${describeError(error)}`);
        }
      },
    },
  ];
}

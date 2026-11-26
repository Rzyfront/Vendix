import {
  RegisteredTool,
  ToolExecutionContext,
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
} from '../interfaces/tool.interface';
import { RequestContextService } from '@common/context/request-context.service';
import type { VexDesignService } from '../../../domains/store/apps/vex-design/vex-design.service';
import {
  DESIGN_CHAT_APP_KINDS,
  DesignChatAppKind,
  VEX_DESIGN_OPERATIONS,
  VexDesignOperation,
  isDesignChatAppKind,
} from '../../../domains/store/apps/vex-design/vex-design.types';

export interface VexDesignToolDeps {
  design: VexDesignService;
}

/** Nombres de las herramientas de diseño permitidas en el chat del constructor de apps. */
export const VEX_DESIGN_TOOL_NAMES = [
  'vex_design_read',
  'vex_design_patch',
  'vex_design_discard',
] as const;

/**
 * Apps F4 — herramientas acotadas de Vex para el constructor de apps.
 *
 * Regla dura: Vex jamás genera HTML/CSS libre. Solo lee o parchea el documento
 * validado por `app-page.contract.ts` en el borrador de la conversación (nunca
 * escribe ni publica en `store_apps`). Cada herramienta exige:
 * - permiso de edición de apps (`store:apps:manage`),
 * - scoping estricto por tienda (`store_id` del request/contexto) y conversación
 *   del turno (`TURN_BOUND_CONVERSATION_TOOLS`),
 * - scoping por app abierta (rechaza `store_home` y cualquier cruce de app).
 */
export function createVexDesignTools({
  design,
}: VexDesignToolDeps): RegisteredTool[] {
  const resolveScope = (
    toolName: string,
    args: Record<string, any>,
    context: ToolExecutionContext,
  ):
    | {
        ok: true;
        storeId: number;
        conversationId: number;
        appKind?: DesignChatAppKind;
      }
    | { ok: false; response: string } => {
    const storeId = context.store_id ?? RequestContextService.getStoreId();
    if (!storeId) {
      return {
        ok: false,
        response: JSON.stringify(
          buildToolErrorEnvelope(
            toolName,
            'No hay tienda activa en el contexto del request.',
            'Vuelve a abrir el editor desde tu tienda e inténtalo de nuevo.',
          ),
        ),
      };
    }

    // Regla de seguridad: exige `context.conversation_id` fijado por el servidor,
    // sin aceptar fallback desde los argumentos que envía el modelo.
    const conversationId =
      typeof context.conversation_id === 'number'
        ? context.conversation_id
        : Number.NaN;
    if (!Number.isInteger(conversationId) || conversationId < 1) {
      return {
        ok: false,
        response: JSON.stringify(
          buildToolErrorEnvelope(
            toolName,
            'Falta la conversación activa del editor de diseño.',
            'Usa esta herramienta únicamente dentro del chat lateral del editor de apps.',
          ),
        ),
      };
    }

    if (args.app_kind !== undefined && args.app_kind !== null) {
      if (!isDesignChatAppKind(args.app_kind)) {
        return {
          ok: false,
          response: JSON.stringify(
            buildToolErrorEnvelope(
              toolName,
              `La app "${String(args.app_kind)}" no admite el chat de diseño con Vex.`,
              `Solo está disponible para: ${DESIGN_CHAT_APP_KINDS.join(', ')}.`,
            ),
          ),
        };
      }
      return {
        ok: true,
        storeId,
        conversationId,
        appKind: args.app_kind,
      };
    }

    return { ok: true, storeId, conversationId };
  };

  return [
    {
      name: 'vex_design_read',
      domain: 'vex_design',
      version: '1',
      readOnly: true,
      requiredPermissions: ['store:apps:manage'],
      description:
        'Devuelve el borrador actual de la app abierta en el constructor: bloques con id, tipo, enabled, props relevantes, tokens de tema e imágenes disponibles en la galería de la tienda.',
      parameters: {
        type: 'object',
        properties: {
          app_kind: {
            type: 'string',
            enum: [...DESIGN_CHAT_APP_KINDS],
            description:
              'App abierta (opcional; si se envía, debe coincidir con la app de la sesión).',
          },
          conversation_id: {
            type: 'number',
            description:
              'Conversación del editor. El servidor la fija automáticamente al turno actual.',
          },
        },
        required: [],
      },
      handler: async (args, context) => {
        const scope = resolveScope('vex_design_read', args, context);
        if (!scope.ok) return scope.response;

        const draft = await design.readDraft(
          scope.storeId,
          scope.conversationId,
          scope.appKind,
        );
        if (!draft) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_design_read',
              'No encontré un borrador abierto para esta conversación y app.',
              'Verifica que estás editando una app admitida (product_page, service_page o booking) y vuelve a intentarlo.',
            ),
          );
        }

        return JSON.stringify(
          buildToolSuccessEnvelope('vex_design_read', draft),
        );
      },
    },
    {
      name: 'vex_design_patch',
      domain: 'vex_design',
      version: '1',
      requiredPermissions: ['store:apps:manage'],
      description:
        'Aplica UNA sola operación validada al borrador de la app abierta (nunca guarda ni publica) y devuelve el documento resultante + un resumen legible. Operaciones: set_theme (tokens cerrados de tema), set_block_prop (solo props del catálogo del bloque o "hero"), set_block_media (imagen de la galería por media_id entero, nunca URL externa), add_block, remove_block, reorder_blocks y apply_preset (presets por industria).',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: [...VEX_DESIGN_OPERATIONS],
            description: 'Operación acotada a aplicar.',
          },
          app_kind: {
            type: 'string',
            enum: [...DESIGN_CHAT_APP_KINDS],
            description:
              'App abierta (opcional; debe coincidir con la sesión activa).',
          },
          tokens: {
            type: 'object',
            description:
              'Solo para set_theme: objeto con tokens cerrados de tema (ej. surface_color, text_color, primary_color, heading_font, radius). Usa null para limpiar un token.',
          },
          block_id: {
            type: 'string',
            description:
              'Para set_block_prop, set_block_media o remove_block: "hero" para la portada o el id de un bloque existente.',
          },
          prop: {
            type: 'string',
            description:
              'Para set_block_prop o set_block_media: nombre exacto de la propiedad del catálogo (o "enabled").',
          },
          value: {
            description:
              'Para set_block_prop: nuevo valor válido según el catálogo (usa null para limpiar).',
          },
          media_id: {
            type: 'number',
            description:
              'Solo para set_block_media: id numérico de la imagen en la galería de la tienda. Nunca pases una URL externa.',
          },
          item_index: {
            type: 'number',
            description:
              'Opcional en set_block_media: índice del elemento en listas (gallery.image_urls, items.image_url, items.photo_url).',
          },
          block_type: {
            type: 'string',
            description:
              'Solo para add_block: tipo de bloque del catálogo de la app abierta.',
          },
          position: {
            type: 'number',
            description: 'Opcional en add_block: posición 0-based donde insertar.',
          },
          id: {
            type: 'string',
            description: 'Opcional en add_block: id slug del nuevo bloque.',
          },
          enabled: {
            type: 'boolean',
            description: 'Opcional en add_block: si inicia visible (default true).',
          },
          props: {
            type: 'object',
            description:
              'Opcional en add_block: props iniciales válidas según el catálogo del bloque.',
          },
          block_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Solo para reorder_blocks: lista completa de ids de bloques en el nuevo orden.',
          },
          preset_id: {
            type: 'string',
            description:
              'Solo para apply_preset: identificador del preset por industria disponible.',
          },
          conversation_id: {
            type: 'number',
            description:
              'Conversación del editor. El servidor la fija automáticamente al turno actual.',
          },
        },
        required: ['op'],
      },
      handler: async (args, context) => {
        const scope = resolveScope('vex_design_patch', args, context);
        if (!scope.ok) return scope.response;

        const operation = buildOperationFromArgs(args);
        if (!operation.ok) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_design_patch',
              operation.error,
              'Revisa los parámetros permitidos por el catálogo y vuelve a intentarlo.',
            ),
          );
        }

        const result = await design.patchDraft(
          scope.storeId,
          scope.conversationId,
          operation.op,
          scope.appKind,
        );

        if (!result.ok) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_design_patch',
              result.error,
              'El borrador quedó intacto. Corrige el parámetro según el catálogo de la app o consulta `vex_design_read`.',
            ),
          );
        }

        return JSON.stringify(
          buildToolSuccessEnvelope('vex_design_patch', {
            app_kind: result.app_kind,
            op: result.op,
            summary: result.summary,
            touched_block_id: result.touched_block_id,
            history_depth: result.history_depth,
            can_discard: result.can_discard,
            document: result.document,
          }),
        );
      },
    },
    {
      name: 'vex_design_discard',
      domain: 'vex_design',
      version: '1',
      requiredPermissions: ['store:apps:manage'],
      description:
        'Descarta el último cambio aplicado al borrador de la app abierta (deshacer del borrador, nunca afecta la versión publicada).',
      parameters: {
        type: 'object',
        properties: {
          app_kind: {
            type: 'string',
            enum: [...DESIGN_CHAT_APP_KINDS],
            description:
              'App abierta (opcional; debe coincidir con la sesión activa).',
          },
          conversation_id: {
            type: 'number',
            description:
              'Conversación del editor. El servidor la fija automáticamente al turno actual.',
          },
        },
        required: [],
      },
      handler: async (args, context) => {
        const scope = resolveScope('vex_design_discard', args, context);
        if (!scope.ok) return scope.response;

        const result = await design.discardLast(
          scope.storeId,
          scope.conversationId,
          scope.appKind,
        );

        if (!result.ok) {
          return JSON.stringify(
            buildToolErrorEnvelope(
              'vex_design_discard',
              result.error,
              'No había cambios por deshacer en esta conversación.',
            ),
          );
        }

        return JSON.stringify(
          buildToolSuccessEnvelope('vex_design_discard', {
            app_kind: result.app_kind,
            discarded_summary: result.discarded_summary,
            touched_block_id: result.touched_block_id,
            history_depth: result.history_depth,
            can_discard: result.can_discard,
            document: result.document,
          }),
        );
      },
    },
  ];
}

function buildOperationFromArgs(
  args: Record<string, any>,
): { ok: true; op: VexDesignOperation } | { ok: false; error: string } {
  const op = args.op;
  switch (op) {
    case 'set_theme':
      return { ok: true, op: { op: 'set_theme', tokens: args.tokens } };
    case 'set_block_prop':
      return {
        ok: true,
        op: {
          op: 'set_block_prop',
          block_id: args.block_id,
          prop: args.prop,
          value: args.value,
        },
      };
    case 'set_block_media':
      return {
        ok: true,
        op: {
          op: 'set_block_media',
          block_id: args.block_id,
          media_id: args.media_id,
          ...(args.prop !== undefined ? { prop: args.prop } : {}),
          ...(args.item_index !== undefined
            ? { item_index: args.item_index }
            : {}),
          ...(args.url !== undefined ? { url: args.url } : {}),
        },
      };
    case 'add_block':
      return {
        ok: true,
        op: {
          op: 'add_block',
          block_type: args.block_type,
          ...(args.position !== undefined ? { position: args.position } : {}),
          ...(args.id !== undefined ? { id: args.id } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
          ...(args.props !== undefined ? { props: args.props } : {}),
        },
      };
    case 'remove_block':
      return {
        ok: true,
        op: { op: 'remove_block', block_id: args.block_id },
      };
    case 'reorder_blocks':
      return {
        ok: true,
        op: { op: 'reorder_blocks', block_ids: args.block_ids },
      };
    case 'apply_preset':
      return {
        ok: true,
        op: { op: 'apply_preset', preset_id: args.preset_id },
      };
    default:
      return {
        ok: false,
        error: `Operación "${String(op)}" no reconocida. Usa una de: ${VEX_DESIGN_OPERATIONS.join(', ')}.`,
      };
  }
}

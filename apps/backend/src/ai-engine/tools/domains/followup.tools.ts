import { createHash, randomUUID } from 'node:crypto';
import {
  RegisteredTool,
  ToolExecutionContext,
  buildToolSuccessEnvelope,
} from '../interfaces/tool.interface';
import { RequestContextService } from '../../../common/context/request-context.service';
import { localDateString } from '../../../common/utils/store-timezone.util';
import { REMINDER_LINK_TYPES } from '../../../domains/store/reminders/dto/reminders.dto';

export const FOLLOWUP_KINDS = ['reminder', 'log_entry'] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
export type FollowupStatus = 'suggested' | 'saved' | 'dismissed';

/** Contract shared with the frontend: lives in `ai_messages.metadata.followups`. */
export interface Followup {
  id: string;
  kind: FollowupKind;
  title: string;
  note?: string | null;
  /** ISO 8601 UTC. */
  remind_at?: string | null;
  link_type?: string | null;
  link_id?: number | null;
  link_label?: string | null;
  source_phrase?: string | null;
  status: FollowupStatus;
  reminder_id?: number | null;
}

export type FollowupSuggestResult =
  | { suggested: true; followup: Followup }
  | {
      suggested: false;
      reason: 'duplicate' | 'muted' | 'limit' | 'invalid';
      message?: string;
    };

export interface FollowupConversationState {
  muted: boolean;
  /** Followups already in the conversation's messages, any status. */
  known: Followup[];
}

export interface FollowupToolDeps {
  remindersService: {
    parseRemindAt(value: string | null | undefined, tz: string): Date | null;
    list(
      actor: { store_id: number; user_id: number },
      query: { status: 'pending'; limit: number },
    ): Promise<{
      items: Array<{ title: string; remind_at: Date | null }>;
    }>;
  };
  conversations: {
    /** `null` when the conversation is not a Vex thread of this user. */
    getState(
      conversationId: number,
      userId: number,
    ): Promise<FollowupConversationState | null>;
  };
  resolveTimezone(storeId: number): Promise<string>;
  /** Identity of the current turn (one HTTP request); `undefined` = unknown. */
  turnKey?: () => string | undefined;
  now?: () => Date;
}

export const FOLLOWUP_TITLE_MAX = 120;
const NOTE_MAX = 500;
const PHRASE_MAX = 300;
const PENDING_SCAN_LIMIT = 200;
const TURN_MEMORY = 500;

export function normalizeFollowupTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** kind + normalized title + local date (`YYYY-MM-DD`, or '' without date). */
export function followupFingerprint(
  kind: string,
  title: string,
  localDate: string | null,
): string {
  return createHash('sha1')
    .update(`${kind}|${normalizeFollowupTitle(title)}|${localDate ?? ''}`)
    .digest('hex');
}

const LINK_PROPERTIES = {
  link_type: {
    type: 'string',
    enum: [...REMINDER_LINK_TYPES],
    description:
      'Vínculo opcional, mismo vocabulario que create_reminder: product, order, customer, supplier, purchase_order, quotation, invoice (exigen link_id) o metric (solo link_label).',
  },
  link_id: {
    type: 'number',
    description: 'ID del registro vinculado (resuélvelo antes con la herramienta del dominio).',
  },
  link_label: { type: 'string', description: 'Etiqueta legible del vínculo.' },
} as const;

function reply(result: FollowupSuggestResult): string {
  return JSON.stringify(
    buildToolSuccessEnvelope('suggest_followup', {
      ...result,
      ...(result.suggested
        ? {
            instruction:
              'La ficha ya aparece sola debajo de tu respuesta. No la repitas ni menciones esta herramienta; sigue respondiendo con normalidad.',
          }
        : {}),
    }),
  );
}

const invalid = (message: string): string =>
  reply({ suggested: false, reason: 'invalid', message });

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * `suggest_followup` (F1/T5). READ-ONLY on the business: it validates, checks
 * the guards and returns a typed suggestion; nothing is written here. The chat
 * service persists the suggestion in the assistant message metadata, and the
 * person decides on the card (`save` creates the reminder).
 */
export function createFollowupTools(deps: FollowupToolDeps): RegisteredTool[] {
  const now = deps.now ?? (() => new Date());
  const turnsWithSuggestion = new Set<string>();
  const rememberTurn = (key: string) => {
    if (turnsWithSuggestion.size >= TURN_MEMORY) {
      const oldest = turnsWithSuggestion.values().next().value;
      if (oldest !== undefined) turnsWithSuggestion.delete(oldest);
    }
    turnsWithSuggestion.add(key);
  };

  return [
    {
      name: 'suggest_followup',
      access: 'public',
      accessReason:
        "Suggests a follow-up inside the caller's own conversation; reads no business data.",
      version: '1',
      domain: 'followups',
      readOnly: true,
      description:
        'Sugiere guardar un seguimiento SIN escribir nada: la persona decide en una ficha bajo tu respuesta. En CADA turno evalúa si la conversación trae un compromiso con fecha, un pendiente con un cliente o proveedor, un acuerdo, o una acción aplicada que conviene revisar después; si es así, llama esta herramienta UNA sola vez además de responder con normalidad. Nunca en charla trivial ni para preguntas puras. Si la persona lo pide explícito («recuérdame…»), usa create_reminder directo y no esta. kind=reminder exige remind_at; kind=log_entry es una nota sin fecha. Si responde suggested=false no insistas ni lo menciones.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: [...FOLLOWUP_KINDS],
            description: 'reminder (con fecha) o log_entry (nota sin fecha en la bitácora).',
          },
          title: {
            type: 'string',
            description: `Qué hacer o recordar, corto y accionable (máx. ${FOLLOWUP_TITLE_MAX}).`,
          },
          note: { type: 'string', description: `Nota opcional (máx. ${NOTE_MAX}).` },
          remind_at: {
            type: 'string',
            description:
              'Obligatorio en reminder. Hora LOCAL de la tienda YYYY-MM-DDTHH:mm (ej. 2026-11-27T09:00); solo fecha = 8:00. Debe ser futura.',
          },
          ...LINK_PROPERTIES,
          source_phrase: {
            type: 'string',
            description:
              'Frase de la conversación que motivó la sugerencia, citada tal cual.',
          },
        },
        required: ['kind', 'title', 'source_phrase'],
      },
      handler: async (args, context: ToolExecutionContext) => {
        const storeId = Number(context.store_id);
        const userId = Number(context.user_id);
        const conversationId = Number(args.conversation_id);
        if (
          !Number.isInteger(storeId) ||
          !Number.isInteger(userId) ||
          !Number.isInteger(conversationId) ||
          conversationId <= 0
        ) {
          return invalid('Sin conversación, usuario o tienda en contexto.');
        }

        const kind = args.kind as FollowupKind;
        if (!FOLLOWUP_KINDS.includes(kind)) {
          return invalid('kind debe ser reminder o log_entry.');
        }
        const title = text(args.title);
        if (!title || title.length > FOLLOWUP_TITLE_MAX) {
          return invalid(`title es obligatorio y de máximo ${FOLLOWUP_TITLE_MAX} caracteres.`);
        }
        const note = text(args.note) || null;
        if (note && note.length > NOTE_MAX) {
          return invalid(`note admite máximo ${NOTE_MAX} caracteres.`);
        }
        const phrase = text(args.source_phrase) || null;
        if (phrase && phrase.length > PHRASE_MAX) {
          return invalid(`source_phrase admite máximo ${PHRASE_MAX} caracteres.`);
        }

        const linkType = text(args.link_type) || null;
        const rawLinkId = args.link_id;
        const linkId =
          rawLinkId === undefined || rawLinkId === null ? null : Number(rawLinkId);
        const linkLabel = text(args.link_label) || null;
        if (linkType) {
          if (!(REMINDER_LINK_TYPES as readonly string[]).includes(linkType)) {
            return invalid(`link_type "${linkType}" no existe.`);
          }
          if (linkType === 'metric') {
            if (!linkLabel) return invalid('metric exige link_label.');
          } else if (!Number.isInteger(linkId) || (linkId as number) <= 0) {
            return invalid(`${linkType} exige link_id (resuélvelo antes).`);
          }
        } else if (linkId !== null || linkLabel) {
          return invalid('link_id y link_label requieren link_type.');
        }

        const tz = await deps.resolveTimezone(storeId);
        let remindAt: Date | null = null;
        const rawRemindAt = text(args.remind_at);
        if (rawRemindAt) {
          try {
            remindAt = deps.remindersService.parseRemindAt(rawRemindAt, tz);
          } catch {
            return invalid(
              'remind_at no es válido: usa YYYY-MM-DDTHH:mm en hora de la tienda.',
            );
          }
          if (remindAt && remindAt.getTime() <= now().getTime()) {
            return invalid('remind_at ya pasó: debe ser una fecha futura.');
          }
        }
        if (kind === 'reminder' && !remindAt) {
          return invalid('Un reminder necesita remind_at; sin fecha usa log_entry.');
        }
        const localDate = remindAt ? localDateString(remindAt, tz) : null;

        const turn = deps.turnKey?.();
        if (turn && turnsWithSuggestion.has(turn)) {
          return reply({ suggested: false, reason: 'limit' });
        }

        const state = await deps.conversations.getState(conversationId, userId);
        if (!state) {
          return invalid('La conversación no es un hilo de Vex de esta persona.');
        }
        if (state.muted) return reply({ suggested: false, reason: 'muted' });

        const fingerprint = followupFingerprint(kind, title, localDate);
        const seen = state.known.some(
          (known) =>
            followupFingerprint(
              known.kind,
              known.title,
              known.remind_at
                ? localDateString(new Date(known.remind_at), tz)
                : null,
            ) === fingerprint,
        );
        if (seen) return reply({ suggested: false, reason: 'duplicate' });

        try {
          const pending = await deps.remindersService.list(
            { store_id: storeId, user_id: userId },
            { status: 'pending', limit: PENDING_SCAN_LIMIT },
          );
          const normalized = normalizeFollowupTitle(title);
          const equivalent = pending.items.some(
            (item) =>
              normalizeFollowupTitle(item.title) === normalized &&
              (item.remind_at ? localDateString(item.remind_at, tz) : null) ===
                localDate,
          );
          if (equivalent) return reply({ suggested: false, reason: 'duplicate' });
        } catch {
          // Cheap best-effort check: a failing read must not block the card.
        }

        if (turn) rememberTurn(turn);
        const followup: Followup = {
          id: randomUUID(),
          kind,
          title,
          note,
          remind_at: remindAt ? remindAt.toISOString() : null,
          link_type: linkType,
          link_id: linkType && linkType !== 'metric' ? linkId : null,
          link_label: linkLabel,
          source_phrase: phrase,
          status: 'suggested',
          reminder_id: null,
        };
        return reply({ suggested: true, followup });
      },
    },
  ];
}

/**
 * Suggestions a turn produced, read from its tool trace. At most one per turn
 * (the tool already enforces it; this keeps the stored shape honest even if a
 * provider replays a call). Compacted or non-JSON results are skipped.
 */
export function extractSuggestedFollowups(
  toolsUsed: ReadonlyArray<{ name: string; result: unknown }>,
): Followup[] {
  for (const tool of toolsUsed) {
    if (tool.name !== 'suggest_followup' || typeof tool.result !== 'string') {
      continue;
    }
    try {
      const data = (JSON.parse(tool.result) as { data?: FollowupSuggestResult })
        ?.data;
      if (data?.suggested === true && data.followup?.id) return [data.followup];
    } catch {
      // Not a suggestion envelope: nothing to persist.
    }
  }
  return [];
}

/** Request identity used as the per-turn key (one HTTP request = one turn). */
export function currentTurnKey(): string | undefined {
  return RequestContextService.getContext()?.request_id;
}

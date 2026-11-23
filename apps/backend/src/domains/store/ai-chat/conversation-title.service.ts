import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

/** Aplicación de IA (fila de `ai_engine_applications`) que redacta el título. */
export const VEX_TITLE_APP_KEY = 'vex_title_generator';
/** Tope de espera de todo el título; pasado esto se usa el respaldo. */
export const TITLE_TIMEOUT_MS = 4000;
export const MAX_TITLE_CHARS = 60;

export type TitleSource = 'auto' | 'fallback';

/** Frame SSE extra que avisa al cliente del título ya persistido. */
export interface ConversationTitleFrame {
  type: 'conversation_title';
  conversation_id: number;
  title: string;
}

/** Corta en el último límite de palabra que quepa en `max` caracteres. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : text.slice(0, max);
  return cut.trim();
}

/** Título de respaldo: el primer mensaje, recortado en límite de palabra. */
export function fallbackTitle(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return cutAtWord(flat, MAX_TITLE_CHARS)
    .replace(/[.\s]+$/, '')
    .trim();
}

/**
 * Limpia la salida del modelo: una línea, sin comillas ni punto final y con
 * un máximo de 60 caracteres. `null` si no queda nada usable.
 */
export function sanitizeGeneratedTitle(raw: string | undefined): string | null {
  if (!raw) return null;
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const cleaned = firstLine
    .replace(/^(t[ií]tulo\s*:\s*)/i, '')
    .replace(/^["'“”«»`\s]+|["'“”«».`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = cutAtWord(cleaned, MAX_TITLE_CHARS)
    .replace(/[.\s]+$/, '')
    .trim();
  return cut.length > 0 ? cut : null;
}

/**
 * Título de las conversaciones de Vex: generado por un modelo económico en el
 * primer turno, con respaldo determinista. Nunca lanza y nunca bloquea el turno:
 * el llamador recibe una promesa que siempre resuelve.
 */
@Injectable()
export class ConversationTitleService {
  private readonly logger = new Logger(ConversationTitleService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * Genera y persiste el título. Resuelve con el título guardado, o `null` si no
   * se guardó nada (título puesto a mano, mensaje vacío o fallo al persistir).
   */
  start(
    conversationId: number,
    firstMessage: string,
    timeoutMs: number = TITLE_TIMEOUT_MS,
  ): Promise<string | null> {
    return this.run(conversationId, firstMessage, timeoutMs).catch((err) => {
      this.logger.warn(
        `conversation_title_failed id=${conversationId}: ${(err as Error).message}`,
      );
      return null;
    });
  }

  /** Espera el título hasta `deadlineMs`; `null` si aún no está. */
  async waitFor(
    task: Promise<string | null>,
    deadlineMs: number,
  ): Promise<string | null> {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      return Promise.race([task, Promise.resolve(null)]);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), remaining);
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async run(
    conversationId: number,
    firstMessage: string,
    timeoutMs: number,
  ): Promise<string | null> {
    if (!firstMessage?.trim()) return null;

    let title: string | null = null;
    let source: TitleSource = 'fallback';
    try {
      title = await this.generate(firstMessage, timeoutMs);
      if (title) source = 'auto';
    } catch (err) {
      this.logger.warn(
        `vex_title_generator_unavailable: ${(err as Error).message}`,
      );
    }
    if (!title) title = fallbackTitle(firstMessage);
    if (!title) return null;

    return (await this.persist(conversationId, title, source)) ? title : null;
  }

  private async generate(
    firstMessage: string,
    timeoutMs: number,
  ): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('title generation timed out')),
        timeoutMs,
      );
    });
    try {
      const response = await Promise.race([
        this.aiEngine.run(VEX_TITLE_APP_KEY, {
          first_message: firstMessage.slice(0, 1000),
        }),
        timeout,
      ]);
      if (!response.success) return null;
      return sanitizeGeneratedTitle(response.content);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Guarda título y `title_source`, salvo que la persona ya lo haya puesto. */
  private async persist(
    conversationId: number,
    title: string,
    source: TitleSource,
  ): Promise<boolean> {
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: { id: conversationId },
    });
    if (!conversation) return false;
    const previous =
      conversation.metadata &&
      typeof conversation.metadata === 'object' &&
      !Array.isArray(conversation.metadata)
        ? (conversation.metadata as Record<string, unknown>)
        : {};
    if (previous.title_source === 'user') return false;
    await this.prisma.ai_conversations.update({
      where: { id: conversationId },
      data: {
        title,
        metadata: {
          ...previous,
          title_source: source,
        } as Prisma.InputJsonValue,
      },
    });
    return true;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AIEngineService } from '../ai-engine.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  estimateAgentInputTokens,
} from './agent-context-budget';

/** Aplicación de IA que resume el hilo (fila de `ai_engine_applications`). */
export const VEX_SUMMARIZER_APP_KEY = 'vex_context_summarizer';
export const COMPACTION_THRESHOLD = 0.75;
export const KEEP_LAST_MESSAGES = 10;
export const SUMMARY_TIMEOUT_MS = 10_000;
export const MAX_FALLBACK_SUMMARY_CHARS = 2000;
const MAX_TRANSCRIPT_CHARS = 60_000;

/** Frame SSE que avisa al cliente de que el hilo se resumió. */
export interface ContextCompactedFrame {
  type: 'context_compacted';
  conversation_id: number;
  summary: string;
  summary_through_message_id: number;
}

export interface CompactableConversation {
  id: number;
  summary?: string | null;
  summary_through_message_id?: number | null;
  messages: Array<{ id: number; role: string; content: string }>;
}

export interface CompactionResult {
  summary: string;
  summary_through_message_id: number;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Compacta hilos largos de Vex: resume lo viejo (modelo con respaldo
 * extractivo determinista) para que el turno nunca falle por desborde.
 * Nunca lanza.
 */
@Injectable()
export class ConversationCompactorService {
  private readonly logger = new Logger(ConversationCompactorService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
  ) {}

  async compactIfNeeded(
    conversation: CompactableConversation,
    contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
    timeoutMs: number = SUMMARY_TIMEOUT_MS,
  ): Promise<CompactionResult | null> {
    try {
      const through = conversation.summary_through_message_id ?? 0;
      const previous = conversation.summary?.trim() || '';
      const live = conversation.messages.filter(
        (m) =>
          m.id > through &&
          (m.role === 'user' || m.role === 'assistant' || m.role === 'system'),
      );
      if (live.length <= KEEP_LAST_MESSAGES) return null;

      const estimate = estimateAgentInputTokens(
        [
          ...(previous
            ? [{ role: 'system' as const, content: previous }]
            : []),
          ...live.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
        ],
        [],
      );
      if (estimate <= contextWindowTokens * COMPACTION_THRESHOLD) return null;

      const older = live.slice(0, -KEEP_LAST_MESSAGES);
      const lastOlder = older[older.length - 1];
      let summary = await this.summarize(previous, older, timeoutMs);
      if (!summary) summary = this.extractive(previous, older);

      const result: CompactionResult = {
        summary,
        summary_through_message_id: lastOlder.id,
      };
      await this.persist(conversation.id, result);
      return result;
    } catch (err) {
      this.logger.warn(
        `conversation_compaction_failed id=${conversation.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async summarize(
    previous: string,
    older: CompactableConversation['messages'],
    timeoutMs: number,
  ): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('summary generation timed out')),
        timeoutMs,
      );
    });
    try {
      const transcript = older
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n')
        .slice(-MAX_TRANSCRIPT_CHARS);
      const response = await Promise.race([
        this.aiEngine.run(VEX_SUMMARIZER_APP_KEY, {
          previous_summary: previous,
          transcript,
        }),
        timeout,
      ]);
      const text = response?.success ? response.content?.trim() : '';
      return text || null;
    } catch (err) {
      this.logger.warn(
        `vex_context_summarizer_unavailable: ${(err as Error).message}`,
      );
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Respaldo determinista: resumen previo + una línea por pedido viejo. */
  private extractive(
    previous: string,
    older: CompactableConversation['messages'],
  ): string {
    const lines = older
      .filter((m) => m.role === 'user')
      .map((m) => `- ${oneLine(m.content).slice(0, 160)}`);
    const head = previous ? `${previous}\n` : '';
    let out = `${head}Pedidos anteriores:`;
    for (const line of lines) {
      if (out.length + 1 + line.length > MAX_FALLBACK_SUMMARY_CHARS) break;
      out += `\n${line}`;
    }
    return out.slice(0, MAX_FALLBACK_SUMMARY_CHARS);
  }

  private async persist(
    conversationId: number,
    result: CompactionResult,
  ): Promise<void> {
    try {
      // `summary_through_message_id` is newer than the generated client in
      // some checkouts; the cast keeps the write typed against the schema.
      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: {
          summary: result.summary,
          summary_through_message_id: result.summary_through_message_id,
        } as Prisma.ai_conversationsUpdateInput,
      });
    } catch (err) {
      this.logger.warn(
        `conversation_compaction_persist_failed id=${conversationId}: ${(err as Error).message}`,
      );
    }
  }
}

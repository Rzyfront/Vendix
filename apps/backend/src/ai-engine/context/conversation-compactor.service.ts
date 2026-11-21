import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AIEngineService } from '../ai-engine.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import {
  CONTEXT_COMPACTION_PERCENT,
  type ContextBudgetReport,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  contextUsagePercent,
  estimateAgentInputTokens,
  renderTurnActionsLine,
} from './agent-context-budget';

/** Aplicación de IA que resume el hilo (fila de `ai_engine_applications`). */
export const VEX_SUMMARIZER_APP_KEY = 'vex_context_summarizer';
export const SUMMARY_TIMEOUT_MS = 10_000;
/**
 * Conversational rows after the summary pointer that travel verbatim to the
 * model (`AIChatService.buildContextWindow`). A live row past this count
 * would be left out of the window, so it is summarized instead (B3).
 */
export const CHAT_WINDOW_MESSAGES = 20;
/**
 * Literal recent rows kept after compacting: at most half the window, so a
 * pass always frees room (the ring goes down and the next pass is several
 * turns away), while they fit in `KEEP_WINDOW_SHARE` of the model window;
 * never fewer than the last exchange.
 */
export const MIN_KEEP_MESSAGES = 2;
export const MAX_KEEP_MESSAGES = 10;
export const KEEP_WINDOW_SHARE = 0.2;
/**
 * Over the ring threshold alone (every live row still travels), fewer older
 * rows than this is not worth a summary pass and its cost.
 */
export const MIN_COMPACT_BATCH = 4;
/** Hard cap of a stored summary, whichever path wrote it. */
export const MAX_SUMMARY_CHARS = 4000;
/** Share of the cap reserved for the rows this pass covers. */
export const NEW_SECTION_SHARE = 0.6;
const LINE_CAPS = [240, 160, 100, 60];
const PREVIOUS_LINE_CAP = 120;
/** First lines kept when a section must drop its middle: the beginning. */
const HEAD_LINES = 3;
const MAX_TRANSCRIPT_CHARS = 60_000;
/** Below this many chars per row the transcript says nothing: extractive. */
const MIN_TRANSCRIPT_LINE_CHARS = 80;
const CONVERSATIONAL_ROLES = new Set(['user', 'assistant', 'system']);
const SUMMARY_HEADER = 'Lo conversado antes (más antiguo primero):';

/** Frame SSE que avisa al cliente de que el hilo se resumió. */
export interface ContextCompactedFrame {
  type: 'context_compacted';
  conversation_id: number;
  summary: string;
  summary_through_message_id: number;
}

export interface CompactableMessage {
  id: number;
  role: string;
  content: string;
  tool_calls?: unknown;
  metadata?: unknown;
}

export interface CompactableConversation {
  id: number;
  summary?: string | null;
  summary_through_message_id?: number | null;
  messages: CompactableMessage[];
}

export interface CompactionResult {
  summary: string;
  summary_through_message_id: number;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const plain = (text: string) =>
  oneLine(text.replace(/[`*_#>|]+/g, ' ').replace(/-{3,}/g, ' '));
const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * Gist of an assistant answer within `max` chars: the first sentence plus the
 * sentences that carry figures (results, totals, ids), in their order.
 */
function gistOf(text: string, max: number): string {
  const flat = plain(text);
  if (flat.length <= max) return flat;
  const sentences = flat.split(/(?<=[.!?:;])\s+/);
  const picked = [
    sentences[0],
    ...sentences.slice(1).filter((s) => /\d/.test(s)),
  ];
  let out = '';
  for (const sentence of picked) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  return clip(out || flat, max);
}

/** One line per covered row, whatever its role or content: none goes unrecorded. */
function lineFor(message: CompactableMessage, cap: number): string {
  if (message.role === 'assistant') {
    const actions = renderTurnActionsLine(message.tool_calls, message.metadata);
    const gist = message.content.trim() ? gistOf(message.content, cap) : '';
    const body = [gist, actions ? clip(actions, cap) : ''].filter(Boolean).join(' ');
    return `- Vex: ${body || '(respuesta vacía)'}`;
  }
  const text = clip(plain(message.content), cap);
  return message.role === 'user'
    ? `- Persona: ${text || '(mensaje vacío)'}`
    : `- Sistema: ${text || '(aviso vacío)'}`;
}

/** Lines of a stored summary, without its header (re-summarizing input). */
function previousLines(previous: string): string[] {
  return previous
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== SUMMARY_HEADER);
}

const sizeOf = (xs: string[]) => xs.reduce((n, x) => n + x.length + 1, 0);
const omittedMarker = (n: number) => `- (… ${n} puntos intermedios omitidos)`;

/**
 * Fits `lines` into `budget` chars without dropping any silently: as-is when
 * they fit, else the first lines (the beginning) plus the newest lines that
 * fit, with the middle counted in an «omitted» marker.
 */
function fitLines(lines: string[], budget: number): string[] {
  if (budget <= 0 || !lines.length) return [];
  if (sizeOf(lines) <= budget) return lines;
  const head = lines.slice(0, HEAD_LINES);
  const rest = lines.slice(HEAD_LINES);
  const tail: string[] = [];
  let used = sizeOf(head) + omittedMarker(rest.length).length + 1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (used + rest[i].length + 1 > budget) break;
    tail.unshift(rest[i]);
    used += rest[i].length + 1;
  }
  const omitted = rest.length - tail.length;
  const out = [...head, ...(omitted ? [omittedMarker(omitted)] : []), ...tail];
  // A single huge line (prose summary) still has to respect the cap.
  return sizeOf(out) <= budget ? out : [clip(out.join(' '), budget - 1)];
}

/**
 * Re-summarizes the previous summary into `budget` chars: as-is when it fits,
 * then every line shortened, then `fitLines` (beginning + newest + marker).
 */
function compressPrevious(previous: string, budget: number): string[] {
  const lines = previousLines(previous);
  if (budget <= 0 || !lines.length) return [];
  if (sizeOf(lines) <= budget) return lines;
  return fitLines(
    lines.map((line) => clip(line, PREVIOUS_LINE_CAP)),
    budget,
  );
}

/**
 * Compacta hilos largos de Vex: resume lo viejo (modelo con respaldo
 * extractivo determinista) para que ninguna fila viva quede fuera del
 * contexto sin resumir y el turno no falle por desborde. Corre cuando las
 * filas vivas no caben en la ventana del chat o cuando el anillo «Contexto
 * N %» llega al umbral. Nunca lanza; sin persistir no hay compactación.
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
    budget: ContextBudgetReport | null | undefined,
    timeoutMs: number = SUMMARY_TIMEOUT_MS,
  ): Promise<CompactionResult | null> {
    try {
      const through = conversation.summary_through_message_id ?? 0;
      const previous = conversation.summary?.trim() || '';
      const live = conversation.messages.filter(
        (m) => m.id > through && CONVERSATIONAL_ROLES.has(m.role),
      );
      // Rows the window would leave out are always summarized (B3); the ring
      // threshold is the second trigger.
      const overflow = live.length > CHAT_WINDOW_MESSAGES;
      const percent = contextUsagePercent(budget);
      const overBudget =
        percent !== null && percent >= CONTEXT_COMPACTION_PERCENT;
      if (!overflow && !overBudget) return null;

      const keep = this.keepCount(
        live,
        budget?.context_window_tokens || DEFAULT_CONTEXT_WINDOW_TOKENS,
      );
      const older = live.slice(0, live.length - keep);
      if (!older.length || (!overflow && older.length < MIN_COMPACT_BATCH))
        return null;

      // Both paths cover every older row: the pointer never leaves a gap.
      const summary =
        (await this.summarize(previous, older, timeoutMs)) ??
        this.extractive(previous, older);
      if (!summary) return null;

      const result: CompactionResult = {
        summary,
        summary_through_message_id: older[older.length - 1].id,
      };
      if (!(await this.persist(conversation.id, result))) return null;
      return result;
    } catch (err) {
      this.logger.warn(
        `conversation_compaction_failed id=${conversation.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Newest rows that stay literal: [MIN, MAX], as many as fit the share. */
  private keepCount(
    live: CompactableMessage[],
    contextWindowTokens: number,
  ): number {
    const share = contextWindowTokens * KEEP_WINDOW_SHARE;
    let tokens = 0;
    let count = 0;
    for (let i = live.length - 1; i >= 0 && count < MAX_KEEP_MESSAGES; i--) {
      const m = live[i];
      const cost = estimateAgentInputTokens(
        [{ role: m.role as 'user' | 'assistant' | 'system', content: m.content }],
        [],
      );
      if (count >= MIN_KEEP_MESSAGES && tokens + cost > share) break;
      tokens += cost;
      count++;
    }
    return count;
  }

  private async summarize(
    previous: string,
    older: CompactableMessage[],
    timeoutMs: number,
  ): Promise<string | null> {
    // The model reads EVERY older row (the pointer moves past all of them):
    // when the transcript is too long each row gets an even share of it, and
    // when that share is too thin to say anything the extractive path runs.
    let lines = older.map((m) => {
      const actions =
        m.role === 'assistant'
          ? renderTurnActionsLine(m.tool_calls, m.metadata)
          : null;
      return `${m.role}: ${oneLine(m.content)}${actions ? ` ${actions}` : ''}`;
    });
    if (sizeOf(lines) > MAX_TRANSCRIPT_CHARS) {
      const share = Math.floor(MAX_TRANSCRIPT_CHARS / lines.length) - 1;
      if (share < MIN_TRANSCRIPT_LINE_CHARS) return null;
      lines = lines.map((line) => clip(line, share));
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Cancel the provider call itself: a late answer must not keep
        // spending the store's quota after the turn moved on.
        controller.abort();
        reject(new Error('summary generation timed out'));
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.aiEngine.run(
          VEX_SUMMARIZER_APP_KEY,
          {
            previous_summary: previous,
            transcript: lines.join('\n'),
          },
          undefined,
          { signal: controller.signal },
        ),
        timeout,
      ]);
      const text = response?.success ? response.content?.trim() : '';
      // An over-long model summary would be cut at its newest part: the
      // deterministic summary is bounded by construction instead.
      if (!text || text.length > MAX_SUMMARY_CHARS) return null;
      return text;
    } catch (err) {
      this.logger.warn(
        `vex_context_summarizer_unavailable: ${(err as Error).message}`,
      );
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Deterministic balanced summary: one line per older row (the person's
   * request and Vex's answer gist with its real actions), the new rows first
   * in the budget, the previous summary re-summarized into what is left.
   * Covers EVERY older row: when not all fit even at the smallest line cap,
   * the first and newest rows keep their line and the middle is counted in
   * an «omitted» marker (never dropped silently). `null` without content.
   */
  private extractive(
    previous: string,
    older: CompactableMessage[],
  ): string | null {
    const available = MAX_SUMMARY_CHARS - SUMMARY_HEADER.length - 1;
    const newBudget = previous.trim()
      ? Math.floor(available * NEW_SECTION_SHARE)
      : available;

    let lines: string[] = [];
    for (const cap of LINE_CAPS) {
      lines = older.map((m) => lineFor(m, cap));
      if (sizeOf(lines) <= newBudget) break;
    }
    const fresh = fitLines(lines, newBudget);
    if (!fresh.length) return null;

    const kept = compressPrevious(previous, available - sizeOf(fresh));
    const summary = [SUMMARY_HEADER, ...kept, ...fresh].join('\n');
    return summary.slice(0, MAX_SUMMARY_CHARS);
  }

  private async persist(
    conversationId: number,
    result: CompactionResult,
  ): Promise<boolean> {
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
      return true;
    } catch (err) {
      this.logger.warn(
        `conversation_compaction_persist_failed id=${conversationId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AIEngineService } from '../ai-engine.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import {
  CONTEXT_COMPACTION_PERCENT,
  type ContextBudgetReport,
  contextUsagePercent,
  estimateAgentInputTokens,
  renderTurnActionsLine,
} from './agent-context-budget';

/** Aplicación de IA que resume el hilo (fila de `ai_engine_applications`). */
export const VEX_SUMMARIZER_APP_KEY = 'vex_context_summarizer';
export const SUMMARY_TIMEOUT_MS = 10_000;
/**
 * Literal recent rows kept after compacting. Up to 20 (the chat window, so
 * compaction never shows less than before) while they fit in
 * `KEEP_WINDOW_SHARE` of the model window; never fewer than 10.
 */
export const MIN_KEEP_MESSAGES = 10;
export const MAX_KEEP_MESSAGES = 20;
export const KEEP_WINDOW_SHARE = 0.4;
/** Fewer older rows than this is not worth a summary pass (and its cost). */
export const MIN_COMPACT_BATCH = 4;
/** Hard cap of a stored summary, whichever path wrote it. */
export const MAX_SUMMARY_CHARS = 4000;
/** Share of the cap reserved for the rows this pass covers. */
export const NEW_SECTION_SHARE = 0.6;
const LINE_CAPS = [240, 160, 100, 60];
const PREVIOUS_LINE_CAP = 120;
/** First lines of the previous summary: what was said at the very beginning. */
const PREVIOUS_HEAD_LINES = 3;
const MAX_TRANSCRIPT_CHARS = 60_000;
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

interface BuiltSummary {
  summary: string;
  /** Index (in `older`) of the last row the summary covers. */
  coveredThrough: number;
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

function lineFor(message: CompactableMessage, cap: number): string | null {
  if (message.role === 'user') return `- Persona: ${clip(plain(message.content), cap)}`;
  if (message.role === 'assistant') {
    const actions = renderTurnActionsLine(message.tool_calls, message.metadata);
    const gist = message.content.trim() ? gistOf(message.content, cap) : '';
    const body = [gist, actions ? clip(actions, cap) : ''].filter(Boolean).join(' ');
    return body ? `- Vex: ${body}` : null;
  }
  return null;
}

/** Lines of a stored summary, without its header (re-summarizing input). */
function previousLines(previous: string): string[] {
  return previous
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== SUMMARY_HEADER);
}

/**
 * Re-summarizes the previous summary into `budget` chars: as-is when it fits,
 * then every line shortened, then the first lines (the beginning of the
 * conversation) plus the newest lines, with the middle marked as omitted.
 */
function compressPrevious(previous: string, budget: number): string[] {
  const lines = previousLines(previous);
  const size = (xs: string[]) => xs.reduce((n, x) => n + x.length + 1, 0);
  if (budget <= 0 || !lines.length) return [];
  if (size(lines) <= budget) return lines;
  const short = lines.map((line) => clip(line, PREVIOUS_LINE_CAP));
  if (size(short) <= budget) return short;
  const head = short.slice(0, PREVIOUS_HEAD_LINES);
  const rest = short.slice(PREVIOUS_HEAD_LINES);
  const tail: string[] = [];
  const marker = (n: number) => `- (… ${n} puntos intermedios omitidos)`;
  let used = size(head) + marker(rest.length).length + 1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (used + rest[i].length + 1 > budget) break;
    tail.unshift(rest[i]);
    used += rest[i].length + 1;
  }
  const omitted = rest.length - tail.length;
  const out = [...head, ...(omitted ? [marker(omitted)] : []), ...tail];
  // A single huge line (prose summary) still has to respect the cap.
  return size(out) <= budget ? out : [clip(out.join(' '), budget - 1)];
}

/**
 * Compacta hilos largos de Vex: resume lo viejo (modelo con respaldo
 * extractivo determinista) para que el turno nunca falle por desborde.
 * Decide con el mismo presupuesto que pinta el anillo «Contexto N %».
 * Nunca lanza; sin persistir no hay compactación (ni aviso).
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
      const percent = contextUsagePercent(budget);
      if (percent === null || percent < CONTEXT_COMPACTION_PERCENT) return null;

      const through = conversation.summary_through_message_id ?? 0;
      const previous = conversation.summary?.trim() || '';
      const live = conversation.messages.filter(
        (m) =>
          m.id > through &&
          (m.role === 'user' || m.role === 'assistant' || m.role === 'system'),
      );
      const keep = this.keepCount(live, budget!.context_window_tokens);
      const older = live.slice(0, live.length - keep);
      if (older.length < MIN_COMPACT_BATCH) return null;

      const built =
        (await this.summarize(previous, older, timeoutMs)) ??
        this.extractive(previous, older);
      if (!built) return null;

      const result: CompactionResult = {
        summary: built.summary,
        summary_through_message_id: older[built.coveredThrough].id,
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
  ): Promise<BuiltSummary | null> {
    // The transcript covers a PREFIX of `older` that fits; the pointer never
    // moves past a row the model did not read.
    const lines: string[] = [];
    let size = 0;
    let coveredThrough = -1;
    for (let i = 0; i < older.length; i++) {
      const m = older[i];
      const actions =
        m.role === 'assistant'
          ? renderTurnActionsLine(m.tool_calls, m.metadata)
          : null;
      const line = `${m.role}: ${m.content}${actions ? ` ${actions}` : ''}`;
      if (size + line.length + 1 > MAX_TRANSCRIPT_CHARS && lines.length) break;
      lines.push(line);
      size += line.length + 1;
      coveredThrough = i;
    }
    if (coveredThrough < 0) return null;

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
            transcript: lines.join('\n').slice(0, MAX_TRANSCRIPT_CHARS),
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
      return { summary: text, coveredThrough };
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
   * Covers the longest prefix of `older` that fits; `null` if none does.
   */
  private extractive(
    previous: string,
    older: CompactableMessage[],
  ): BuiltSummary | null {
    const available = MAX_SUMMARY_CHARS - SUMMARY_HEADER.length - 1;
    const newBudget = previous.trim()
      ? Math.floor(available * NEW_SECTION_SHARE)
      : available;
    const size = (xs: string[]) => xs.reduce((n, x) => n + x.length + 1, 0);

    let lines: Array<string | null> = [];
    for (const cap of LINE_CAPS) {
      lines = older.map((m) => lineFor(m, cap));
      if (size(lines.filter((l): l is string => !!l)) <= newBudget) break;
    }
    // Still too big at the smallest cap: cover only the prefix that fits.
    const fresh: string[] = [];
    let used = 0;
    let coveredThrough = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        if (used + line.length + 1 > newBudget) break;
        fresh.push(line);
        used += line.length + 1;
      }
      coveredThrough = i;
    }
    if (coveredThrough < 0 || !fresh.length) return null;

    const kept = compressPrevious(previous, available - size(fresh));
    const summary = [SUMMARY_HEADER, ...kept, ...fresh].join('\n');
    return { summary: summary.slice(0, MAX_SUMMARY_CHARS), coveredThrough };
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

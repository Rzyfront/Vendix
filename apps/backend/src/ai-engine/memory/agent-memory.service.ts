import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../common/errors';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';

/** F4 T31 (D7, N3): store memory of an agent, MEMORY.md style. */
export const MEMORY_AGENT_KEY = 'vex';
export const MEMORY_MAX_ENTRIES = 40;
export const MEMORY_MAX_CHARS = 2000;
export const MEMORY_MAX_CONTENT = 500;
export const MEMORY_KINDS = ['preference', 'fact'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryOrigin = 'agent' | 'manual';

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const SNAPSHOT_HEADER =
  'Memoria de la tienda (preferencias y datos que los usuarios pidieron recordar; aplícalos en cualquier conversación sin volver a preguntarlos):';

export interface MemoryActor {
  store_id: number;
  organization_id: number;
  user_id: number;
}

export interface MemoryItem {
  id: number;
  key: string;
  content: string;
  kind: string;
  origin: string;
  created_by: { id: number; name: string } | null;
  updated_by: { id: number; name: string } | null;
  source_conversation_id: number | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MemoryList {
  items: MemoryItem[];
  limits: {
    max_entries: number;
    max_chars: number;
    used_entries: number;
    used_chars: number;
  };
}

export interface RememberInput {
  key: string;
  content: string;
  kind?: MemoryKind;
  origin: MemoryOrigin;
  conversationId?: number | null;
}

interface MemoryRow {
  id: number;
  key: string;
  content: string;
  kind: string;
  origin: string;
  user_id: number | null;
  source_conversation_id: number | null;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Rows a conversation purge may delete: born from it and never edited by hand. */
export function unEditedMemoriesWhere(storeId: number, conversationId: number) {
  return {
    store_id: storeId,
    agent_key: MEMORY_AGENT_KEY,
    source_conversation_id: conversationId,
    origin: 'agent',
  };
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const SECRET_PATTERNS: RegExp[] = [
  // password / secret phrase followed by its value
  /\b(?:contrase[ñn]a|password|passwd|pwd|clave)\b[^.\n]{0,30}?(?:\bes\b|:|=)\s*\S+/i,
  // card security code
  /\b(?:cvv|cvc|cv2)\b\s*(?:es|:|=)?\s*\d{3,4}\b/i,
  // identity document numbers
  /\b(?:c[eé]dula|c\.?\s?c\.?|pasaporte|dni|documento de identidad|tarjeta de identidad)\b[^.\n]{0,20}?\d[\d.\s-]{5,}/i,
  // provider API keys and bearer tokens
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b(?:api[_ -]?key|apikey|token|secret|secreto)\b[^.\n]{0,20}?[:=]\s*\S{8,}/i,
  // long opaque token with letters and digits
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/,
];

/** True when the text looks like a password, card, identity document or API key. */
export function looksLikeSecret(text: string): boolean {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const runs: string[] = text.match(/\d(?:[ -]?\d){12,18}/g) ?? [];
  return runs.some((run) => luhn(run.replace(/\D/g, '')));
}

@Injectable()
export class AgentMemoryService {
  constructor(private readonly prisma: StorePrismaService) {}

  /** Actor of an HTTP request: the session's store, organization and user. */
  actorFromRequest(): MemoryActor {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id || !context.user_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return {
      store_id: context.store_id,
      organization_id: context.organization_id,
      user_id: context.user_id,
    };
  }

  /** Whole-store rows plus the actor's own rows (always store-wide today). */
  private visible(actor: MemoryActor) {
    return {
      store_id: actor.store_id,
      agent_key: MEMORY_AGENT_KEY,
      OR: [{ user_id: null }, { user_id: actor.user_id }],
    };
  }

  private storeWide(actor: MemoryActor) {
    return { store_id: actor.store_id, agent_key: MEMORY_AGENT_KEY };
  }

  async list(actor: MemoryActor): Promise<MemoryList> {
    const rows = (await this.prisma.ai_agent_memories.findMany({
      where: this.visible(actor),
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    })) as MemoryRow[];
    const names = await this.userNames(rows);
    return {
      items: rows.map((row) => this.toItem(row, names)),
      limits: {
        max_entries: MEMORY_MAX_ENTRIES,
        max_chars: MEMORY_MAX_CHARS,
        used_entries: rows.length,
        used_chars: rows.reduce((sum, row) => sum + row.content.length, 0),
      },
    };
  }

  /**
   * Upsert by key (findFirst + update/create: the unique indexes are partial).
   * A manual row is never downgraded to `agent` by a later agent write.
   */
  async remember(
    actor: MemoryActor,
    input: RememberInput,
  ): Promise<{ item: MemoryItem; replaced: boolean }> {
    const key = this.normalizeKey(input.key);
    const content = this.normalizeContent(input.content);
    this.assertNoSecret(key, content);
    const kind: MemoryKind = input.kind ?? 'preference';
    if (!MEMORY_KINDS.includes(kind)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'kind debe ser preference o fact.',
      );
    }

    const existing = (await this.prisma.ai_agent_memories.findFirst({
      where: { ...this.storeWide(actor), user_id: null, key },
    })) as MemoryRow | null;
    await this.assertCaps(actor, content, existing);

    const now = new Date();
    let row: MemoryRow;
    if (existing) {
      const origin: MemoryOrigin =
        existing.origin === 'manual' ? 'manual' : input.origin;
      row = (await this.prisma.ai_agent_memories.update({
        where: { id: existing.id },
        data: {
          content,
          kind,
          origin,
          source_conversation_id:
            origin === 'agent' ? (input.conversationId ?? null) : null,
          updated_by_user_id: actor.user_id,
          updated_at: now,
        },
      })) as MemoryRow;
    } else {
      row = (await this.prisma.ai_agent_memories.create({
        data: {
          store_id: actor.store_id,
          organization_id: actor.organization_id,
          agent_key: MEMORY_AGENT_KEY,
          user_id: null,
          key,
          content,
          kind,
          origin: input.origin,
          source_conversation_id:
            input.origin === 'agent' ? (input.conversationId ?? null) : null,
          created_by_user_id: actor.user_id,
          updated_by_user_id: actor.user_id,
        },
      })) as MemoryRow;
    }
    const names = await this.userNames([row]);
    return { item: this.toItem(row, names), replaced: !!existing };
  }

  /** Manual edit: the row becomes the user's (origin manual, no source thread). */
  async edit(
    actor: MemoryActor,
    id: number,
    contentInput: string,
  ): Promise<MemoryItem> {
    const current = await this.findVisible(actor, id);
    const content = this.normalizeContent(contentInput);
    this.assertNoSecret(current.key, content);
    await this.assertCaps(actor, content, current);
    const row = (await this.prisma.ai_agent_memories.update({
      where: { id: current.id },
      data: {
        content,
        origin: 'manual',
        source_conversation_id: null,
        updated_by_user_id: actor.user_id,
        updated_at: new Date(),
      },
    })) as MemoryRow;
    const names = await this.userNames([row]);
    return this.toItem(row, names);
  }

  async remove(actor: MemoryActor, id: number): Promise<{ deleted: number }> {
    const current = await this.findVisible(actor, id);
    const result = await this.prisma.ai_agent_memories.deleteMany({
      where: { id: current.id, ...this.storeWide(actor) },
    });
    return { deleted: result.count };
  }

  async removeAll(actor: MemoryActor): Promise<{ deleted: number }> {
    const result = await this.prisma.ai_agent_memories.deleteMany({
      where: this.visible(actor),
    });
    return { deleted: result.count };
  }

  /** Tool `forget`: deletes by key, returns how many rows went away. */
  async forget(actor: MemoryActor, keyInput: string): Promise<number> {
    const key = this.normalizeKey(keyInput);
    const result = await this.prisma.ai_agent_memories.deleteMany({
      where: { ...this.storeWide(actor), key, user_id: null },
    });
    return result.count;
  }

  /**
   * Purge hook: memories born from `conversationId` that nobody edited by hand.
   * Pass `tx` to run inside the purge transaction (the raw client is unscoped,
   * so the store id is always part of the filter).
   */
  async deleteUnEditedFromConversation(
    conversationId: number,
    options?: {
      storeId?: number;
      tx?: {
        ai_agent_memories: {
          deleteMany: (args: { where: object }) => Promise<{ count: number }>;
        };
      };
    },
  ): Promise<number> {
    const storeId = options?.storeId ?? RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const client = options?.tx ?? this.prisma;
    const result = await client.ai_agent_memories.deleteMany({
      where: unEditedMemoriesWhere(storeId, conversationId),
    });
    return result.count;
  }

  /**
   * "Memoria de la tienda" block of the Vex system prompt: every store memory,
   * capped at 40 entries / 2000 chars. Reading it marks the rows as used.
   */
  async buildSnapshotBlock(storeId?: number): Promise<string> {
    const store = storeId ?? RequestContextService.getStoreId();
    if (!store) return '';
    const rows = (await this.prisma.ai_agent_memories.findMany({
      where: { store_id: store, agent_key: MEMORY_AGENT_KEY },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: MEMORY_MAX_ENTRIES,
    })) as MemoryRow[];
    if (!rows.length) return '';

    const lines: string[] = [];
    const used: number[] = [];
    let chars = 0;
    for (const row of rows) {
      const line = `- ${row.key}: ${row.content}`;
      if (chars + line.length > MEMORY_MAX_CHARS) break;
      lines.push(line);
      used.push(row.id);
      chars += line.length;
    }
    if (!lines.length) return '';

    await this.prisma.ai_agent_memories.updateMany({
      where: { id: { in: used }, store_id: store },
      data: { last_used_at: new Date() },
    });
    return [SNAPSHOT_HEADER, ...lines].join('\n');
  }

  // ── internals ──────────────────────────────────────────────────────────

  private normalizeKey(input: string): string {
    const key = String(input ?? '')
      .trim()
      .toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La clave del recuerdo debe usar letras minúsculas, números, punto, guion o guion bajo (ej. learning.format).',
      );
    }
    return key;
  }

  private normalizeContent(input: string): string {
    const content = String(input ?? '').trim();
    if (!content) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El contenido del recuerdo no puede estar vacío.',
      );
    }
    if (content.length > MEMORY_MAX_CONTENT) {
      throw new VendixHttpException(ErrorCodes.AI_MEMORY_LIMIT_001);
    }
    return content;
  }

  private assertNoSecret(key: string, content: string): void {
    if (looksLikeSecret(content) || looksLikeSecret(key)) {
      throw new VendixHttpException(ErrorCodes.AI_MEMORY_FORBIDDEN_001);
    }
  }

  /** 40 entries / 2000 chars of the whole store, counting the new text. */
  private async assertCaps(
    actor: MemoryActor,
    content: string,
    replacing: MemoryRow | null,
  ): Promise<void> {
    const rows = (await this.prisma.ai_agent_memories.findMany({
      where: this.storeWide(actor),
      select: { id: true, content: true },
    })) as Array<Pick<MemoryRow, 'id' | 'content'>>;
    const others = rows.filter((row) => row.id !== replacing?.id);
    const entries = others.length + 1;
    const chars =
      others.reduce((sum, row) => sum + row.content.length, 0) + content.length;
    if (entries > MEMORY_MAX_ENTRIES || chars > MEMORY_MAX_CHARS) {
      throw new VendixHttpException(ErrorCodes.AI_MEMORY_LIMIT_001);
    }
  }

  private async findVisible(actor: MemoryActor, id: number): Promise<MemoryRow> {
    const row = (await this.prisma.ai_agent_memories.findFirst({
      where: { id, ...this.visible(actor) },
    })) as MemoryRow | null;
    if (!row) throw new VendixHttpException(ErrorCodes.AI_MEMORY_NOT_FOUND_001);
    return row;
  }

  private async userNames(
    rows: Array<Pick<MemoryRow, 'created_by_user_id' | 'updated_by_user_id'>>,
  ): Promise<Map<number, string>> {
    const ids = [
      ...new Set(
        rows
          .flatMap((row) => [row.created_by_user_id, row.updated_by_user_id])
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const names = new Map<number, string>();
    if (!ids.length) return names;
    const users = await this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, first_name: true, last_name: true },
    });
    for (const user of users) {
      names.set(
        user.id,
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
          `Usuario ${user.id}`,
      );
    }
    return names;
  }

  private toItem(row: MemoryRow, names: Map<number, string>): MemoryItem {
    const who = (id: number | null) =>
      id == null ? null : { id, name: names.get(id) ?? `Usuario ${id}` };
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      kind: row.kind,
      origin: row.origin,
      created_by: who(row.created_by_user_id),
      updated_by: who(row.updated_by_user_id),
      source_conversation_id: row.source_conversation_id,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

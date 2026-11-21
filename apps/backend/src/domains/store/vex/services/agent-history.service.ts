import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  AuditAction,
  AuditResource,
} from '../../../../common/audit/audit.service';
import { VexActivityFeedService } from './vex-activity-feed.service';
import { conversationAgentWhere } from './agent-conversation-filter';

export type HistoryAgentKey = 'vex' | 'vexi';
export type HistoryChangeKind =
  | 'switch'
  | 'agent_action'
  | 'conversation_purged'
  | 'memory_edit';

export interface HistoryActor {
  user_id: number;
  name: string;
}

export interface HistoryChangeEvent {
  id: string;
  kind: HistoryChangeKind;
  agent_key: HistoryAgentKey | null;
  actor: HistoryActor | null;
  summary: string;
  created_at: Date;
}

export interface HistoryConversationRow {
  id: number;
  agent_key: HistoryAgentKey;
  user: { id: number; name: string } | null;
  title: string | null;
  message_count: number;
  created_at: Date;
  updated_at: Date;
  is_own: boolean;
}

export interface HistoryPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface HistoryQuery {
  page?: number;
  limit?: number;
  agent?: string;
}

export const HISTORY_MAX_LIMIT = 50;
/**
 * Changes merge three sources in memory: each source reads up to
 * `HISTORY_MAX_PAGE * limit` rows (the last reachable page), whatever page is
 * asked, so the read stays bounded and `total` does not move while paging.
 */
export const HISTORY_MAX_PAGE = 20;
const DEFAULT_LIMIT = 20;
/** Settings audit rows scanned in memory (no JSON predicate on `new_values`). */
const SWITCH_SCAN_WINDOW = 300;
const AGENT_LABEL: Record<HistoryAgentKey, string> = {
  vex: 'Vex',
  vexi: 'Vexi',
};

/**
 * Read-only history for the store's agent settings (T18, N1/N8).
 *
 * Changes merge three sources — the owner's on/off switches (settings
 * `audit_logs`), what the agents applied (reused from `VexActivityFeedService`,
 * not re-implemented) and conversation purge receipts (metadata only: who,
 * when, which agent, counts — never content). Conversations lists every
 * conversation of the store, WITHOUT content. The store id always comes from
 * the request context.
 *
 * `audit_logs` is read through the unscoped client, so each query pins the
 * tenant by hand: settings rows carry the store id as `resource_id`.
 */
@Injectable()
export class AgentHistoryService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly feed: VexActivityFeedService,
  ) {}

  async listChanges(
    query: HistoryQuery,
  ): Promise<HistoryPage<HistoryChangeEvent>> {
    const storeId = RequestContextService.getStoreId();
    const { page, limit } = this.paging(query, HISTORY_MAX_PAGE);
    const agent = this.agentFilter(query.agent);
    if (!storeId) return { items: [], total: 0, page, limit };

    // The agent filter goes into each source BEFORE its cut: filtering the
    // merged rows afterwards hid one agent's events behind the other's.
    const reach = HISTORY_MAX_PAGE * limit;
    const [switches, actions, purges] = await Promise.all([
      this.switchEvents(storeId, agent),
      // Reused, not re-implemented: the feed owns the tool-trace parsing.
      this.feed.recentAgentActions(reach, agent),
      this.purgeEvents(storeId, reach, agent),
    ]);

    const actionEvents: HistoryChangeEvent[] = actions.map((entry) => ({
      id: entry.id,
      kind: 'agent_action',
      agent_key: entry.ref?.agent === 'vex' ? 'vex' : 'vexi',
      actor: null,
      summary: entry.description
        ? `${entry.title}: ${entry.description}`
        : entry.title,
      created_at: entry.created_at,
    }));

    const merged = [...switches, ...actionEvents, ...purges].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    );

    const items = merged.slice((page - 1) * limit, page * limit);
    const names = await this.userNames(
      items
        .map((event) => event.actor?.user_id)
        .filter((id): id is number => typeof id === 'number'),
    );
    for (const event of items) {
      if (event.actor) {
        event.actor = {
          user_id: event.actor.user_id,
          name: names.get(event.actor.user_id) ?? event.actor.name,
        };
      }
    }
    // Real count of the filtered sources (switches within the settings audit
    // window, actions within the feed's scan window, purges), capped at the
    // last reachable page: each source reads `reach` rows, so the count is
    // exact below the cap and the same on every page.
    return { items, total: Math.min(merged.length, reach), page, limit };
  }

  async listConversations(
    query: HistoryQuery,
  ): Promise<HistoryPage<HistoryConversationRow>> {
    const storeId = RequestContextService.getStoreId();
    const currentUserId = RequestContextService.getUserId();
    const { page, limit } = this.paging(query);
    const agent = this.agentFilter(query.agent);
    if (!storeId) return { items: [], total: 0, page, limit };

    const where: Prisma.ai_conversationsWhereInput = {
      store_id: storeId,
      status: { not: 'deleted' },
      ...(agent && conversationAgentWhere(agent)),
    };

    const [rows, total] = await Promise.all([
      this.prisma.ai_conversations.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        // No `messages`, `summary` or `metadata` body: listing only.
        select: {
          id: true,
          user_id: true,
          title: true,
          metadata: true,
          created_at: true,
          updated_at: true,
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.ai_conversations.count({ where }),
    ]);

    const names = await this.userNames(rows.map((row) => row.user_id));
    const items = rows.map((row) => {
      const key = (row.metadata as Record<string, unknown> | null)?.agent_key;
      return {
        id: row.id,
        agent_key: (key === 'vex' ? 'vex' : 'vexi') as HistoryAgentKey,
        user: names.has(row.user_id)
          ? { id: row.user_id, name: names.get(row.user_id)! }
          : null,
        title: row.title,
        message_count: row._count?.messages ?? 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_own: currentUserId !== undefined && row.user_id === currentUserId,
      };
    });
    return { items, total, page, limit };
  }

  // ── sources ────────────────────────────────────────────────────────────

  /** Who flipped «Usar Vex» / «Usar Vexi». Reads the settings audit rows. */
  private async switchEvents(
    storeId: number,
    agent?: HistoryAgentKey,
  ): Promise<HistoryChangeEvent[]> {
    const rows = await this.prisma.audit_logs.findMany({
      where: {
        resource: AuditResource.SETTINGS,
        action: AuditAction.UPDATE,
        resource_id: storeId,
      },
      orderBy: { created_at: 'desc' },
      take: SWITCH_SCAN_WINDOW,
      select: { id: true, user_id: true, new_values: true, created_at: true },
    });

    const events: HistoryChangeEvent[] = [];
    for (const row of rows) {
      const sections = (row.new_values ?? {}) as Record<
        string,
        { old?: { enabled?: unknown }; new?: { enabled?: unknown } }
      >;
      for (const key of agent ? [agent] : (['vex', 'vexi'] as const)) {
        const section = sections[key];
        if (!section) continue;
        const before = section.old?.enabled === true;
        const after = section.new?.enabled === true;
        if (before === after) continue;
        events.push({
          id: `switch-${row.id}-${key}`,
          kind: 'switch',
          agent_key: key,
          actor:
            typeof row.user_id === 'number'
              ? { user_id: row.user_id, name: '' }
              : null,
          summary: `${after ? 'Encendió' : 'Apagó'} ${AGENT_LABEL[key]}`,
          created_at: row.created_at ?? new Date(0),
        });
      }
    }
    return events;
  }

  /** Purge receipts: metadata only, `counts` is reduced to a message total. */
  private async purgeEvents(
    storeId: number,
    take: number,
    agent?: HistoryAgentKey,
  ): Promise<HistoryChangeEvent[]> {
    // Same attribution as the mapping below: anything that is not Vex is Vexi.
    const agentWhere =
      agent === 'vex'
        ? { agent_key: 'vex' }
        : agent === 'vexi'
          ? { agent_key: { not: 'vex' } }
          : {};
    const rows = await this.prisma.ai_conversation_purges.findMany({
      where: { store_id: storeId, ...agentWhere },
      orderBy: { created_at: 'desc' },
      take,
      select: {
        id: true,
        user_id: true,
        agent_key: true,
        counts: true,
        created_at: true,
      },
    });
    return rows.map((row) => {
      const key: HistoryAgentKey = row.agent_key === 'vex' ? 'vex' : 'vexi';
      const messages = (row.counts as Record<string, unknown> | null)
        ?.messages;
      return {
        id: `purge-${row.id}`,
        kind: 'conversation_purged' as const,
        agent_key: key,
        actor: { user_id: row.user_id, name: '' },
        summary:
          typeof messages === 'number'
            ? `Borró una conversación de ${AGENT_LABEL[key]} (${messages} mensajes)`
            : `Borró una conversación de ${AGENT_LABEL[key]}`,
        created_at: row.created_at,
      };
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private paging(
    query: HistoryQuery,
    maxPage = Number.MAX_SAFE_INTEGER,
  ): { page: number; limit: number } {
    const page = Math.min(
      Math.max(Math.floor(Number(query.page)) || 1, 1),
      maxPage,
    );
    const limit = Math.min(
      Math.max(Math.floor(Number(query.limit)) || DEFAULT_LIMIT, 1),
      HISTORY_MAX_LIMIT,
    );
    return { page, limit };
  }

  private agentFilter(agent?: string): HistoryAgentKey | undefined {
    return agent === 'vex' || agent === 'vexi' ? agent : undefined;
  }

  private async userNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: unique } },
      select: { id: true, first_name: true, last_name: true },
    });
    return new Map(
      users.map((user) => [
        user.id,
        `${user.first_name} ${user.last_name ?? ''}`.trim(),
      ]),
    );
  }
}

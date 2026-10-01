import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  isUiAuditEntry,
  redactUiAuditArgs,
} from '../../vexi/vexi-activity.service';

export type FeedCategory = 'sale' | 'inventory' | 'cash' | 'alert' | 'agent';

export interface ActivityFeedEntry {
  category: FeedCategory;
  title: string;
  description: string;
  created_at: Date;
  is_new: boolean;
  ref?: {
    conversation_id?: number;
    tool?: string;
    agent?: string;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Bounded recent window, same trade as `VexiActivityService.list`: the trace
 * lives inside `ai_messages.tool_calls`, so the feed scans recent rows in
 * memory instead of a JSON predicate no index could serve.
 */
const SCAN_WINDOW = 400;

/** Notification type prefix → feed category. Unmatched types are alerts. */
const TYPE_CATEGORY_PREFIXES: Array<{ prefixes: string[]; category: FeedCategory }> = [
  { prefixes: ['sale', 'order', 'payment', 'invoice', 'quotation'], category: 'sale' },
  { prefixes: ['stock', 'inventory', 'product'], category: 'inventory' },
  { prefixes: ['cash', 'register', 'payout', 'expense'], category: 'cash' },
];

/**
 * The "Bitácora empresarial": domain notifications plus applied agent actions,
 * normalized to one shape.
 *
 * Two sources, one timeline: `notifications` rows (sales, low stock, cash,
 * alerts) and the writes Vex/Vexi actually landed (rebuilt from the persisted
 * tool trace the same way `VexiActivityService` does, attributed by
 * `ai_conversations.metadata.agent_key`). Reads never fail the chat — an
 * empty feed beats a broken one — but unlike the notify-and-forget hub, this
 * read path has no fallback data to invent: it returns what the store has.
 *
 * `is_new` is the notification read flag. Agent actions carry no read state
 * (nothing marks them seen), so they always arrive with `is_new: false`
 * rather than a recency heuristic that would lie about what the person saw.
 */
@Injectable()
export class VexActivityFeedService {
  constructor(private readonly prisma: StorePrismaService) {}

  async list(limit = DEFAULT_LIMIT): Promise<ActivityFeedEntry[]> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return [];
    const capped = Math.min(Math.max(limit || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [notifications, agentActions] = await Promise.all([
      this.recentNotifications(storeId, capped),
      this.recentAgentActions(capped),
    ]);

    return [...notifications, ...agentActions]
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, capped);
  }

  // ── notifications ─────────────────────────────────────────────────────

  private async recentNotifications(
    storeId: number,
    limit: number,
  ): Promise<ActivityFeedEntry[]> {
    // Raw SQL with an explicit tenant predicate, mirroring
    // `NotificationsService.findAll` (Prisma 7 Json filters are avoided there
    // for the same reason: no predicate on `data` is needed here either).
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        type: string;
        title: string;
        body: string | null;
        is_read: boolean;
        created_at: Date;
      }>
    >(
      `SELECT type, title, body, is_read, created_at
       FROM notifications
       WHERE store_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      storeId,
      limit,
    );

    return (rows ?? []).map((row) => ({
      category: this.categoryFor(String(row.type ?? '')),
      title: row.title,
      description: row.body ?? '',
      created_at: new Date(row.created_at),
      is_new: !row.is_read,
    }));
  }

  private categoryFor(type: string): FeedCategory {
    const lower = type.toLowerCase();
    for (const { prefixes, category } of TYPE_CATEGORY_PREFIXES) {
      if (prefixes.some((p) => lower.startsWith(p))) return category;
    }
    return 'alert';
  }

  // ── applied agent actions ─────────────────────────────────────────────

  private async recentAgentActions(limit: number): Promise<ActivityFeedEntry[]> {
    // No tenant predicate written here on purpose: `ai_messages` is a
    // relationally-scoped model and the extension injects the conversation
    // filter — see `VexiActivityService.list`.
    const messages = await this.prisma.ai_messages.findMany({
      where: { tool_calls: { not: null } },
      orderBy: { id: 'desc' },
      take: SCAN_WINDOW,
      select: {
        conversation_id: true,
        created_at: true,
        role: true,
        tool_calls: true,
        conversation: { select: { metadata: true } },
      },
    });

    const entries: ActivityFeedEntry[] = [];
    for (const message of messages) {
      const metadata = (message as any).conversation?.metadata as
        | Record<string, any>
        | null
        | undefined;
      const agentKey =
        typeof metadata?.agent_key === 'string' ? metadata.agent_key : 'vexi';
      if (agentKey !== 'vex' && agentKey !== 'vexi') continue;

      const calls = Array.isArray(message.tool_calls)
        ? (message.tool_calls as Array<Record<string, any>>)
        : [];
      // `role: 'tool'` rows exist ONLY as `recordApplied` receipts: the write
      // they carry landed by construction, even when the tool's own output
      // carries no `applied: true` marker (typed domain tools describe the
      // change instead). Assistant rows still need the marker to tell an
      // applied `write_endpoint` result from a mere proposal.
      const appliedByConstruction = (message as any).role === 'tool';
      for (const call of calls) {
        if (isUiAuditEntry(call?.name)) continue;
        if (!appliedByConstruction && !this.wasApplied(call?.result)) continue;
        entries.push({
          category: 'agent',
          title:
            agentKey === 'vex'
              ? `Vex: ${this.describeOperation(call)}`
              : `Vexi: ${this.describeOperation(call)}`,
          description: this.summarizeArgs(call?.arguments),
          created_at: message.created_at,
          is_new: false,
          ref: {
            conversation_id: message.conversation_id,
            tool: String(call?.name ?? ''),
            agent: agentKey,
          },
        });
        if (entries.length >= limit) return entries;
      }
    }
    return entries;
  }

  /**
   * Whether the tool reported the change as landed. Same marker as
   * `VexiActivityService`: the tools' own `applied: true`, with a regex
   * fallback for results truncated at persist time.
   */
  private wasApplied(result: unknown): boolean {
    if (typeof result !== 'string') return false;
    try {
      const parsed = JSON.parse(result) as { applied?: unknown };
      return parsed?.applied === true;
    } catch {
      return /"applied"\s*:\s*true/.test(result);
    }
  }

  /** The operation in the words the arguments carry, never a raw route. */
  private describeOperation(call: Record<string, any>): string {
    const args = call?.arguments as Record<string, any> | undefined;
    if (args?.path && args?.method) {
      const domain = String(args.path)
        .split('/')
        .filter((segment) => segment && !/^\d+$/.test(segment))
        .slice(-1)[0];
      const verb =
        {
          POST: 'registró',
          PATCH: 'modificó',
          PUT: 'reemplazó',
          DELETE: 'archivó',
        }[String(args.method).toUpperCase()] ?? 'cambió';
      return `${verb} ${domain?.replace(/-/g, ' ') ?? 'un registro'}`;
    }
    return String(call?.name ?? 'operación').replace(/_/g, ' ');
  }

  private summarizeArgs(args: unknown): string {
    const redacted = redactUiAuditArgs(args as Record<string, unknown>);
    const summary = Object.entries(redacted)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    return summary.slice(0, 280);
  }
}

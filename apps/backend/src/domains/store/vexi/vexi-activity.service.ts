import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/** One screen's worth. Past this it is an audit export, not a review panel. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Messages scanned to build the feed.
 *
 * The trace lives inside `ai_messages.tool_calls`, so there is no way to filter for
 * "applied writes" in SQL without a JSON predicate that would not use an index.
 * Reading a bounded recent window and filtering in memory is the honest trade: the
 * feed is a review surface over recent activity, not a full history query.
 */
const SCAN_WINDOW = 400;

/**
 * Same budget the agent loop uses when persisting a tool result.
 *
 * Kept identical on purpose: `wasApplied` falls back to a regex when the JSON is
 * truncated, and that fallback was calibrated against this length.
 */
const APPLIED_RESULT_MAX_CHARS = 1000;

export interface ActivityEntry {
  at: Date;
  conversation_id: number;
  tool: string;
  /** What the person asked for, in the words the tool recorded. */
  operation: string;
  applied: boolean;
  /** The document that justified it, when one did. */
  document?: {
    attachment_id: string;
    original_name: string;
  };
  linked_entity_type?: string;
  linked_entity_id?: number;
}

/**
 * The review trail for everything Vexi changed.
 *
 * An agent with write access to a commerce's inventory, payroll and accounting is
 * only acceptable if the owner can go back and see what it did. This is that view,
 * and it is built from what actually happened rather than from what the agent said:
 * the `applied: true` marker comes from the tool's own return value, and the document
 * link comes from the row `linkTo()` stamped after the write landed.
 *
 * Reconstructed from the persisted trace instead of a dedicated audit table on
 * purpose. A second table would have to be written by the same code path that
 * performs the write, which means a failure there either loses the audit entry or
 * fails the write — and the trace is already persisted for the transcript.
 */
@Injectable()
export class VexiActivityService {
  private readonly logger = new Logger(VexiActivityService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Records a write the person approved, at the moment it lands.
   *
   * Needed because the approval is a SEPARATE request from the turn that proposed
   * it: the loop persists `write_endpoint`'s proposal (`requires_confirmation`), and
   * the apply arrives later on `POST confirmations/apply`. A trail rebuilt only from
   * the turn's `tool_calls` therefore shows every proposal and not one applied
   * change — which is the opposite of what an owner reviewing the agent needs.
   *
   * Written as an `ai_messages` row of role `tool` so `list()` keeps ONE source of
   * truth instead of unioning a second table. `conversation_id` is required by that
   * table, so a voice approval — which has no conversation — is logged and skipped
   * rather than silently attached to an unrelated thread.
   */
  async recordApplied(input: {
    conversationId?: number;
    tool: string;
    args: Record<string, unknown>;
    output: string;
  }): Promise<void> {
    if (!input.conversationId) {
      this.logger.warn(
        `Applied write "${input.tool}" not recorded: the approval carried no conversation_id.`,
      );
      return;
    }

    try {
      await this.prisma.ai_messages.create({
        data: {
          conversation_id: input.conversationId,
          role: 'tool',
          // The transcript renders `content`; an applied write has no prose, and a
          // duplicate of the tool payload here would show up twice in the thread.
          content: '',
          tool_calls: [
            {
              name: input.tool,
              arguments: input.args,
              // Truncated to the same budget the loop uses when it persists a
              // result, so `wasApplied`'s tolerance for truncation still holds.
              result: input.output.slice(0, APPLIED_RESULT_MAX_CHARS),
            },
          ],
        },
      });
    } catch (error: any) {
      // Never fails the apply. The change already landed in the business; refusing
      // the response now would tell the person their approved change did not happen.
      this.logger.error(
        `Could not record applied write "${input.tool}": ${error?.message}`,
      );
    }
  }

  async list(limit = DEFAULT_LIMIT): Promise<ActivityEntry[]> {
    // Checked, not used as a filter: without a store in context the scoped client
    // has nothing to scope by, and answering with an empty list beats answering
    // with somebody else's activity.
    if (!RequestContextService.getStoreId()) return [];

    const capped = Math.min(Math.max(limit || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // No tenant predicate written here on purpose. `ai_messages` is one of the
    // relationally-scoped models in `StorePrismaService`, which injects
    // `conversation: { store_id, organization_id }` into every `where` — adding a
    // second `conversation` key would collide with the injected one, and the safe
    // outcome of that collision is not guaranteed to be the narrower filter.
    const messages = await this.prisma.ai_messages.findMany({
      where: {
        tool_calls: { not: null },
      },
      orderBy: { id: 'desc' },
      take: SCAN_WINDOW,
      select: {
        conversation_id: true,
        created_at: true,
        tool_calls: true,
      },
    });

    const documents = await this.prisma.ai_attachments.findMany({
      where: { linked_entity_type: { not: null } },
      orderBy: { id: 'desc' },
      take: SCAN_WINDOW,
      select: {
        id: true,
        original_name: true,
        conversation_id: true,
        linked_entity_type: true,
        linked_entity_id: true,
        linked_at: true,
      },
    });

    const entries: ActivityEntry[] = [];

    for (const message of messages) {
      const calls = Array.isArray(message.tool_calls)
        ? (message.tool_calls as Array<Record<string, any>>)
        : [];

      for (const call of calls) {
        const applied = this.wasApplied(call?.result);
        // Reads are the overwhelming majority of the trace and they are not what
        // this view is for: an owner reviewing the agent wants the changes.
        if (!applied) continue;

        // Preferred: the handle the call itself carried. Exact, and it works for a
        // document uploaded before the conversation existed — which is the normal
        // case, because the panel stages the file while the thread is still new and
        // the attachment row therefore has no `conversation_id` to match on.
        const handle = this.attachmentIdOf(call);

        const document =
          (handle !== null
            ? documents.find((candidate) => candidate.id === handle)
            : undefined) ??
          documents.find(
            (candidate) =>
              candidate.conversation_id === message.conversation_id &&
              candidate.linked_at !== null &&
              Math.abs(
                candidate.linked_at.getTime() - message.created_at.getTime(),
              ) < 5 * 60 * 1000,
          );

        entries.push({
          at: message.created_at,
          conversation_id: message.conversation_id,
          tool: String(call?.name ?? 'desconocida'),
          operation: this.describeOperation(call),
          applied: true,
          ...(document
            ? {
                document: {
                  attachment_id: `att_${document.id}`,
                  original_name: document.original_name,
                },
                linked_entity_type: document.linked_entity_type ?? undefined,
                linked_entity_id: document.linked_entity_id ?? undefined,
              }
            : {}),
        });

        if (entries.length >= capped) return entries;
      }
    }

    return entries;
  }

  /**
   * Whether the tool reported the change as landed.
   *
   * Matches on the marker the tools themselves emit rather than assuming a
   * non-error result means success — a write that came back `applied: false` with a
   * validation message must not appear in the trail as a change to the business.
   */
  private wasApplied(result: unknown): boolean {
    if (typeof result !== 'string') return false;

    try {
      const parsed = JSON.parse(result) as { applied?: unknown };
      return parsed?.applied === true;
    } catch {
      // Truncated at 1.000 chars on persist, so a long result may not parse. The
      // marker sits at the head of the object, which survives truncation.
      return /"applied"\s*:\s*true/.test(result);
    }
  }

  /**
   * The attachment the call declared, as a numeric id.
   *
   * Accepts `att_4` and a bare `4` for the same reason `parseHandle` does: the model
   * writes the handle, and a dropped prefix must not cost the audit trail its link
   * between the document and the record it justified.
   */
  private attachmentIdOf(call: Record<string, any>): number | null {
    const raw = String(call?.arguments?.attachment_id ?? '').trim();
    if (!raw) return null;

    const digits = raw.startsWith('att_') ? raw.slice(4) : raw;
    const id = Number(digits);
    return Number.isInteger(id) && id > 0 ? id : null;
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

    return String(call?.name ?? 'operación');
  }
}

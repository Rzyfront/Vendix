import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { Observable, filter } from 'rxjs';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { REDIS_CLIENT } from '../../../../../common/redis/redis.module';
import { S3Service } from '../../../../../common/services/s3.service';
import { AuditService } from '../../../../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { MessagingService } from '../../../../../messaging/messaging.service';
import { CrmOutboundQueue } from '../../../../../messaging/queue/crm-outbound.queue';
import {
  CrmInboxEvent,
  CrmInboxEventsService,
} from '../../../../../messaging/events/crm-inbox-events.service';
import {
  CrmConversationsQueryDto,
  CrmMessagesQueryDto,
  SendCrmMessageDto,
} from './dto/crm-conversations.dto';

/** Seeing every conversation of the store comes with being able to assign them. */
export const CRM_INBOX_SEE_ALL_PERMISSION = 'store:crm_inbox:assign';
export const CRM_INBOX_READ_PERMISSION = 'store:crm_inbox:read';

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEND_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const PREVIEW_LENGTH = 120;

const PROVIDER_BY_CHANNEL: Record<string, string> = {
  whatsapp: 'meta_cloud',
  sms: 'sns_sms',
  email: 'ses_email',
};

const PERSON_SELECT = { id: true, first_name: true, last_name: true } as const;

const CONVERSATION_INCLUDE = {
  customer: { select: PERSON_SELECT },
  assigned_user: { select: PERSON_SELECT },
} as const;

type ConversationRow = Prisma.crm_conversationsGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

type MessageRow = Prisma.crm_messagesGetPayload<{
  include: { sent_by: { select: typeof PERSON_SELECT } };
}>;

interface InboxViewer {
  store_id: number;
  user_id: number;
  can_see_all: boolean;
}

/**
 * Store inbox (PLAN-CRM §4.3).
 *
 * Every query goes through `StorePrismaService`, which adds the store of the
 * request to the `where`, so a conversation of another store is simply not
 * found. On top of that, a user without `store:crm_inbox:assign` (seller,
 * cashier) only sees the conversations assigned to them (DECISIONES §6).
 * Both cases answer the same 404: the API never reveals that a hidden
 * conversation exists.
 *
 * Sending never talks to a provider: it stores the row as `queued` and hands
 * its id to the `crm-outbound` queue of the messaging layer.
 */
@Injectable()
export class CrmConversationsService {
  private readonly logger = new Logger(CrmConversationsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly messaging: MessagingService,
    private readonly outbound: CrmOutboundQueue,
    private readonly events: CrmInboxEventsService,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(query: CrmConversationsQueryDto) {
    const viewer = this.viewer();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.listWhere(viewer, query);

    const [total, rows] = await Promise.all([
      this.prisma.crm_conversations.count({ where }),
      this.prisma.crm_conversations.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [
          { last_message_at: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const previews = await Promise.all(
      rows.map((row) => this.lastMessage(row.id)),
    );
    const data = rows.map((row, index) => ({
      ...this.toConversation(row),
      last_message_preview: previews[index],
    }));
    return { data, total, page, limit };
  }

  async stats() {
    const viewer = this.viewer();
    const visible = this.visibility(viewer);
    const active = { ...visible, status: { not: 'closed' as const } };
    const [open, unassigned, mine, unread] = await Promise.all([
      this.prisma.crm_conversations.count({
        where: { ...visible, status: 'open' },
      }),
      viewer.can_see_all
        ? this.prisma.crm_conversations.count({
            where: { ...active, assigned_user_id: null },
          })
        : Promise.resolve(0),
      this.prisma.crm_conversations.count({
        where: { ...active, assigned_user_id: viewer.user_id },
      }),
      this.prisma.crm_conversations.count({
        where: { ...active, unread_count: { gt: 0 } },
      }),
    ]);
    return { open, unassigned, mine, unread };
  }

  async findOne(id: number) {
    const row = await this.findVisible(this.viewer(), id);
    return this.toConversation(row);
  }

  async messages(id: number, query: CrmMessagesQueryDto) {
    await this.findVisible(this.viewer(), id);
    const limit = query.limit ?? 30;
    const rows = await this.prisma.crm_messages.findMany({
      where: {
        conversation_id: id,
        ...(query.before_id ? { id: { lt: query.before_id } } : {}),
      },
      include: { sent_by: { select: PERSON_SELECT } },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const data = await Promise.all(page.map((row) => this.toMessage(row)));
    return {
      data,
      meta: {
        has_more: rows.length > limit,
        next_before_id: rows.length > limit ? page[page.length - 1].id : null,
      },
    };
  }

  async send(id: number, dto: SendCrmMessageDto) {
    const viewer = this.viewer();
    const conversation = await this.findVisible(viewer, id);
    const body = dto.body?.trim() || null;
    const provider = PROVIDER_BY_CHANNEL[conversation.channel];
    if ((!body && !dto.template) || !provider) {
      throw new VendixHttpException(ErrorCodes.CRM_INBOX_005);
    }
    if (
      conversation.channel === 'whatsapp' &&
      !dto.template &&
      !this.messaging.isWindowOpen(conversation.last_inbound_at)
    ) {
      throw new VendixHttpException(ErrorCodes.CRM_WINDOW_CLOSED);
    }

    const key = `crm:inbox:send:${viewer.store_id}:${id}:${dto.client_request_id}`;
    const duplicate = await this.claimSend(key);
    if (duplicate) return { ...duplicate, duplicate: true };

    let message: MessageRow | null = null;
    try {
      const now = new Date();
      const created = await this.prisma.crm_messages.create({
        data: {
          store_id: viewer.store_id,
          conversation_id: id,
          direction: 'outbound',
          channel: conversation.channel,
          status: 'queued',
          body,
          template_name: dto.template?.name ?? null,
          template_language: dto.template?.language ?? null,
          template_variables: dto.template
            ? (dto.template.variables ?? [])
            : undefined,
          provider,
          sent_by_user_id: viewer.user_id,
          created_at: now,
        },
        include: { sent_by: { select: PERSON_SELECT } },
      });
      message = created;
      // Answering a closed conversation reopens it.
      await this.prisma.crm_conversations.updateMany({
        where: { id },
        data: {
          last_message_at: now,
          ...(conversation.status === 'closed'
            ? { status: 'open', closed_at: null }
            : {}),
        },
      });
      await this.redis.set(
        key,
        String(created.id),
        'EX',
        SEND_IDEMPOTENCY_TTL_SECONDS,
      );
      await this.outbound.enqueue(created.id);
    } catch (error) {
      this.logger.error(
        `Could not queue crm message ${message?.id ?? '(not created)'} of conversation ${id}: ${(error as Error)?.message}`,
      );
      // A row that never reached the queue must not sit as `queued` forever.
      if (message) await this.markNotQueued(message.id);
      await this.releaseSend(key);
      if (error instanceof VendixHttpException) throw error;
      throw new VendixHttpException(ErrorCodes.CRM_INBOX_004);
    }

    const queued = message as MessageRow;
    await this.publishMessage(conversation, queued.id, 'queued');
    return this.toMessage(queued);
  }

  private async markNotQueued(messageId: number): Promise<void> {
    await this.prisma.crm_messages
      .updateMany({
        where: { id: messageId, status: 'queued' },
        data: {
          status: 'failed',
          error_code: 'ENQUEUE_FAILED',
          error_message: 'The outbound queue did not accept the message',
          failed_at: new Date(),
        },
      })
      .catch((error: Error) =>
        this.logger.error(
          `Could not mark crm message ${messageId} as failed: ${error.message}`,
        ),
      );
  }

  /** Internal note: stored in the thread, never sent to the customer. */
  async addNote(id: number, body: string) {
    const viewer = this.viewer();
    const conversation = await this.findVisible(viewer, id);
    const now = new Date();
    const note = await this.prisma.crm_messages.create({
      data: {
        store_id: viewer.store_id,
        conversation_id: id,
        direction: 'outbound',
        channel: 'internal_note',
        status: 'sent',
        body: body.trim(),
        provider: 'internal',
        sent_by_user_id: viewer.user_id,
        sent_at: now,
        created_at: now,
      },
      include: { sent_by: { select: PERSON_SELECT } },
    });
    await this.publishMessage(conversation, note.id, 'sent');
    return this.toMessage(note);
  }

  async markRead(id: number) {
    const conversation = await this.findVisible(this.viewer(), id);
    if (conversation.unread_count > 0) {
      await this.prisma.crm_conversations.updateMany({
        where: { id },
        data: { unread_count: 0 },
      });
      await this.publishConversation(conversation, conversation.status);
    }
    return { id, unread_count: 0 };
  }

  async close(id: number) {
    const conversation = await this.findVisible(this.viewer(), id);
    if (conversation.status === 'closed') return this.toConversation(conversation);
    return this.updateConversation(conversation, {
      status: 'closed',
      closed_at: new Date(),
      snoozed_until: null,
    });
  }

  async reopen(id: number) {
    const conversation = await this.findVisible(this.viewer(), id);
    if (conversation.status === 'open') return this.toConversation(conversation);
    return this.updateConversation(conversation, {
      status: 'open',
      closed_at: null,
      snoozed_until: null,
    });
  }

  async assign(id: number, assignedUserId: number | null) {
    const viewer = this.viewer();
    const conversation = await this.findVisible(viewer, id);
    if (assignedUserId !== null && !(await this.isActiveStaff(assignedUserId))) {
      throw new VendixHttpException(ErrorCodes.CRM_INBOX_002);
    }
    const previous = conversation.assigned_user_id;
    if (previous === assignedUserId) return this.toConversation(conversation);

    await this.prisma.crm_conversations.updateMany({
      where: { id },
      data: { assigned_user_id: assignedUserId },
    });
    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'UPDATE',
      resource: 'crm_conversations',
      resourceId: id,
      oldValues: { assigned_user_id: previous },
      newValues: { assigned_user_id: assignedUserId },
      metadata: { reason: 'crm_inbox_assign' },
    });
    const updated = await this.findVisible(viewer, id);
    await this.events.publish({
      type: 'crm.conversation',
      store_id: viewer.store_id,
      conversation_id: id,
      assigned_user_id: assignedUserId,
      previous_assigned_user_id: previous,
      status: updated.status,
    });
    return this.toConversation(updated);
  }

  /**
   * Live events of the caller's store, narrowed to what they may see. Must be
   * called inside the request context; the filter is fixed at subscribe time.
   */
  stream(): Observable<CrmInboxEvent> {
    const viewer = this.viewer();
    return this.events
      .stream(viewer.store_id)
      .pipe(filter((event) => this.canSeeEvent(viewer, event)));
  }

  canSeeEvent(viewer: InboxViewer, event: CrmInboxEvent): boolean {
    if (event.store_id !== viewer.store_id) return false;
    return (
      viewer.can_see_all ||
      event.assigned_user_id === viewer.user_id ||
      event.previous_assigned_user_id === viewer.user_id
    );
  }

  private viewer(): InboxViewer {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.user_id) {
      throw new VendixHttpException(ErrorCodes.CRM_INBOX_001);
    }
    return {
      store_id: context.store_id,
      user_id: context.user_id,
      can_see_all:
        !!context.is_super_admin ||
        !!context.is_owner ||
        !!context.permissions?.includes(CRM_INBOX_SEE_ALL_PERMISSION),
    };
  }

  private visibility(
    viewer: InboxViewer,
  ): Prisma.crm_conversationsWhereInput {
    return viewer.can_see_all ? {} : { assigned_user_id: viewer.user_id };
  }

  private listWhere(
    viewer: InboxViewer,
    query: CrmConversationsQueryDto,
  ): Prisma.crm_conversationsWhereInput {
    const and: Prisma.crm_conversationsWhereInput[] = [this.visibility(viewer)];
    if (query.status) and.push({ status: query.status });
    if (query.channel) and.push({ channel: query.channel });
    if (query.assigned === 'me') {
      and.push({ assigned_user_id: viewer.user_id });
    } else if (query.assigned === 'unassigned') {
      and.push({ assigned_user_id: null });
    } else if (query.assigned) {
      and.push({ assigned_user_id: Number(query.assigned) });
    }
    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { contact_address: { contains: q, mode: 'insensitive' } },
          { customer: { first_name: { contains: q, mode: 'insensitive' } } },
          { customer: { last_name: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    return { AND: and };
  }

  private async findVisible(
    viewer: InboxViewer,
    id: number,
  ): Promise<ConversationRow> {
    const row = await this.prisma.crm_conversations.findFirst({
      where: { id, store_id: viewer.store_id, ...this.visibility(viewer) },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.CRM_INBOX_001);
    return row;
  }

  private async updateConversation(
    conversation: ConversationRow,
    data: Prisma.crm_conversationsUpdateManyMutationInput,
  ) {
    await this.prisma.crm_conversations.updateMany({
      where: { id: conversation.id },
      data,
    });
    const updated = await this.findVisible(this.viewer(), conversation.id);
    await this.publishConversation(updated, updated.status);
    return this.toConversation(updated);
  }

  /**
   * Active member of this store whose role can open the inbox, so an assigned
   * conversation is never invisible to its assignee (and never a customer).
   */
  private async isActiveStaff(userId: number): Promise<boolean> {
    const row = await this.prisma.store_users.findFirst({
      where: {
        user_id: userId,
        user: {
          state: 'active',
          user_roles: {
            some: {
              roles: {
                role_permissions: {
                  some: {
                    permissions: {
                      name: CRM_INBOX_READ_PERMISSION,
                      status: 'active',
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * Reserves the `client_request_id`. Returns the message of an earlier
   * identical send, or null when this request owns the send.
   */
  private async claimSend(key: string) {
    let claimed: string | null;
    try {
      claimed = await this.redis.set(
        key,
        'pending',
        'EX',
        SEND_IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
    } catch (error) {
      this.logger.error(`Could not reserve ${key}: ${(error as Error)?.message}`);
      throw new VendixHttpException(ErrorCodes.CRM_INBOX_004);
    }
    if (claimed) return null;

    const existingId = Number(await this.redis.get(key));
    if (!Number.isInteger(existingId) || existingId <= 0) {
      throw new VendixHttpException(ErrorCodes.CRM_INBOX_003);
    }
    const existing = await this.prisma.crm_messages.findFirst({
      where: { id: existingId },
      include: { sent_by: { select: PERSON_SELECT } },
    });
    if (!existing) throw new VendixHttpException(ErrorCodes.CRM_INBOX_003);
    return this.toMessage(existing);
  }

  private async releaseSend(key: string): Promise<void> {
    await this.redis.del(key).catch(() => undefined);
  }

  private async lastMessage(conversationId: number) {
    const row = await this.prisma.crm_messages.findFirst({
      where: {
        conversation_id: conversationId,
        channel: { not: 'internal_note' },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: {
        body: true,
        template_name: true,
        media: true,
        direction: true,
        status: true,
        created_at: true,
      },
    });
    if (!row) return null;
    return {
      text: this.previewText(row),
      direction: row.direction,
      status: row.status,
      created_at: row.created_at,
    };
  }

  private previewText(row: {
    body: string | null;
    template_name: string | null;
    media: unknown;
  }): string {
    if (row.body) return row.body.slice(0, PREVIEW_LENGTH);
    if (row.template_name) return `[plantilla] ${row.template_name}`;
    const media = Array.isArray(row.media) ? row.media[0] : null;
    const type =
      media && typeof media === 'object' && 'type' in media
        ? String((media as { type: unknown }).type)
        : null;
    return type ? `[${type}]` : '';
  }

  private toConversation(row: ConversationRow) {
    const windowExpiresAt =
      row.channel === 'whatsapp' && row.last_inbound_at
        ? new Date(new Date(row.last_inbound_at).getTime() + WHATSAPP_WINDOW_MS)
        : null;
    return {
      id: row.id,
      channel: row.channel,
      contact_address: row.contact_address,
      status: row.status,
      customer: row.customer,
      assigned_user: row.assigned_user,
      social_channel_id: row.social_channel_id,
      unread_count: row.unread_count,
      last_message_at: row.last_message_at,
      last_inbound_at: row.last_inbound_at,
      snoozed_until: row.snoozed_until,
      closed_at: row.closed_at,
      created_at: row.created_at,
      window_open:
        row.channel === 'whatsapp' &&
        this.messaging.isWindowOpen(row.last_inbound_at),
      window_expires_at: windowExpiresAt,
    };
  }

  /** Media keeps the S3 key; the URL is signed on every read. */
  private async toMessage(row: MessageRow) {
    const media = Array.isArray(row.media) ? row.media : [];
    const signed = await Promise.all(
      media.map(async (item) => {
        const value = (item ?? {}) as Record<string, unknown>;
        const key = typeof value.s3_key === 'string' ? value.s3_key : null;
        return {
          type: value.type ?? null,
          mime: value.mime ?? null,
          filename: value.filename ?? null,
          url: key ? ((await this.s3.signUrl(key)) ?? null) : null,
          error: value.error ?? null,
        };
      }),
    );
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      direction: row.direction,
      channel: row.channel,
      status: row.status,
      body: row.body,
      template_name: row.template_name,
      template_language: row.template_language,
      media: signed,
      sent_by: row.sent_by,
      error_code: row.error_code,
      error_message: row.error_message,
      created_at: row.created_at,
      sent_at: row.sent_at,
      delivered_at: row.delivered_at,
      read_at: row.read_at,
      failed_at: row.failed_at,
    };
  }

  private publishMessage(
    conversation: ConversationRow,
    messageId: number,
    status: string,
  ): Promise<void> {
    return this.events.publish({
      type: 'crm.message',
      store_id: conversation.store_id,
      conversation_id: conversation.id,
      assigned_user_id: conversation.assigned_user_id,
      message_id: messageId,
      status,
      direction: 'outbound',
    });
  }

  private publishConversation(
    conversation: ConversationRow,
    status: string,
  ): Promise<void> {
    return this.events.publish({
      type: 'crm.conversation',
      store_id: conversation.store_id,
      conversation_id: conversation.id,
      assigned_user_id: conversation.assigned_user_id,
      status,
    });
  }
}

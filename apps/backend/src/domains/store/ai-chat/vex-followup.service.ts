import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import {
  Followup,
  FollowupConversationState,
} from '../../../ai-engine/tools/domains/followup.tools';
import { RemindersService } from '../reminders/reminders.service';
import { ReminderLinkType } from '../reminders/dto/reminders.dto';
import { SaveFollowupDto } from './dto/followup.dto';

const VEX_AGENT_KEY = 'vex';
/** Assistant messages scanned for the guards; a thread rarely gets this long. */
const FOLLOWUP_SCAN_LIMIT = 300;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function followupsOf(metadata: unknown): Followup[] {
  const list = asObject(metadata).followups;
  return Array.isArray(list)
    ? (list.filter(
        (item) => item && typeof item === 'object' && 'id' in item,
      ) as Followup[])
    : [];
}

/**
 * F1/T5 — follow-up suggestions of a Vex thread. The suggestion lives in
 * `ai_messages.metadata.followups`; «No sugerir en este chat» lives in
 * `ai_conversations.metadata.followups_muted`. Every read and write is bound
 * to the session's user on top of the store scope of `StorePrismaService`:
 * a foreign conversation answers 404, never 403. Saving goes through
 * `RemindersService.create` (source `vex`), the same path as the bitácora.
 */
@Injectable()
export class VexFollowupService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reminders: RemindersService,
  ) {}

  /** Guard state for `suggest_followup`; `null` outside a Vex thread of the user. */
  async getState(
    conversationId: number,
    userId: number,
  ): Promise<FollowupConversationState | null> {
    const conversation = await this.findVexConversation(conversationId, userId);
    if (!conversation) return null;
    const messages = await this.prisma.ai_messages.findMany({
      where: { conversation_id: conversationId, role: 'assistant' },
      select: { metadata: true },
      orderBy: { id: 'desc' },
      take: FOLLOWUP_SCAN_LIMIT,
    });
    return {
      muted: asObject(conversation.metadata).followups_muted === true,
      known: messages.flatMap((message) => followupsOf(message.metadata)),
    };
  }

  /** Guardar: creates the reminder (or dateless log entry) and marks the card. */
  async save(conversationId: number, followupId: string, dto: SaveFollowupDto) {
    const actor = this.reminders.actorFromRequest();
    const found = await this.locate(conversationId, actor.user_id, followupId);
    const current = found.followup;
    if (current.status === 'saved') return { followup: current, reminder: null };
    if (current.status === 'dismissed') {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_007);
    }

    const remindAt =
      dto.remind_at !== undefined ? dto.remind_at : (current.remind_at ?? null);
    const reminder = await this.reminders.create(
      actor,
      {
        title: dto.title ?? current.title,
        note: dto.note !== undefined ? dto.note : (current.note ?? null),
        remind_at: remindAt,
        link_type: (current.link_type as ReminderLinkType | null) ?? null,
        link_id: current.link_id ?? null,
        link_label: current.link_label ?? null,
      },
      'vex',
    );

    const followup: Followup = {
      ...current,
      kind: reminder.remind_at ? 'reminder' : 'log_entry',
      title: reminder.title,
      note: reminder.note ?? null,
      remind_at: reminder.remind_at
        ? new Date(reminder.remind_at).toISOString()
        : null,
      status: 'saved',
      reminder_id: reminder.id,
    };
    await this.write(found.message, followup);
    return { followup, reminder };
  }

  /** No: the card closes and its fingerprint is never suggested again. */
  async dismiss(conversationId: number, followupId: string) {
    const actor = this.reminders.actorFromRequest();
    const found = await this.locate(conversationId, actor.user_id, followupId);
    if (found.followup.status !== 'suggested') {
      return { followup: found.followup };
    }
    const followup: Followup = { ...found.followup, status: 'dismissed' };
    await this.write(found.message, followup);
    return { followup };
  }

  async setMuted(conversationId: number, muted: boolean) {
    const actor = this.reminders.actorFromRequest();
    const conversation = await this.findVexConversation(
      conversationId,
      actor.user_id,
    );
    if (!conversation) throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    await this.prisma.ai_conversations.update({
      where: { id: conversation.id },
      data: {
        metadata: {
          ...asObject(conversation.metadata),
          followups_muted: muted,
        } as Prisma.InputJsonValue,
      },
    });
    return { conversation_id: conversation.id, followups_muted: muted };
  }

  private async findVexConversation(conversationId: number, userId: number) {
    const context = RequestContextService.getContext();
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: {
        id: conversationId,
        user_id: userId,
        ...(context?.store_id ? { store_id: context.store_id } : {}),
      },
      select: { id: true, metadata: true },
    });
    if (!conversation) return null;
    return asObject(conversation.metadata).agent_key === VEX_AGENT_KEY
      ? conversation
      : null;
  }

  private async locate(
    conversationId: number,
    userId: number,
    followupId: string,
  ) {
    const conversation = await this.findVexConversation(conversationId, userId);
    if (!conversation) throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    const messages = await this.prisma.ai_messages.findMany({
      where: { conversation_id: conversationId, role: 'assistant' },
      select: { id: true, metadata: true },
      orderBy: { id: 'desc' },
      take: FOLLOWUP_SCAN_LIMIT,
    });
    for (const message of messages) {
      const followup = followupsOf(message.metadata).find(
        (item) => item.id === followupId,
      );
      if (followup) return { message, followup };
    }
    throw new VendixHttpException(ErrorCodes.AI_CHAT_006);
  }

  private async write(
    message: { id: number; metadata: unknown },
    followup: Followup,
  ): Promise<void> {
    const metadata = asObject(message.metadata);
    await this.prisma.ai_messages.update({
      where: { id: message.id },
      data: {
        metadata: {
          ...metadata,
          followups: followupsOf(metadata).map((item) =>
            item.id === followup.id ? followup : item,
          ),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

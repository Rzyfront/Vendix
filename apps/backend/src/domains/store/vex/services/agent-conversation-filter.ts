import { Prisma } from '@prisma/client';

export type ConversationAgentKey = 'vex' | 'vexi';

/**
 * The `ai_conversations` that belong to one agent, by `metadata.agent_key`.
 *
 * Same split as `AiChatService.listConversations`: legacy threads (NULL
 * `metadata`, created before anything wrote the key) belong to Vexi. A JSON
 * `NOT` never matches a NULL row (`NOT NULL` is NULL), so Vexi is an OR with
 * its own NULL branch, never "not Vex".
 */
export function conversationAgentWhere(
  agent: ConversationAgentKey,
): Prisma.ai_conversationsWhereInput {
  if (agent === 'vex') {
    return { metadata: { path: ['agent_key'], equals: 'vex' } };
  }
  return {
    OR: [
      { metadata: { path: ['agent_key'], equals: 'vexi' } },
      { metadata: { equals: Prisma.AnyNull } },
    ],
  };
}

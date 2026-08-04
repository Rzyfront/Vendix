import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { AIAgentService } from '../../../ai-engine/ai-agent.service';
import { RAGService } from '../../../ai-engine/embeddings/rag.service';
import { VexiContextService } from '../vexi/vexi-context.service';
import { VexiStreamIntentService } from '../vexi/vexi-stream-intent.service';
import { VexiUiChannelService } from '../vexi/vexi-ui-channel.service';
import { RequestContextService } from '@common/context/request-context.service';
import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  AIMessage,
  AIStreamChunk,
} from '../../../ai-engine/interfaces/ai-provider.interface';
import {
  CreateConversationDto,
  SendMessageDto,
  ConversationQueryDto,
  StreamIntentDto,
} from './dto';
import {
  ConversationWithMessages,
  PaginatedConversations,
} from './interfaces/ai-chat.interface';

/**
 * The stored trace is for the human reading the transcript later, not for the
 * model — it never re-enters the context window. Enough to see what a tool
 * answered, not enough to bloat the conversation row.
 */
const PERSISTED_TOOL_RESULT_CHARS = 1000;

@Injectable()
export class AIChatService {
  private readonly logger = new Logger(AIChatService.name);
  private readonly MAX_CONTEXT_MESSAGES = 20;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly aiLogging: AILoggingService,
    private readonly aiAgent: AIAgentService,
    private readonly ragService: RAGService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vexiContext: VexiContextService,
    private readonly streamIntents: VexiStreamIntentService,
    private readonly uiChannel: VexiUiChannelService,
  ) {}

  async createConversation(dto: CreateConversationDto) {
    const context = RequestContextService.getContext();

    // `StorePrismaService` injects `store_id` on create, but not
    // `organization_id` / `user_id` — and both are required columns with no
    // default, so they have to be supplied here or Prisma rejects the insert.
    // `user_id` is also the ownership filter in `getConversation`, so a
    // placeholder value would create a row nobody can ever read back.
    if (!context?.organization_id || !context?.user_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const conversation = await this.prisma.ai_conversations.create({
      data: {
        organization_id: context.organization_id,
        user_id: context.user_id,
        title: dto.title || null,
        app_key: dto.app_key || null,
        status: 'active',
      },
    });

    this.eventEmitter.emit('ai.conversation.created', {
      conversation_id: conversation.id,
      store_id: context?.store_id,
      user_id: context?.user_id,
    });

    return conversation;
  }

  async getConversation(id: number): Promise<ConversationWithMessages> {
    const context = RequestContextService.getContext();

    const conversation = await this.prisma.ai_conversations.findFirst({
      where: {
        id,
        user_id: context?.user_id,
      },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    return conversation as ConversationWithMessages;
  }

  async listConversations(
    query: ConversationQueryDto,
  ): Promise<PaginatedConversations> {
    const context = RequestContextService.getContext();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      user_id: context?.user_id,
    };

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { not: 'deleted' };
    }

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_conversations.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip,
        take: limit,
        include: {
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.ai_conversations.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async sendMessage(conversationId: number, dto: SendMessageDto) {
    const conversation = await this.getConversation(conversationId);

    if (conversation.status === 'archived') {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_002);
    }

    // Save user message
    await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'user',
        content: dto.content,
      },
    });

    // Build context window
    const contextMessages = this.buildContextWindow(conversation, dto.content);

    // Call AI Engine
    const appKey = conversation.app_key || 'chat_assistant';

    // Check if agent mode is enabled for this app
    const app = await this.aiEngine.getApplication(appKey).catch(() => null);
    const agentEnabled =
      app?.metadata && (app.metadata as any).agent_enabled === true;

    let responseContent = '';
    let tokensUsed = 0;

    if (agentEnabled) {
      // Use Agent Loop with tools.
      //
      // `system_prompt` is deliberately NOT forwarded: with `app_key` set the
      // engine reads it from the database and interpolates it with the store
      // snapshot. Passing the raw string here would send an uninterpolated
      // duplicate and every `{{placeholder}}` would reach the model verbatim.
      const agentResult = await this.aiAgent.runAgent({
        goal: dto.content,
        app_key: appKey,
        messages: this.buildContextWindow(conversation),
        variables: await this.vexiContext.buildSnapshot(),
      });
      responseContent = agentResult.content;
      tokensUsed = agentResult.total_tokens;
    } else {
      // Check if RAG is enabled
      const ragEnabled =
        app?.metadata && (app.metadata as any).rag_enabled === true;

      if (ragEnabled) {
        const ragResponse = await this.ragService.queryWithContext({
          query: dto.content,
          system_prompt: app?.system_prompt || undefined,
          app_key: appKey,
        });
        responseContent = ragResponse.content || '';
        tokensUsed = ragResponse.usage
          ? ragResponse.usage.promptTokens + ragResponse.usage.completionTokens
          : 0;
      } else {
        // Direct AI call
        const response = await this.aiEngine.run(
          appKey,
          undefined,
          contextMessages,
        );
        responseContent = response.content || '';
        tokensUsed = response.usage
          ? response.usage.promptTokens + response.usage.completionTokens
          : 0;
      }
    }

    // Save assistant response
    const assistantMessage = await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'assistant',
        content: responseContent,
        tokens_used: tokensUsed,
        cost_usd: 0,
      },
    });

    // Update conversation timestamp
    await this.prisma.ai_conversations.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    });

    // Auto-generate title if first message
    if (conversation.messages.length === 0 && !conversation.title) {
      const autoTitle = dto.content.substring(0, 80);
      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { title: autoTitle },
      });
    }

    this.eventEmitter.emit('ai.message.sent', {
      conversation_id: conversationId,
      store_id: conversation.store_id,
      user_id: conversation.user_id,
    });

    return {
      user_message: { role: 'user', content: dto.content },
      assistant_message: {
        id: assistantMessage.id,
        role: 'assistant',
        content: responseContent,
        tokens_used: assistantMessage.tokens_used,
      },
    };
  }

  /**
   * Stashes the turn (message + UI context) and returns the id the browser
   * puts in the EventSource URL. Validates the conversation up front so a bad
   * id fails here, on a normal HTTP call with a normal error body, instead of
   * inside an SSE stream the client has to parse.
   */
  async createStreamIntent(
    conversationId: number,
    dto: StreamIntentDto,
  ): Promise<string> {
    const conversation = await this.getConversation(conversationId);

    if (conversation.status === 'archived') {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_002);
    }

    return this.streamIntents.create({
      conversation_id: conversationId,
      content: dto.content,
      ui_context: dto.ui_context,
      attachment_ids: dto.attachment_ids,
      user_id: RequestContextService.getContext()?.user_id,
    });
  }

  /**
   * Requires an active request context. The SSE controller re-enters it with
   * `RequestContextService.run()` before subscribing, because Nest's `@Sse()`
   * Observable body runs after the handler returned and the interceptor's
   * AsyncLocalStorage scope has already been torn down.
   */
  async *sendMessageStream(
    conversationId: number,
    streamId: string,
  ): AsyncGenerator<AIStreamChunk> {
    const userId = RequestContextService.getContext()?.user_id;
    const intent = await this.streamIntents.consume(streamId, userId);

    if (!intent || intent.conversation_id !== conversationId) {
      yield {
        type: 'error',
        error:
          'La sesión de chat expiró o ya se consumió. Vuelve a enviar el mensaje.',
      };
      return;
    }

    const conversation = await this.getConversation(conversationId);

    if (conversation.status === 'archived') {
      yield { type: 'error', error: 'Conversation is archived' };
      return;
    }

    // Save user message
    await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'user',
        content: intent.content,
      },
    });

    // Claims this stream id as the only channel allowed to answer this turn's UI
    // commands. Without it a leaked `stream_id` would let any authenticated user
    // feed fabricated screen results into somebody else's agent loop, and the
    // model treats those results as ground truth.
    await this.uiChannel.registerTurn(streamId, userId);

    const appKey = conversation.app_key || 'chat_assistant';

    const app = await this.aiEngine.getApplication(appKey).catch(() => null);
    const agentEnabled =
      app?.metadata && (app.metadata as any).agent_enabled === true;

    let fullContent = '';
    let totalTokens = 0;
    let toolsUsed: Array<{ name: string; args: any; result: string }> = [];

    if (agentEnabled) {
      // The stream used to call `runStream()` with no tools regardless of
      // `agent_enabled`, so simply opening the SSE connection turned the agent
      // off — the same question answered with data over POST and with a shrug
      // over SSE. It now runs the identical loop, narrating each tool call.
      const agentStream = this.aiAgent.runAgentStream({
        goal: intent.content,
        app_key: appKey,
        messages: this.buildContextWindow(conversation),
        variables: await this.vexiContext.buildSnapshot({
          uiContext: intent.ui_context,
          attachmentIds: intent.attachment_ids,
        }),
        // What lets the loop wait for the browser instead of assuming its UI
        // commands worked. Only the chat surface passes it, because it is the only
        // one with an open SSE channel to a page that can answer.
        stream_id: streamId,
      });

      let step = await agentStream.next();
      // `done` is held back instead of forwarded in place. The agent's last
      // act is the loop's `done`, but the pending-confirmation frame is only
      // known once the generator returns — and both the SSE controller and the
      // browser close the connection the moment `done` arrives. Emitted in
      // order, `done` would take the confirmation token out with it and the
      // approval card would never render.
      let doneChunk: AIStreamChunk | null = null;
      while (!step.done) {
        const chunk = step.value;
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
        }
        if (chunk.type === 'done') {
          if (chunk.usage) {
            totalTokens = chunk.usage.totalTokens;
          }
          doneChunk = chunk;
          step = await agentStream.next();
          continue;
        }
        yield chunk;
        step = await agentStream.next();
      }

      const result = step.value;
      // The generator's return value carries what the yields could not: the
      // full tool trace and, when the agent proposed a write, the token that
      // has to survive to the approval round trip.
      toolsUsed = result.tools_used;
      if (!fullContent) {
        // A turn can end without a single text chunk — the model spends its
        // last iteration on a tool that fails and then says nothing. The user
        // is left staring at an empty bubble with no idea whether Vexi is
        // still thinking. Whatever the agent returned goes out as text, and if
        // even that is empty the silence is named rather than shipped.
        fullContent =
          result.content?.trim() ||
          'No logré completar eso. Vuelve a pedírmelo con otras palabras, o dime el nombre exacto del registro sobre el que quieres que trabaje.';
        yield { type: 'text', content: fullContent };
      }
      if (result.pending_confirmation) {
        yield {
          type: 'tool_result',
          tool: {
            id: result.pending_confirmation.confirmation_token,
            name: result.pending_confirmation.tool,
            summary: JSON.stringify({
              requires_confirmation: true,
              confirmation_token:
                result.pending_confirmation.confirmation_token,
              arguments: result.pending_confirmation.arguments,
              preview: result.pending_confirmation.preview,
            }),
          },
        };
      }

      if (doneChunk) {
        yield doneChunk;
      }
    } else {
      const contextMessages = this.buildContextWindow(
        conversation,
        intent.content,
      );

      for await (const chunk of this.aiEngine.runStream(
        appKey,
        undefined,
        contextMessages,
      )) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
        }
        if (chunk.type === 'done' && chunk.usage) {
          totalTokens = chunk.usage.totalTokens;
        }
        yield chunk;
      }
    }

    // Save assistant response after stream completes
    if (fullContent) {
      await this.prisma.ai_messages.create({
        data: {
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          tokens_used: totalTokens,
          // The agent already computed this and it was being thrown away, so
          // a reopened conversation lost every trace of what Vexi actually
          // did — the transcript said "ajusté el stock" with nothing behind it.
          tool_calls: toolsUsed.length
            ? (toolsUsed.map((tool) => ({
                name: tool.name,
                arguments: tool.args,
                result: tool.result.slice(0, PERSISTED_TOOL_RESULT_CHARS),
              })) as Prisma.InputJsonValue)
            : undefined,
        },
      });

      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { updated_at: new Date() },
      });
    }

    // Auto-generate title if first message
    if (conversation.messages.length === 0 && !conversation.title) {
      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { title: intent.content.substring(0, 80) },
      });
    }

    this.eventEmitter.emit('ai.message.sent', {
      conversation_id: conversationId,
      store_id: conversation.store_id,
      user_id: conversation.user_id,
    });

    // Closes the UI channel for this turn so a late `POST ui-result` cannot land
    // on the next one. Not in a `finally`: an early `return` above leaves the
    // claim to expire on its own TTL, which is the safe direction — a stale claim
    // rejects results, it never accepts a wrong one.
    await this.uiChannel.releaseTurn(streamId);
  }

  async archiveConversation(id: number) {
    const context = RequestContextService.getContext();
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: { id, user_id: context?.user_id },
    });

    if (!conversation) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    return this.prisma.ai_conversations.update({
      where: { id },
      data: { status: 'archived', updated_at: new Date() },
    });
  }

  async updateTitle(id: number, title: string) {
    const context = RequestContextService.getContext();
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: { id, user_id: context?.user_id },
    });

    if (!conversation) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    return this.prisma.ai_conversations.update({
      where: { id },
      data: { title, updated_at: new Date() },
    });
  }

  /**
   * Last N turns of the conversation, oldest first.
   *
   * `newMessage` is optional because the two consumers need different shapes:
   * a plain completion wants history *plus* the new turn as one array, while
   * the agent loop appends the goal itself and would duplicate it. Omitting
   * the argument yields history alone.
   */
  private buildContextWindow(
    conversation: ConversationWithMessages,
    newMessage?: string,
  ): AIMessage[] {
    const messages: AIMessage[] = [];

    // Add recent messages from history (last N)
    const recentMessages = conversation.messages.slice(
      -this.MAX_CONTEXT_MESSAGES,
    );

    for (const msg of recentMessages) {
      if (
        msg.role === 'system' ||
        msg.role === 'user' ||
        msg.role === 'assistant'
      ) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    if (newMessage !== undefined) {
      messages.push({ role: 'user', content: newMessage });
    }

    return messages;
  }
}

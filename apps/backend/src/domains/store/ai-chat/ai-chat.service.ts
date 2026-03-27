import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { AIAgentService } from '../../../ai-engine/ai-agent.service';
import { RAGService } from '../../../ai-engine/embeddings/rag.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  AIMessage,
  AIStreamChunk,
} from '../../../ai-engine/interfaces/ai-provider.interface';
import { CreateConversationDto, SendMessageDto, ConversationQueryDto } from './dto';
import {
  ConversationWithMessages,
  PaginatedConversations,
} from './interfaces/ai-chat.interface';

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
  ) {}

  async createConversation(dto: CreateConversationDto) {
    const context = RequestContextService.getContext();

    const conversation = await this.prisma.ai_conversations.create({
      data: {
        user_id: context?.user_id ?? 0,
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
    const agentEnabled = app?.metadata && (app.metadata as any).agent_enabled === true;

    let responseContent = '';
    let tokensUsed = 0;

    if (agentEnabled) {
      // Use Agent Loop with tools
      const agentResult = await this.aiAgent.runAgent({
        goal: dto.content,
        system_prompt: app?.system_prompt || undefined,
        app_key: appKey,
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

  async *sendMessageStream(
    conversationId: number,
    dto: SendMessageDto,
  ): AsyncGenerator<AIStreamChunk> {
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
        content: dto.content,
      },
    });

    const contextMessages = this.buildContextWindow(conversation, dto.content);
    const appKey = conversation.app_key || 'chat_assistant';

    let fullContent = '';
    let totalTokens = 0;

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

    // Save assistant response after stream completes
    if (fullContent) {
      await this.prisma.ai_messages.create({
        data: {
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          tokens_used: totalTokens,
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
        data: { title: dto.content.substring(0, 80) },
      });
    }

    this.eventEmitter.emit('ai.message.sent', {
      conversation_id: conversationId,
      store_id: conversation.store_id,
      user_id: conversation.user_id,
    });
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

  private buildContextWindow(
    conversation: ConversationWithMessages,
    newMessage: string,
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
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Add the new user message
    messages.push({ role: 'user', content: newMessage });

    return messages;
  }
}

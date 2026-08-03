import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Sse,
  MessageEvent,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AIChatService } from './ai-chat.service';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../subscriptions/guards/ai-access.guard';
import {
  CreateConversationDto,
  SendMessageDto,
  ConversationQueryDto,
  StreamIntentDto,
} from './dto';

@Controller('store/ai-chat')
export class AIChatController {
  constructor(
    private readonly chatService: AIChatService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('conversations')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('conversations')
  async createConversation(@Body() dto: CreateConversationDto) {
    const conversation = await this.chatService.createConversation(dto);
    return this.responseService.success(conversation, 'Conversation created');
  }

  @Get('conversations')
  async listConversations(@Query() query: ConversationQueryDto) {
    const result = await this.chatService.listConversations(query);
    return this.responseService.success(
      result.data,
      'Conversations retrieved',
      result.meta,
    );
  }

  @Get('conversations/:id')
  async getConversation(@Param('id', ParseIntPipe) id: number) {
    const conversation = await this.chatService.getConversation(id);
    return this.responseService.success(conversation, 'Conversation retrieved');
  }

  @Post('conversations/:id/messages')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('streaming_chat')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ) {
    const result = await this.chatService.sendMessage(id, dto);
    return this.responseService.success(result, 'Message sent');
  }

  /**
   * Handshake that precedes the SSE connection.
   *
   * `EventSource` cannot send a body, and the previous design worked around
   * that with `?content=`, which put every question the user ever typed into
   * the access logs beside the JWT. The message travels here in a POST body
   * and the stream call carries only a short-lived opaque id.
   */
  @Post('conversations/:id/stream-intent')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('streaming_chat')
  async createStreamIntent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StreamIntentDto,
  ) {
    const streamId = await this.chatService.createStreamIntent(id, dto);
    return this.responseService.success({ stream_id: streamId }, 'Stream ready');
  }

  @Sse('conversations/:id/stream')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('streaming_chat')
  streamMessage(
    @Param('id') id: string,
    @Query('stream_id') streamId: string,
  ): Observable<MessageEvent> {
    const conversationId = parseInt(id, 10);

    // Captured HERE, synchronously, while the request's AsyncLocalStorage
    // context is still alive. Nest subscribes to this Observable after the
    // handler returns and the interceptor's ALS scope has been torn down, so
    // everything inside the deferred body — tenant scoping in
    // `StorePrismaService`, the business snapshot, every tool the agent runs —
    // would otherwise fail with "no request context". Re-entering the captured
    // context with `run()` is what makes the whole agent turn tenant-aware.
    const requestContext = RequestContextService.getContext();

    return new Observable<MessageEvent>((subscriber) => {
      const stream = async () => {
        try {
          for await (const chunk of this.chatService.sendMessageStream(
            conversationId,
            streamId,
          )) {
            subscriber.next({
              data: JSON.stringify(chunk),
              type: 'ai-chunk',
            } as MessageEvent);

            if (chunk.type === 'done' || chunk.type === 'error') {
              // Complete the subscriber so the browser closes promptly, but do
              // NOT `return`: leaving the `for await` early calls
              // `generator.return()`, which abandons the generator at its last
              // `yield` and skips everything after the loop — including the
              // writes that persist the assistant reply and its tool trace.
              // `done` is the final chunk, so draining costs one more tick.
              subscriber.complete();
            }
          }
          subscriber.complete();
        } catch (error: any) {
          subscriber.next({
            data: JSON.stringify({ type: 'error', error: error.message }),
            type: 'ai-chunk',
          } as MessageEvent);
          subscriber.complete();
        }
      };

      if (requestContext) {
        RequestContextService.run(requestContext, stream);
      } else {
        void stream();
      }
    });
  }

  @Patch('conversations/:id/archive')
  async archiveConversation(@Param('id', ParseIntPipe) id: number) {
    const conversation = await this.chatService.archiveConversation(id);
    return this.responseService.success(conversation, 'Conversation archived');
  }

  @Patch('conversations/:id/title')
  async updateTitle(
    @Param('id', ParseIntPipe) id: number,
    @Body('title') title: string,
  ) {
    const conversation = await this.chatService.updateTitle(id, title);
    return this.responseService.success(conversation, 'Title updated');
  }
}

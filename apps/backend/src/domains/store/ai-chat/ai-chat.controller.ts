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
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AIChatService } from './ai-chat.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreateConversationDto, SendMessageDto, ConversationQueryDto } from './dto';

@Controller('store/ai-chat')
export class AIChatController {
  constructor(
    private readonly chatService: AIChatService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('conversations')
  async createConversation(@Body() dto: CreateConversationDto) {
    const conversation = await this.chatService.createConversation(dto);
    return this.responseService.success(conversation, 'Conversation created');
  }

  @Get('conversations')
  async listConversations(@Query() query: ConversationQueryDto) {
    const result = await this.chatService.listConversations(query);
    return this.responseService.success(result.data, 'Conversations retrieved', result.meta);
  }

  @Get('conversations/:id')
  async getConversation(@Param('id', ParseIntPipe) id: number) {
    const conversation = await this.chatService.getConversation(id);
    return this.responseService.success(conversation, 'Conversation retrieved');
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ) {
    const result = await this.chatService.sendMessage(id, dto);
    return this.responseService.success(result, 'Message sent');
  }

  @Sse('conversations/:id/stream')
  streamMessage(
    @Param('id') id: string,
    @Query('content') content: string,
  ): Observable<MessageEvent> {
    const conversationId = parseInt(id, 10);

    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          const dto: SendMessageDto = { content, stream: true };

          for await (const chunk of this.chatService.sendMessageStream(
            conversationId,
            dto,
          )) {
            subscriber.next({
              data: JSON.stringify(chunk),
              type: 'ai-chunk',
            } as MessageEvent);

            if (chunk.type === 'done' || chunk.type === 'error') {
              subscriber.complete();
              return;
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
      })();
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

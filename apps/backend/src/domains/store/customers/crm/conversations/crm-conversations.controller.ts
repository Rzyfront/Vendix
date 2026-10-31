import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CrmConversationsService } from './crm-conversations.service';
import {
  AssignCrmConversationDto,
  CreateCrmNoteDto,
  CrmConversationsQueryDto,
  CrmMessagesQueryDto,
  SendCrmMessageDto,
} from './dto/crm-conversations.dto';

/**
 * Store inbox (PLAN-CRM §4.3).
 *
 *   GET   /store/customers/crm/conversations              list + filters
 *   GET   /store/customers/crm/conversations/stats        counters
 *   GET   /store/customers/crm/conversations/stream       SSE
 *   GET   /store/customers/crm/conversations/:id          detail + 24 h window
 *   GET   /store/customers/crm/conversations/:id/messages cursor pagination
 *   POST  /store/customers/crm/conversations/:id/messages text or template (202)
 *   POST  /store/customers/crm/conversations/:id/notes    internal note
 *   POST  /store/customers/crm/conversations/:id/read
 *   POST  /store/customers/crm/conversations/:id/close
 *   POST  /store/customers/crm/conversations/:id/reopen
 *   PATCH /store/customers/crm/conversations/:id/assign
 *
 * Without `store:crm_inbox:assign` a user only sees what is assigned to them;
 * the service applies that rule, the guard only checks the permission.
 */
@Controller('store/customers/crm/conversations')
@UseGuards(PermissionsGuard)
export class CrmConversationsController {
  constructor(
    private readonly service: CrmConversationsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:crm_inbox:read')
  async list(@Query() query: CrmConversationsQueryDto) {
    const { data, total, page, limit } = await this.service.list(query);
    return this.response.paginated(data, total, page, limit);
  }

  @Get('stats')
  @Permissions('store:crm_inbox:read')
  async stats() {
    return this.response.success(await this.service.stats());
  }

  /**
   * Ids and states only; the client re-reads through the REST endpoints.
   * No `@Query()` DTO: EventSource authenticates with `?token=` and the
   * global whitelist pipe would reject that property.
   */
  @Sse('stream')
  @Permissions('store:crm_inbox:read')
  stream(): Observable<MessageEvent> {
    const events$ = this.service.stream().pipe(
      map(
        (event) =>
          ({ type: event.type, data: JSON.stringify(event) }) as MessageEvent,
      ),
    );
    // Keep-alive so proxies do not idle-close the stream and a dirty
    // disconnect surfaces as a closed request.
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: `: heartbeat ${Date.now()}` }) as MessageEvent),
    );
    return merge(events$, heartbeat$);
  }

  @Get(':id')
  @Permissions('store:crm_inbox:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.findOne(id));
  }

  @Get(':id/messages')
  @Permissions('store:crm_inbox:read')
  async messages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CrmMessagesQueryDto,
  ) {
    const { data, meta } = await this.service.messages(id, query);
    return this.response.success(data, 'Messages retrieved', meta);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('store:crm_inbox:manage')
  async send(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendCrmMessageDto,
  ) {
    return this.response.success(
      await this.service.send(id, dto),
      'Message queued',
    );
  }

  @Post(':id/notes')
  @Permissions('store:crm_inbox:manage')
  async addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCrmNoteDto,
  ) {
    return this.response.created(await this.service.addNote(id, dto.body));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:crm_inbox:read')
  async markRead(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.markRead(id));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:crm_inbox:manage')
  async close(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.close(id));
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:crm_inbox:manage')
  async reopen(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.reopen(id));
  }

  @Patch(':id/assign')
  @Permissions('store:crm_inbox:assign')
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignCrmConversationDto,
  ) {
    return this.response.updated(
      await this.service.assign(id, dto.assigned_user_id),
    );
  }
}

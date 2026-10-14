import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SkipSubscriptionGate } from '../store/subscriptions/decorators/skip-subscription-gate.decorator';
import { ResponseService } from '../../common/responses/response.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { DocumentEmailGmailCodeService } from './services/document-email-gmail-code.service';
import { DocumentEmailHistoryService } from './services/document-email-history.service';
import { DocumentEmailInboxService } from './services/document-email-inbox.service';
import { ActivateDocumentEmailInboxDto, DiscardDocumentEmailMessageDto, DocumentEmailEmptyQueryDto, DocumentEmailMessagesQueryDto, DocumentEmailMessageVersionDto, RotateDocumentEmailAddressDto, UpdateDocumentEmailInboxDto } from './dto/document-email-reception.dto';

const CONFIGURE = 'invoicing:received:connections:configure';
@Controller('store/invoicing/received-documents/email-reception')
@UseGuards(PermissionsGuard)
export class StoreDocumentEmailReceptionController {
  @Inject(DocumentEmailGmailCodeService)
  private readonly gmail!: DocumentEmailGmailCodeService;

  @Inject(DocumentEmailHistoryService)
  private readonly history!: DocumentEmailHistoryService;

  constructor(
    private readonly inboxes: DocumentEmailInboxService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
  ) {}

  @Get('status')
  @Permissions('invoicing:received:read')
  async status(@Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.success(await this.inboxes.status(await this.contexts.resolveStoreRead()));
  }

  @Get('configuration')
  @Permissions(CONFIGURE)
  async configuration(@Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.success(await this.inboxes.configuration(await this.contexts.resolveStoreRead()));
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Permissions(CONFIGURE)
  async activate(@Body() dto: ActivateDocumentEmailInboxDto, @Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.success(await this.inboxes.activate(await this.contexts.resolveStoreRead(), dto));
  }

  @Patch('configuration')
  @SkipSubscriptionGate()
  @Permissions(CONFIGURE)
  async update(@Body() dto: UpdateDocumentEmailInboxDto, @Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.updated(await this.inboxes.update(await this.contexts.resolveStoreRead(), dto));
  }

  @Post('rotate-address')
  @HttpCode(HttpStatus.OK)
  @Permissions(CONFIGURE)
  async rotate(@Body() dto: RotateDocumentEmailAddressDto, @Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.updated(await this.inboxes.rotateAddress(await this.contexts.resolveStoreRead(), dto));
  }

  @Get('gmail-code')
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  @Permissions(CONFIGURE)
  async gmailCode(@Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.success(await this.gmail.current(await this.contexts.resolveStoreRead()));
  }

  @Get('messages')
  @Permissions('invoicing:received:read')
  async messages(@Query() query: DocumentEmailMessagesQueryDto) {
    const result = await this.history.list(await this.contexts.resolveStoreRead(), query);
    return this.responses.paginated(result.data, result.total, result.page, result.limit);
  }

  @Get('messages/:id')
  @Permissions('invoicing:received:read')
  async message(@Param('id', ParseIntPipe) id: number, @Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.success(await this.history.detail(await this.contexts.resolveStoreRead(), id));
  }

  @Post('messages/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('invoicing:received:connections:sync')
  async retryMessage(@Param('id', ParseIntPipe) id: number, @Body() dto: DocumentEmailMessageVersionDto, @Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.success(await this.history.retry(await this.contexts.resolveStoreRead(), id, dto));
  }

  @Post('messages/:id/discard')
  @HttpCode(HttpStatus.OK)
  @SkipSubscriptionGate()
  @Permissions(CONFIGURE)
  async discardMessage(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardDocumentEmailMessageDto, @Query() _query: DocumentEmailEmptyQueryDto) {
    return this.responses.updated(await this.history.discard(await this.contexts.resolveStoreRead(), id, dto));
  }

}

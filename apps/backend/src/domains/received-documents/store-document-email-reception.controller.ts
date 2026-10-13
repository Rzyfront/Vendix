import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SkipSubscriptionGate } from '../store/subscriptions/decorators/skip-subscription-gate.decorator';
import { ResponseService } from '../../common/responses/response.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { DocumentEmailInboxService } from './services/document-email-inbox.service';
import { ActivateDocumentEmailInboxDto, DocumentEmailEmptyQueryDto, RotateDocumentEmailAddressDto, UpdateDocumentEmailInboxDto } from './dto/document-email-reception.dto';

const CONFIGURE = 'invoicing:received:connections:configure';
@Controller('store/invoicing/received-documents/email-reception')
@UseGuards(PermissionsGuard)
export class StoreDocumentEmailReceptionController {
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
}

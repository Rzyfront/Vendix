import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { UpdateInboundHookDto, UpdateMailboxDto } from './workflow-inbound.dto';
import { WorkflowInboundHooksService } from './workflow-inbound-hooks.service';
import { WorkflowMailboxService } from './workflow-mailbox.service';

/**
 * Connections that start a flow from outside: the signed inbound webhook and
 * the mailbox. Design-side only; the secret is returned on create/rotate and
 * never again.
 */
@Controller('store/workflows/definitions/:id')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowInboundController {
  constructor(
    private readonly hooks: WorkflowInboundHooksService,
    private readonly mailboxes: WorkflowMailboxService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('inbound-hook')
  @Permissions('store:workflows:design')
  async hookState(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.hooks.state(id));
  }

  @Post('inbound-hook')
  @Permissions('store:workflows:design')
  async hookCreate(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.created(await this.hooks.create(id), 'Webhook activado');
  }

  @Post('inbound-hook/rotate')
  @Permissions('store:workflows:design')
  async hookRotate(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.hooks.rotate(id), 'Secreto rotado');
  }

  @Patch('inbound-hook')
  @Permissions('store:workflows:design')
  async hookUpdate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInboundHookDto) {
    return this.responseService.success(await this.hooks.update(id, dto), 'Webhook actualizado');
  }

  @Get('mailbox')
  @Permissions('store:workflows:design')
  async mailboxState(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.mailboxes.state(id));
  }

  @Post('mailbox')
  @Permissions('store:workflows:design')
  async mailboxActivate(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.created(await this.mailboxes.activate(id), 'Buzón activado');
  }

  @Patch('mailbox')
  @Permissions('store:workflows:design')
  async mailboxUpdate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMailboxDto) {
    return this.responseService.success(await this.mailboxes.update(id, dto), 'Buzón actualizado');
  }
}

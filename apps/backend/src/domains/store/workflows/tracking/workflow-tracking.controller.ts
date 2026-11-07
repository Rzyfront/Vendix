import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { ReissueTrackingLinkDto } from './workflow-tracking.dto';
import { WorkflowTrackingLinksService } from './workflow-tracking-links.service';

/** Tracking links of a request: list, generate-and-send and revoke (the creator never sees the token again). */
@Controller('store/workflows/instances/:id/tracking-links')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowTrackingController {
  constructor(
    private readonly links: WorkflowTrackingLinksService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:manage')
  async list(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.links.list(id));
  }

  @Post()
  @Permissions('store:workflows:manage')
  async reissue(@Param('id', ParseIntPipe) id: number, @Body() dto: ReissueTrackingLinkDto) {
    const link = await this.links.reissue(id, dto.email);
    return this.responseService.success(link, `Enlace enviado a ${dto.email}`);
  }

  @Post(':linkId/revoke')
  @Permissions('store:workflows:manage')
  async revoke(
    @Param('id', ParseIntPipe) id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
  ) {
    return this.responseService.success(await this.links.revoke(id, linkId), 'Enlace revocado');
  }
}

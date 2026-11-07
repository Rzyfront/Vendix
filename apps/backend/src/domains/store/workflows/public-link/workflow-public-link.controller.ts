import { Body, Controller, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { UpdatePublicLinkSettingsDto } from './workflow-public-link.dto';
import { WorkflowPublicLinksService } from './workflow-public-links.service';

/** Settings of the public link (expiry, captcha); create / status / revoke live with the definitions. */
@Controller('store/workflows/definitions')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowPublicLinkController {
  constructor(
    private readonly links: WorkflowPublicLinksService,
    private readonly responseService: ResponseService,
  ) {}

  @Patch(':id/public-link')
  @Permissions('store:workflows:design')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePublicLinkSettingsDto,
  ) {
    return this.responseService.updated(
      await this.links.updateSettings(id, dto),
      'Enlace actualizado',
    );
  }
}

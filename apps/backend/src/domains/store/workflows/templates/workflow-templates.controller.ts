import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowTemplatesService } from './workflow-templates.service';

/** Gallery of Administration templates: browse and activate (create + publish). */
@Controller('store/workflows/templates')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowTemplatesController {
  constructor(
    private readonly templates: WorkflowTemplatesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  list() {
    return this.responseService.success(this.templates.list());
  }

  @Get(':key')
  @Permissions('store:workflows:read')
  get(@Param('key') key: string) {
    return this.responseService.success(this.templates.get(key));
  }

  @Post(':key/activate')
  @Permissions('store:workflows:design')
  async activate(@Param('key') key: string) {
    return this.responseService.created(await this.templates.activate(key));
  }
}

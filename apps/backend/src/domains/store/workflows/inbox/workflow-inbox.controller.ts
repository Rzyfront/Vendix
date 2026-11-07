import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowInboxQueryDto } from '../dto/workflow-operation.dto';
import { WorkflowInboxService } from './workflow-inbox.service';

/** "Mis tareas": the caller's actionable tasks. */
@Controller('store/workflows/inbox')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowInboxController {
  constructor(
    private readonly inbox: WorkflowInboxService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:task')
  async list(@Query() query: WorkflowInboxQueryDto) {
    const r = await this.inbox.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }
}

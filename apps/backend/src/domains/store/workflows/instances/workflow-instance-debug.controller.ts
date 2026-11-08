import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowInstanceDebugService } from './workflow-instance-debug.service';

/** Instance debugger: variables at every event (P5.2). */
@Controller('store/workflows/instances')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowInstanceDebugController {
  constructor(
    private readonly debugService: WorkflowInstanceDebugService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':id/debug')
  @Permissions('store:workflows:manage')
  async debug(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.debugService.debug(id));
  }
}

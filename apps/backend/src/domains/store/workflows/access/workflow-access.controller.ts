import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { UpdateWorkflowAccessDto } from './workflow-access.dto';
import { WorkflowAccessService } from './workflow-access.service';

/** "Permisos" of a flow: who designs, who sees, who decides each stage. */
@Controller('store/workflows/definitions/:id/access')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowAccessController {
  constructor(
    private readonly access: WorkflowAccessService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.access.get(id));
  }

  @Put()
  @Permissions('store:workflows:design')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkflowAccessDto) {
    return this.responseService.updated(
      await this.access.update(id, dto.access ?? null),
      'Permisos actualizados',
    );
  }
}

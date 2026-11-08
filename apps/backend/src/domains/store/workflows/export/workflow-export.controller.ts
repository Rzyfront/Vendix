import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowExportService } from './workflow-export.service';

/** P7.6: full ZIP export of the store's Flows data. Owner/manager only. */
@Controller('store/workflows/exports')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowExportController {
  constructor(
    private readonly exports: WorkflowExportService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:workflows:manage')
  async request() {
    return this.responseService.created(await this.exports.request(), 'Exportación solicitada');
  }

  @Get()
  @Permissions('store:workflows:manage')
  async list() {
    return this.responseService.success(await this.exports.list());
  }

  @Get(':id/download')
  @Permissions('store:workflows:manage')
  async download(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.exports.download(id));
  }
}

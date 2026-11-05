import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { sendXlsxReport } from '@common/reports/report-response.util';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowAnalyticsQueryDto } from '../dto/workflow-operation.dto';
import { WorkflowAnalyticsService } from './workflow-analytics.service';
import { buildWorkflowAnalyticsWorkbook } from './workflow-analytics.xlsx';

/** KPIs of one flow. `format=xlsx` is built from the same dataset as the JSON. */
@Controller('store/workflows/analytics')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowAnalyticsController {
  constructor(
    private readonly analytics: WorkflowAnalyticsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':definitionId')
  @Permissions('store:workflows:read')
  async get(
    @Param('definitionId', ParseIntPipe) definitionId: number,
    @Query() query: WorkflowAnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.analytics.report(definitionId, query);
    if (query.format === 'xlsx') {
      const buffer = await buildReportBuffer(
        buildWorkflowAnalyticsWorkbook(report),
      );
      sendXlsxReport(
        res,
        buffer,
        `flujo-${definitionId}-${report.range.from}-${report.range.to}.xlsx`,
      );
      return;
    }
    res.json(this.responseService.success(report));
  }
}

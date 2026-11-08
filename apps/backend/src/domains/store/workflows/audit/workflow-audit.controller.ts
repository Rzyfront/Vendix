import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { sendXlsxReport } from '@common/reports/report-response.util';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowAuditExportService } from './workflow-audit.export.service';
import { parseAuditQuery, WorkflowAuditQueryDto, WorkflowAuditQueryService } from './workflow-audit.query';
import { WorkflowAuditService } from './workflow-audit.service';

/** Immutable audit trail of Flows: list, integrity check and XLSX export. */
@Controller('store/workflows/audit')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowAuditController {
  constructor(
    private readonly audit: WorkflowAuditService,
    private readonly query: WorkflowAuditQueryService,
    private readonly exporter: WorkflowAuditExportService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:manage')
  async list(@Query() raw: WorkflowAuditQueryDto) {
    const { filters, paging } = parseAuditQuery(raw);
    const { items, total } = await this.query.list(filters, paging);
    return this.responseService.paginated(items, total, paging.page, paging.limit);
  }

  @Get('verify')
  @Permissions('store:workflows:manage')
  async verify() {
    const { valid, count, broken_at_seq } = await this.audit.verify();
    return this.responseService.success({ valid, count, broken_at_seq });
  }

  @Get('export')
  @Permissions('store:workflows:manage')
  async export(@Query() raw: WorkflowAuditQueryDto, @Res() res: Response): Promise<void> {
    const { filters } = parseAuditQuery(raw);
    const { buffer, filename } = await this.exporter.build(filters);
    sendXlsxReport(res, buffer, filename);
  }
}

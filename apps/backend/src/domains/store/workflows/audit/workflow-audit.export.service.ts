import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { buildReportFilename } from '@common/reports/report-response.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAuditFilters, WorkflowAuditQueryService } from './workflow-audit.query';
import { WorkflowAuditService } from './workflow-audit.service';
import { buildWorkflowAuditWorkbook } from './workflow-audit.xlsx';

/**
 * XLSX of the audit trail for an external auditor. The export is itself an
 * audited fact: `audit.exported` is written first (fail-closed), so nothing
 * leaves the store without a row and the file lists its own export.
 */
@Injectable()
export class WorkflowAuditExportService {
  constructor(
    private readonly audit: WorkflowAuditService,
    private readonly query: WorkflowAuditQueryService,
    private readonly prisma: StorePrismaService,
  ) {}

  async build(filters: WorkflowAuditFilters): Promise<{ buffer: Buffer; filename: string }> {
    const storeId = RequestContextService.getStoreId() as number;
    const tz = await this.query.timezone();
    await this.audit.recordNow({
      action: 'audit.exported',
      target_type: 'audit',
      summary: 'Exportó la auditoría de Flujos a Excel',
      details: { filters },
    });
    const rows = await this.query.all(filters, tz);
    const verification = await this.audit.verify();
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: storeId },
      select: { name: true },
    });
    const generated_at = new Date();
    const buffer = await buildReportBuffer(
      buildWorkflowAuditWorkbook({
        rows,
        verification,
        store_name: store?.name ?? '',
        timezone: tz,
        generated_at,
      }),
    );
    return { buffer, filename: buildReportFilename('auditoria-flujos', { date: generated_at, tz }) };
  }
}

import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '../../common/responses/response.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ReceivedDocumentContextQueryDto } from './dto/received-document-context.dto';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentAccountingEvidenceService } from './services/received-document-accounting-evidence.service';

@Controller('organization/invoicing/received-documents')
@UseGuards(PermissionsGuard)
export class OrganizationReceivedDocumentAccountingController {
  constructor(
    private readonly evidence: ReceivedDocumentAccountingEvidenceService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
  ) {}

  @Get(':id/accounting-evidence')
  @Permissions('organization:invoicing:received:read')
  async accountingEvidence(@Param('id', ParseIntPipe) id: number, @Query() query: ReceivedDocumentContextQueryDto) {
    const context = await this.contexts.resolveOrganization(query.store_id);
    return this.responses.success(await this.evidence.list(context, id));
  }
}

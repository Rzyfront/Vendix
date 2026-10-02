import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '../../common/responses/response.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ReceivedDocumentContextQueryDto } from './dto/received-document-context.dto';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentAccountingEvidenceService } from './services/received-document-accounting-evidence.service';

@Controller('store/invoicing/received-documents')
@UseGuards(PermissionsGuard)
export class StoreReceivedDocumentAccountingController {
  constructor(
    private readonly evidence: ReceivedDocumentAccountingEvidenceService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
  ) {}

  @Get(':id/accounting-evidence')
  @Permissions('invoicing:received:read')
  async accountingEvidence(@Param('id', ParseIntPipe) id: number, @Query() query: ReceivedDocumentContextQueryDto) {
    if (query.store_id !== undefined) throw new BadRequestException('La tienda se resuelve desde el contexto autenticado.');
    const context = await this.contexts.resolveStore();
    return this.responses.success(await this.evidence.list(context, id));
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../../subscriptions/guards/ai-access.guard';
import { InvoiceDraftScannerService } from './invoice-draft-scanner.service';
import {
  enqueueInvoiceDraftScan,
  INVOICE_DRAFT_SCAN_UPLOAD_MAX_COUNT,
  INVOICE_DRAFT_SCAN_UPLOAD_OPTIONS,
} from './invoice-draft-scan-files.util';
import { ScanInvoiceDraftDto } from './dto/scan-invoice-draft.dto';

/**
 * Escáner IA de borrador para «Nueva factura».
 *
 * Controller propio (no un método de `InvoicingController`) y registrado ANTES
 * que él en `InvoicingModule`: `InvoicingController` monta `@Post(':id/...')`
 * sobre el mismo prefijo, y Express resuelve por orden de registro.
 *
 * Solo encola: el resultado se consulta en `GET ai-scan-jobs/:jobId` y es un
 * borrador — nada se crea ni se emite.
 */
@Controller('store/invoicing/scan-draft')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('invoicing')
export class InvoiceDraftScanController {
  constructor(
    private readonly scanner: InvoiceDraftScannerService,
    private readonly aiScanJobs: AiScanJobService,
    private readonly responses: ResponseService,
  ) {}

  @Post('async')
  @Permissions('invoicing:write')
  @RequireAIFeature('async_queue')
  @UseGuards(AiAccessGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  // Holgura de 1 a propósito: el exceso llega a `assertInvoiceDraftScanFiles`
  // y responde INVOICE_DRAFT_SCAN_TOO_MANY_FILES en vez del error de multer.
  @UseInterceptors(
    FilesInterceptor(
      'files',
      INVOICE_DRAFT_SCAN_UPLOAD_MAX_COUNT,
      INVOICE_DRAFT_SCAN_UPLOAD_OPTIONS,
    ),
  )
  async scanDraftAsync(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ScanInvoiceDraftDto,
  ) {
    const { job_id } = await enqueueInvoiceDraftScan(
      { scanner: this.scanner, aiScanJobs: this.aiScanJobs },
      files,
      dto?.note,
      'store',
    );
    return this.responses.success({ job_id }, 'Escaneo encolado');
  }
}

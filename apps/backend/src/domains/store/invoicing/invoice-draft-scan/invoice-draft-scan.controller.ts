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
import { memoryStorage } from 'multer';
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
import { assertInvoiceDraftScanFiles } from './invoice-draft-scan-files.util';
import { ScanInvoiceDraftDto } from './dto/scan-invoice-draft.dto';
import {
  INVOICE_DRAFT_SCAN_MAX_FILE_BYTES,
  MAX_INVOICE_DRAFT_SCAN_FILES,
} from './invoice-draft-scan.types';

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
    FilesInterceptor('files', MAX_INVOICE_DRAFT_SCAN_FILES + 1, {
      storage: memoryStorage(),
      limits: { fileSize: INVOICE_DRAFT_SCAN_MAX_FILE_BYTES },
    }),
  )
  async scanDraftAsync(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ScanInvoiceDraftDto,
  ) {
    const valid_files = assertInvoiceDraftScanFiles(files);
    await this.scanner.assertReady();
    const note = dto?.note?.trim() || null;
    const { job_id } = await this.aiScanJobs.enqueue(
      'invoice_draft',
      valid_files,
      { note },
    );
    return this.responses.success({ job_id }, 'Escaneo encolado');
  }
}

import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import { memoryStorage } from 'multer';
import { RutScannerService } from './rut-scanner.service';

@ApiTags('Store Settings')
@Controller('store/settings/rut-scanner')
@UseGuards(PermissionsGuard)
export class RutScannerController {
  constructor(
    private readonly rutScannerService: RutScannerService,
    private readonly aiScanJobService: AiScanJobService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * @deprecated Usar POST store/settings/rut-scanner/scan/async (el síncrono muere en 504 tras 60 s de proxy).
   */
  @Post('scan')
  @Permissions('store:settings:fiscal_data:write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Scan a Colombian RUT document (image/PDF) and extract normalized fiscal identity data',
  })
  @ApiResponse({ status: 200, description: 'RUT scanned successfully' })
  async scanRut(@UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) {
        throw new VendixHttpException(ErrorCodes.RUT_SCAN_NO_FILE);
      }
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new VendixHttpException(ErrorCodes.RUT_SCAN_INVALID_FILE);
      }
      const result = await this.rutScannerService.scanRutDocument(file);
      return this.responseService.success(result, 'RUT escaneado exitosamente');
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al escanear el RUT',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('scan/async')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('store:settings:fiscal_data:write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  @ApiOperation({
    summary:
      'Enqueue a RUT scan (async ai-scan job); poll GET /ai-scan-jobs/:jobId',
  })
  @ApiResponse({ status: 202, description: 'RUT scan enqueued' })
  async scanRutAsync(@UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) {
        throw new VendixHttpException(ErrorCodes.RUT_SCAN_NO_FILE);
      }
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new VendixHttpException(ErrorCodes.RUT_SCAN_INVALID_FILE);
      }
      await this.rutScannerService.assertReady();
      const { job_id } = await this.aiScanJobService.enqueue('rut', [file]);
      return this.responseService.success({ job_id }, 'Escaneo encolado');
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al escanear el RUT',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}

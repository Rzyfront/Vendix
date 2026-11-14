import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import { CustomerAiImportService } from './customer-ai-import.service';
import { BulkUploadLogsService } from '../../bulk-uploads/bulk-upload-logs.service';
import {
  AnalyzeCustomerImportDto,
  CommitCustomerImportDto,
  CommitCustomerImportResult,
} from './dto/customer-ai-import.dto';

/** Clientes existentes a los que solo se les sumaron ubicaciones. */
function countLocationsOnly(result: CommitCustomerImportResult): number {
  return (result.results ?? []).filter((r) => r.outcome === 'locations_added')
    .length;
}

/**
 * Carga masiva de clientes asistida por IA.
 *
 *   POST store/customers/ai-import/async   — encola el escaneo (202 + job_id)
 *   POST store/customers/ai-import/analyze — cruza con existentes, sin persistir
 *   POST store/customers/ai-import/commit  — persiste lo confirmado
 *
 * El resultado del escaneo se consulta en `GET /api/ai-scan-jobs/:jobId`.
 */
@Controller('store/customers/ai-import')
@UseGuards(RolesGuard, PermissionsGuard)
export class CustomerAiImportController {
  constructor(
    private readonly importService: CustomerAiImportService,
    private readonly aiScanJobs: AiScanJobService,
    private readonly responseService: ResponseService,
    private readonly bulkUploadLogs: BulkUploadLogsService,
  ) {}

  private fail(error: unknown, fallback: string): never {
    if (error instanceof VendixHttpException || error instanceof HttpException) {
      throw error;
    }
    throw new VendixHttpException(
      ErrorCodes.SYS_CONFLICT_001,
      (error as Error)?.message || fallback,
    );
  }

  @Post('async')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('store:customers:create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async scanAsync(@UploadedFile() file?: Express.Multer.File) {
    try {
      this.importService.assertValidFile(file);
      const { job_id } = await this.aiScanJobs.enqueue(
        'customer_import',
        [this.importService.toScanFile(file!)],
        {},
      );
      // QUI-1004 — aquí sí llega el archivo: su huella y la carga anterior de
      // esta tienda con la misma huella. El cliente la devuelve en el commit.
      const fileInfo = await this.bulkUploadLogs.describeFile(
        'customers_ai',
        file!.buffer,
        file!.originalname,
      );
      return this.responseService.success(
        { job_id, ...fileInfo },
        'Escaneo encolado',
      );
    } catch (error) {
      this.fail(error, 'Error al encolar el escaneo de clientes');
    }
  }

  @Post('analyze')
  @Permissions('store:customers:create')
  async analyze(@Body() dto: AnalyzeCustomerImportDto) {
    try {
      const result = await this.importService.analyze(dto);
      return this.responseService.success(result, 'Clientes analizados');
    } catch (error) {
      this.fail(error, 'Error al analizar los clientes');
    }
  }

  @Post('commit')
  @Permissions('store:customers:create')
  async commit(@Body() dto: CommitCustomerImportDto) {
    try {
      const result = await this.importService.commit(dto);
      // QUI-1004 — una fila en el registro de cargas masivas (accesorio: un
      // fallo al registrar no tumba el lote ya escrito).
      await this.bulkUploadLogs.trackUpload('customers_ai', dto, {
        total: dto.customers.length,
        successful: result.created + result.updated + countLocationsOnly(result),
        created: result.created,
        failed: result.failed,
        skipped: result.skipped,
      });
      return this.responseService.success(result, 'Lote procesado');
    } catch (error) {
      this.fail(error, 'Error al cargar el lote de clientes');
    }
  }
}

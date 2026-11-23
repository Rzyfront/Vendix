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
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import { BulkUploadLogsService } from '../bulk-uploads/bulk-upload-logs.service';
import {
  CommitMemberRosterDto,
  CommitMemberRosterResult,
  RosterScanResult,
} from './dto/scan-roster.dto';
import { IndustryModuleGuard } from '../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../common/decorators/industry-module.decorator';

/**
 * Member bulk scanner controller.
 *
 * Endpoints (all gated by the dedicated permission `store:memberships:bulk_import`):
 *
 *   POST /store/memberships/bulk-scan         — scan a roster document (multipart)
 *   POST /store/memberships/bulk-scan/analyze — resolve plans + customers (no persist)
 *   POST /store/memberships/bulk-scan/commit  — persist confirmed edits
 *
 * Dedicated flat namespace (`store/memberships/bulk-scan`) instead of a
 * nested route on `memberships.controller.ts` to avoid the `:id` route
 * collision (Decisión 5 — clean controller per cross-cutting concern).
 *
 * Error handling: rethrow `VendixHttpException` / `HttpException` so Nest
 * emits the correct status + error code; opaque errors get wrapped into
 * `SYS_CONFLICT_001` with the underlying message preserved.
 */
/**
 * QUI-1004 — conteos del padrón para el registro de cargas masivas. Si falla
 * la fase de planes no se persiste ningún miembro: todo cuenta como error.
 */
export function rosterUploadCounts(result: CommitMemberRosterResult) {
  const total = result.ready ?? result.results?.length ?? 0;
  if (result.plan_errors?.length) {
    return { total, successful: 0, failed: total, skipped: 0 };
  }
  return {
    total,
    successful: result.succeeded,
    failed: result.failed,
    skipped: (result.results ?? []).filter((r) => r.status === 'skipped')
      .length,
  };
}

@Controller('store/memberships/bulk-scan')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('memberships_members')
export class MemberBulkScannerController {
  private static readonly ALLOWED_MIMETYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  private static readonly MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

  constructor(
    private readonly scannerService: MemberBulkScannerService,
    private readonly aiScanJobs: AiScanJobService,
    private readonly responseService: ResponseService,
    private readonly bulkUploadLogs: BulkUploadLogsService,
  ) {}

  private fail(error: any, fallback: string): never {
    if (error instanceof VendixHttpException || error instanceof HttpException) {
      throw error;
    }
    throw new VendixHttpException(
      ErrorCodes.SYS_CONFLICT_001,
      error?.message || fallback,
    );
  }

  @Post('async')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('store:memberships:bulk_import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MemberBulkScannerController.MAX_FILE_BYTES },
    }),
  )
  async scanAsync(@UploadedFile() file?: Express.Multer.File) {
    try {
      this.scannerService.assertValidFile(file);
      const { job_id } = await this.aiScanJobs.enqueue(
        'member_roster',
        [this.scannerService.toScanFile(file!)],
        {},
      );
      // QUI-1004 — huella del archivo y carga anterior de esta tienda con la
      // misma huella; el cliente la devuelve en el commit.
      const fileInfo = await this.bulkUploadLogs.describeFile(
        'memberships',
        file!.buffer,
        file!.originalname,
      );
      return this.responseService.success(
        { job_id, ...fileInfo },
        'Escaneo encolado',
      );
    } catch (error) {
      this.fail(error, 'Error al encolar el escaneo del padrón');
    }
  }

  @Post('analyze')
  @Permissions('store:memberships:bulk_import')
  async analyze(@Body() body: { scan: RosterScanResult; row_offset?: number }) {
    try {
      if (!body?.scan) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Falta el payload `scan` con el resultado del OCR',
        );
      }
      // ia-cargas F2 — optional: members before this chunk of a big sheet.
      const rowOffset = Number(body.row_offset ?? 0);
      const result = await this.scannerService.analyzeRoster(
        body.scan,
        Number.isInteger(rowOffset) && rowOffset > 0 ? rowOffset : 0,
      );
      return this.responseService.success(
        result,
        'Padrón analizado exitosamente',
      );
    } catch (error) {
      this.fail(error, 'Error al analizar el padrón');
    }
  }

  @Post('commit')
  @Permissions('store:memberships:bulk_import')
  async commit(@Body() dto: CommitMemberRosterDto) {
    try {
      const result = await this.scannerService.commitRoster(dto);
      // ia-cargas F2 — a big roster arrives in chunks with the same
      // `session_id` and adds up on ONE row of the upload log.
      if (dto.session_id) {
        await this.bulkUploadLogs.trackSessionPage(
          'memberships',
          dto.session_id,
          dto,
          {
            ...rosterUploadCounts(result),
            total: dto.total_members ?? result.ready ?? dto.members.length,
          },
        );
      } else {
        await this.bulkUploadLogs.trackUpload(
          'memberships',
          dto,
          rosterUploadCounts(result),
        );
      }
      return this.responseService.success(
        result,
        'Padrón cargado exitosamente',
      );
    } catch (error) {
      this.fail(error, 'Error al cargar el padrón');
    }
  }
}
import {
  Body,
  Controller,
  HttpException,
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
import {
  CommitMemberRosterDto,
  RosterScanResult,
} from './dto/scan-roster.dto';

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
@Controller('store/memberships/bulk-scan')
@UseGuards(PermissionsGuard)
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
    private readonly responseService: ResponseService,
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

  @Post()
  @Permissions('store:memberships:bulk_import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MemberBulkScannerController.MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          !MemberBulkScannerController.ALLOWED_MIMETYPES.includes(file.mimetype)
        ) {
          return cb(
            new VendixHttpException(ErrorCodes.MEMBER_SCAN_INVALID_FILE),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async scan(@UploadedFile() file?: Express.Multer.File) {
    try {
      if (!file) {
        throw new VendixHttpException(ErrorCodes.MEMBER_SCAN_NO_FILE);
      }
      const result = await this.scannerService.scanRoster(file);
      return this.responseService.success(
        result,
        'Padrón escaneado exitosamente',
      );
    } catch (error) {
      this.fail(error, 'Error al escanear el padrón');
    }
  }

  @Post('analyze')
  @Permissions('store:memberships:bulk_import')
  async analyze(@Body() body: { scan: RosterScanResult }) {
    try {
      if (!body?.scan) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Falta el payload `scan` con el resultado del OCR',
        );
      }
      const result = await this.scannerService.analyzeRoster(body.scan);
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
      return this.responseService.success(
        result,
        'Padrón cargado exitosamente',
      );
    } catch (error) {
      this.fail(error, 'Error al cargar el padrón');
    }
  }
}
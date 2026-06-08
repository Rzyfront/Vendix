import {
  Controller,
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
import { RutScannerService } from '../../store/settings/rut-scanner.service';

@ApiTags('Organization Settings')
@Controller('organization/settings/rut-scanner')
@UseGuards(PermissionsGuard)
export class RutScannerController {
  constructor(
    private readonly rutScannerService: RutScannerService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('scan')
  @Permissions('organization:settings:fiscal_data:write')
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
}

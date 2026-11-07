import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { ReadDocumentCheckDto } from './dto/document-check.dto';
import { DocumentChecksService } from './document-checks.service';

/**
 * "Leer con IA" sobre archivos del expediente. Vive en un módulo propio (no en
 * Documentos) porque la regla de visibilidad usa las instancias de Flujos.
 */
@Controller('store/documents')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentChecksController {
  constructor(
    private readonly checks: DocumentChecksService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('files/:fileId/checks')
  @Permissions('store:workflows:task', 'store:workflows:manage')
  async read(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() dto: ReadDocumentCheckDto,
  ) {
    return this.responseService.success(await this.checks.read(fileId, dto));
  }

  @Get('files/:fileId/checks')
  @Permissions('store:workflows:task', 'store:workflows:manage')
  async list(@Param('fileId', ParseIntPipe) fileId: number) {
    return this.responseService.success(await this.checks.list(fileId));
  }

  @Post('checks/:id/review')
  @Permissions('store:workflows:task', 'store:workflows:manage')
  async review(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.checks.review(id));
  }
}

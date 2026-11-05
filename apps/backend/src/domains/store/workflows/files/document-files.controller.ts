import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowFilesService } from './workflow-files.service';

/**
 * Descarga de documentos. Vive en el módulo de Flujos (no en Documentos) porque
 * la regla "participante de la solicitud" usa la visibilidad de las instancias
 * y Documentos no puede depender de Flujos.
 */
@Controller('store/documents/files')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentFilesController {
  constructor(
    private readonly files: WorkflowFilesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':id/download')
  @Permissions('store:documents:read', 'store:workflows:read')
  async download(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.files.download(id));
  }
}

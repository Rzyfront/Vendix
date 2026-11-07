import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { DocumentActor } from '../dossiers.service';
import { EmitDocumentDto, IssuedQueryDto, VoidDocumentDto } from './dto/template.dto';
import { IssuedDocumentsService } from './issued-documents.service';

const actor = (): DocumentActor => ({ type: 'user', id: RequestContextService.getUserId() ?? null });

/**
 * Documentos emitidos desde plantillas. Leer: documentos o gestión de flujos; emitir,
 * reemitir y anular: `store:workflows:manage`. La descarga del PDF es la del
 * archivo (`store/documents/files/:file_id/download`).
 */
@Controller('store/documents/issued')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class IssuedDocumentsController {
  constructor(
    private readonly issued: IssuedDocumentsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:documents:read', 'store:workflows:manage')
  async list(@Query() query: IssuedQueryDto) {
    return this.responseService.success(await this.issued.list(query));
  }

  @Post('emit')
  @Permissions('store:workflows:manage')
  async emit(@Body() dto: EmitDocumentDto) {
    const doc = await this.issued.emit({
      instance_id: dto.instance_id,
      template_key: dto.template_key,
      requirement_key: dto.requirement_key,
      title: dto.title,
      actor: actor(),
    });
    return this.responseService.created(doc, 'Documento en preparación');
  }

  @Get(':id')
  @Permissions('store:documents:read', 'store:workflows:manage')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.issued.get(id));
  }

  @Post(':id/reissue')
  @Permissions('store:workflows:manage')
  async reissue(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.created(await this.issued.reissue(id, actor()), 'Documento en preparación');
  }

  @Post(':id/void')
  @Permissions('store:workflows:manage')
  async voidDocument(@Param('id', ParseIntPipe) id: number, @Body() dto: VoidDocumentDto) {
    return this.responseService.success(await this.issued.voidDocument(id, dto.reason, actor()), 'Documento anulado');
  }
}

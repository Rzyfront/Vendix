import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { HARD_MAX_FILE_BYTES } from '../documents.constants';
import { DocumentTemplatesService } from './document-templates.service';
import { CreateTemplateDto, TemplatesQueryDto, UpdateTemplateDto } from './dto/template.dto';

/** Plantillas de documentos: leer = `store:documents:read`; diseñar = `store:workflows:design`. */
@Controller('store/documents/templates')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentTemplatesController {
  constructor(
    private readonly templates: DocumentTemplatesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:documents:read')
  async list(@Query() query: TemplatesQueryDto) {
    return this.responseService.success(await this.templates.list(query));
  }

  @Post()
  @Permissions('store:workflows:design')
  async create(@Body() dto: CreateTemplateDto) {
    return this.responseService.created(await this.templates.create(dto), 'Plantilla creada');
  }

  @Get(':id')
  @Permissions('store:documents:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.templates.get(id));
  }

  @Patch(':id')
  @Permissions('store:workflows:design')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTemplateDto) {
    return this.responseService.success(await this.templates.updateDraft(id, dto), 'Borrador guardado');
  }

  @Post(':id/base-pdf')
  @Permissions('store:workflows:design')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: HARD_MAX_FILE_BYTES, files: 1 } }),
  )
  async uploadBasePdf(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.responseService.success(await this.templates.uploadBasePdf(id, file), 'PDF base recibido');
  }

  @Get(':id/base-pages')
  @Permissions('store:workflows:design')
  async basePages(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.templates.basePagesOf(id));
  }

  /** PDF de vista previa del borrador, con datos de ejemplo y marca de agua. */
  @Get(':id/preview')
  @Permissions('store:workflows:design')
  async preview(@Param('id', ParseIntPipe) id: number) {
    const pdf = await this.templates.preview(id);
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: 'inline; filename="vista-previa.pdf"' });
  }

  @Post(':id/publish')
  @Permissions('store:workflows:design')
  async publish(@Param('id', ParseIntPipe) id: number) {
    const result = await this.templates.publish(id);
    return this.responseService.success(
      result,
      result.created ? `Versión ${result.version} publicada` : 'No hay cambios: la versión publicada sigue siendo la misma',
    );
  }

  @Get(':id/versions')
  @Permissions('store:documents:read')
  async versions(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.templates.versions(id));
  }

  @Get(':id/versions/:versionId')
  @Permissions('store:documents:read')
  async version(@Param('id', ParseIntPipe) id: number, @Param('versionId', ParseIntPipe) versionId: number) {
    return this.responseService.success(await this.templates.version(id, versionId));
  }

  @Post(':id/archive')
  @Permissions('store:workflows:design')
  async archive(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.templates.archive(id), 'Plantilla archivada');
  }
}

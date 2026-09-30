import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { ResponseService } from '../../common/responses/response.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ReceivedDocumentContextQueryDto } from './dto/received-document-context.dto';
import {
  ManualReceivedDocumentDto,
  ReceivedDocumentQueryDto,
  UpdateReceivedDocumentReviewDto,
} from './dto/received-document.dto';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentScanQueueService } from './services/received-document-scan-queue.service';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const SAFE_MIME_TYPES = new Set([
  'application/xml',
  'text/xml',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

@Controller('organization/invoicing/received-documents')
@UseGuards(PermissionsGuard)
export class OrganizationReceivedDocumentsController {
  constructor(
    private readonly documents: ReceivedDocumentsService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
    private readonly scans: ReceivedDocumentScanQueueService,
  ) {}

  @Get()
  @Permissions('organization:invoicing:received:read')
  async list(@Query() query: ReceivedDocumentQueryDto) {
    const context = await this.contexts.resolveOrganization(query.store_id);
    const result = await this.documents.list(context, query);
    return this.responses.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Documentos recibidos obtenidos',
    );
  }

  @Post('scan')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('organization:invoicing:received:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async enqueueScan(
    @UploadedFile() file: Express.Multer.File,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    if (!file) throw new BadRequestException('Debe adjuntar el documento para lectura.');
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.success(await this.scans.enqueue(context, file));
  }

  @Get('scan/:jobId')
  @Permissions('organization:invoicing:received:read')
  async getScanStatus(
    @Param('jobId') jobId: string,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.success(await this.scans.getStatus(context, jobId));
  }

  @Get(':id')
  @Permissions('organization:invoicing:received:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.success(
      await this.documents.findOne(context, id),
      'Documento recibido obtenido',
    );
  }

  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('organization:invoicing:received:import')
  async createManual(
    @Body() dto: ManualReceivedDocumentDto,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.created(
      await this.documents.createManual(context, dto),
      'Documento recibido guardado para revisión',
    );
  }

  @Post('import/xml')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('organization:invoicing:received:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importXml(
    @UploadedFile() file: Express.Multer.File,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    if (!file) throw new BadRequestException('Debe adjuntar el XML del documento.');
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.created(
      await this.documents.importXml(context, file),
      'XML recibido y registrado',
    );
  }

  @Patch(':id/review')
  @Permissions('organization:invoicing:received:review')
  async updateReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReceivedDocumentReviewDto,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.updated(
      await this.documents.updateReview(context, id, dto),
      'Revisión del documento guardada',
    );
  }

  @Get(':id/files/:fileId')
  @Permissions('organization:invoicing:received:read')
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Query() scope: ReceivedDocumentContextQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    const document = await this.documents.findOne(context, id);
    const file = document.files?.find((candidate) => candidate.id === fileId);
    if (!file) throw new NotFoundException('Archivo del documento recibido no encontrado.');

    const fileName = this.safeFileName(file.file_name);
    const mimeType = SAFE_MIME_TYPES.has(file.mime_type)
      ? file.mime_type
      : 'application/octet-stream';
    const contents = await this.documents.getFile(context, id, fileId);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.setHeader('Content-Length', String(contents.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(contents);
  }

  private safeFileName(fileName: string): string {
    return SAFE_FILE_NAME.test(fileName) && !fileName.includes('..')
      ? fileName
      : 'documento-recibido';
  }
}

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
import { AiAccessGuard, RequireAIFeature } from '../store/subscriptions/guards/ai-access.guard';
import { ReceivedDocumentQueryDto, ManualReceivedDocumentDto, UpdateReceivedDocumentReviewDto } from './dto/received-document.dto';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentScanQueueService } from './services/received-document-scan-queue.service';
import { ReceivedDocumentMatchCandidatesService } from './services/received-document-match-candidates.service';
import { ReceivedDocumentMatchAllocationsService } from './services/received-document-match-allocations.service';
import {
  ConfirmReceivedDocumentMatchDto,
  ReceivedDocumentMatchCandidatesQueryDto,
  RevokeReceivedDocumentMatchDto,
} from './dto/received-document-match.dto';
import { ReceivedDocumentContextQueryDto } from './dto/received-document-context.dto';

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

@Controller('store/invoicing/received-documents')
@UseGuards(PermissionsGuard)
export class StoreReceivedDocumentsController {
  constructor(
    private readonly documents: ReceivedDocumentsService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
    private readonly scans: ReceivedDocumentScanQueueService,
    private readonly matchCandidates: ReceivedDocumentMatchCandidatesService,
    private readonly matchAllocations: ReceivedDocumentMatchAllocationsService,
  ) {}

  @Get()
  @Permissions('invoicing:received:read')
  async list(@Query() query: ReceivedDocumentQueryDto) {
    if (query.store_id !== undefined) {
      throw new BadRequestException('La tienda se resuelve desde el contexto autenticado.');
    }
    const context = await this.contexts.resolveStore();
    const result = await this.documents.list(context, { ...query, store_id: undefined });
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
  @Permissions('invoicing:received:import')
  @RequireAIFeature('async_queue')
  @UseGuards(AiAccessGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async enqueueScan(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Debe adjuntar el documento para lectura.');
    const context = await this.contexts.resolveStore();
    return this.responses.success(await this.scans.enqueue(context, file));
  }

  @Get('scan/:jobId')
  @Permissions('invoicing:received:read')
  async getScanStatus(@Param('jobId') jobId: string) {
    const context = await this.contexts.resolveStore();
    return this.responses.success(await this.scans.getStatus(context, jobId));
  }

  @Get(':id/match-candidates')
  @Permissions('invoicing:received:read')
  async matchCandidatesForDocument(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReceivedDocumentMatchCandidatesQueryDto,
  ) {
    this.rejectStoreOverride(query.store_id);
    const context = await this.contexts.resolveStore();
    return this.responses.success(await this.matchCandidates.list(context, id, {
      search: query.search,
      limit: query.limit,
    }));
  }

  @Get(':id/match-allocations')
  @Permissions('invoicing:received:read')
  async listMatchAllocations(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReceivedDocumentContextQueryDto,
  ) {
    this.rejectStoreOverride(query.store_id);
    const context = await this.contexts.resolveStore();
    return this.responses.success(await this.matchAllocations.list(context, id));
  }

  @Post(':id/match-allocations')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('invoicing:received:match:confirm')
  async confirmMatchAllocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmReceivedDocumentMatchDto,
    @Query() query: ReceivedDocumentContextQueryDto,
  ) {
    this.rejectStoreOverride(query.store_id);
    const context = await this.contexts.resolveStore();
    return this.responses.created(await this.matchAllocations.confirm(context, id, dto));
  }

  @Post(':id/match-allocations/:allocationId/revoke')
  @HttpCode(HttpStatus.OK)
  @Permissions('invoicing:received:match:revoke')
  async revokeMatchAllocation(
    @Param('id', ParseIntPipe) id: number,
    @Param('allocationId', ParseIntPipe) allocationId: number,
    @Body() dto: RevokeReceivedDocumentMatchDto,
    @Query() query: ReceivedDocumentContextQueryDto,
  ) {
    this.rejectStoreOverride(query.store_id);
    const context = await this.contexts.resolveStore();
    return this.responses.updated(await this.matchAllocations.revoke(context, id, allocationId, dto));
  }

  @Get(':id')
  @Permissions('invoicing:received:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const context = await this.contexts.resolveStore();
    return this.responses.success(
      await this.documents.findOne(context, id),
      'Documento recibido obtenido',
    );
  }

  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('invoicing:received:import')
  async createManual(@Body() dto: ManualReceivedDocumentDto) {
    const context = await this.contexts.resolveStore();
    return this.responses.created(
      await this.documents.createManual(context, dto),
      'Documento recibido guardado para revisión',
    );
  }

  @Post('import/xml')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('invoicing:received:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importXml(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Debe adjuntar el XML del documento.');
    const context = await this.contexts.resolveStore();
    return this.responses.created(
      await this.documents.importXml(context, file),
      'XML recibido y registrado',
    );
  }

  @Patch(':id/review')
  @Permissions('invoicing:received:review')
  async updateReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReceivedDocumentReviewDto,
  ) {
    const context = await this.contexts.resolveStore();
    return this.responses.updated(
      await this.documents.updateReview(context, id, dto),
      'Revisión del documento guardada',
    );
  }

  @Get(':id/files/:fileId')
  @Permissions('invoicing:received:read')
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const context = await this.contexts.resolveStore();
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

  private rejectStoreOverride(storeId?: number): void {
    if (storeId !== undefined) {
      throw new BadRequestException('La tienda se resuelve desde el contexto autenticado.');
    }
  }
}

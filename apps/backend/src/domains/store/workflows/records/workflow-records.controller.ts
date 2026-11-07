import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { HARD_MAX_FILE_BYTES } from '../../documents/documents.constants';
import { requireIdempotencyKey } from '../dto/idempotency-key';
import {
  CreateWorkflowRecordDto,
  StartWorkflowOnRecordDto,
  UpdateWorkflowRecordDto,
  WorkflowRecordGetQueryDto,
  WorkflowRecordsQueryDto,
} from './workflow-records.dto';
import { WorkflowRecordsService } from './workflow-records.service';

/** P3.6: records of a collection — read `workflows:read`, write `workflows:manage`. */
@Controller('store/workflows/records')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowRecordsController {
  constructor(
    private readonly records: WorkflowRecordsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  async list(@Query() query: WorkflowRecordsQueryDto) {
    const r = await this.records.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get(':id')
  @Permissions('store:workflows:read')
  async get(@Param('id', ParseIntPipe) id: number, @Query() query: WorkflowRecordGetQueryDto) {
    return this.responseService.success(await this.records.get(id, query));
  }

  @Post()
  @Permissions('store:workflows:manage')
  async create(@Body() dto: CreateWorkflowRecordDto) {
    return this.responseService.created(await this.records.create(dto), 'Registro creado');
  }

  @Patch(':id')
  @Permissions('store:workflows:manage')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkflowRecordDto) {
    return this.responseService.success(await this.records.update(id, dto), 'Registro actualizado');
  }

  /** Archives (never deletes) the record. */
  @Delete(':id')
  @Permissions('store:workflows:manage')
  async archive(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.records.archive(id), 'Registro archivado');
  }

  @Post(':id/files')
  @Permissions('store:workflows:manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: HARD_MAX_FILE_BYTES, files: 1 },
    }),
  )
  async uploadFile(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.responseService.created(await this.records.uploadFile(id, file), 'Archivo recibido');
  }

  @Get(':id/files/:fileId/download')
  @Permissions('store:workflows:read')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ) {
    return this.responseService.success(await this.records.downloadFile(id, fileId));
  }

  /** Same start path as a manual start, with the record as subject. */
  @Post(':id/start')
  @Permissions('store:workflows:start')
  async start(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartWorkflowOnRecordDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = idempotencyKey === undefined ? undefined : requireIdempotencyKey(idempotencyKey);
    return this.responseService.created(
      await this.records.startFlow(id, dto.definition_id, key),
      'Solicitud iniciada',
    );
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
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
import { WorkflowEngineService } from '../engine/workflow-engine.service';
import { requireIdempotencyKey } from '../dto/idempotency-key';
import {
  CancelWorkflowInstanceDto,
  ForceTransitionDto,
  StartWorkflowDto,
  WorkflowInstancesQueryDto,
} from '../dto/workflow-instance.dto';
import { HARD_MAX_FILE_BYTES } from '../../documents/documents.constants';
import { UploadWorkflowFileDto } from '../dto/upload-workflow-file.dto';
import { WorkflowFilesService } from '../files/workflow-files.service';
import {
  CreateWorkflowCommentDto,
  WorkflowCommentsQueryDto,
} from '../dto/workflow-operation.dto';
import { WorkflowCommentsService } from './workflow-comments.service';
import { WorkflowInstancesService } from './workflow-instances.service';

/** Instances: start, list/detail (read model) and admin commands. */
@Controller('store/workflows/instances')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowInstancesController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly instances: WorkflowInstancesService,
    private readonly responseService: ResponseService,
    private readonly workflowFiles: WorkflowFilesService,
    private readonly comments: WorkflowCommentsService,
  ) {}

  @Post()
  @Permissions('store:workflows:start')
  async start(
    @Body() dto: StartWorkflowDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    const result = await this.engine.start({
      definitionId: dto.definition_id,
      definitionKey: dto.definition_key,
      title: dto.title,
      data: dto.data,
      subject: dto.subject ?? null,
      locationId: dto.location_id ?? null,
      idempotencyKey: key,
    });
    return this.responseService.created(result, 'Solicitud iniciada');
  }

  // Staff with only start/task see their own requests and tasks: the service
  // applies the participation rule to everyone without `manage`.
  @Get()
  @Permissions('store:workflows:read', 'store:workflows:start', 'store:workflows:task')
  async list(@Query() query: WorkflowInstancesQueryDto) {
    const r = await this.instances.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get(':id')
  @Permissions('store:workflows:read', 'store:workflows:start', 'store:workflows:task')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.instances.get(id));
  }

  @Get(':id/comments')
  @Permissions('store:workflows:read', 'store:workflows:start', 'store:workflows:task')
  async listComments(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: WorkflowCommentsQueryDto,
  ) {
    return this.responseService.success(await this.comments.list(id, query));
  }

  @Post(':id/comments')
  @Permissions('store:workflows:read', 'store:workflows:start', 'store:workflows:task')
  async addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateWorkflowCommentDto,
  ) {
    return this.responseService.created(
      await this.comments.add(id, dto.body),
      'Comentario agregado',
    );
  }

  @Post(':id/cancel')
  @Permissions('store:workflows:manage')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelWorkflowInstanceDto,
  ) {
    const instance = await this.engine.cancel({ instanceId: id, reason: dto.reason });
    return this.responseService.updated(instance, 'Solicitud cancelada');
  }

  @Post(':id/force-transition')
  @Permissions('store:workflows:manage')
  async forceTransition(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ForceTransitionDto,
  ) {
    const result = await this.engine.transition({
      instanceId: id,
      to: dto.to,
      reason: dto.reason,
      expectedRowVersion: dto.expected_row_version,
    });
    return this.responseService.updated(result);
  }

  /** P2.7: re-queues a dead `vendix.*` action of the request (dead-letter). */
  @Post(':id/failed-actions/:actionId/retry')
  @Permissions('store:workflows:manage')
  async retryFailedAction(
    @Param('id', ParseIntPipe) id: number,
    @Param('actionId', ParseIntPipe) actionId: number,
  ) {
    return this.responseService.success(
      await this.instances.retryFailedAction(id, actionId),
      'Acción reenviada a la cola',
    );
  }

  /**
   * Adjunta un archivo a la etapa ACTUAL: `requirement_key` (requisito `upload`)
   * XOR `field_key` (campo `file` del formulario; devuelve `file_id` para que el
   * cliente lo ponga en los valores del formulario, aquí no se escribe `data`).
   */
  @Post(':id/files')
  @Permissions('store:workflows:task')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: HARD_MAX_FILE_BYTES, files: 1 },
    }),
  )
  async uploadFile(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadWorkflowFileDto,
  ) {
    const result = await this.workflowFiles.upload(id, file, dto);
    return this.responseService.created(result, 'Archivo recibido');
  }
}

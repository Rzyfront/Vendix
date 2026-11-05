import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ApiKeyAuth } from '../store/integrations/api-keys/api-key-auth.decorator';
import { WorkflowDefinitionsService } from '../store/workflows/definitions/workflow-definitions.service';
import { WorkflowEngineService } from '../store/workflows/engine/workflow-engine.service';
import { WorkflowInboxService } from '../store/workflows/inbox/workflow-inbox.service';
import { WorkflowInstancesService } from '../store/workflows/instances/workflow-instances.service';
import { requireIdempotencyKey } from '../store/workflows/dto/idempotency-key';
import { WorkflowDefinitionsQueryDto } from '../store/workflows/dto/workflow-definition.dto';
import {
  CompleteWorkflowTaskDto,
  StartWorkflowDto,
  WorkflowInstancesQueryDto,
} from '../store/workflows/dto/workflow-instance.dto';
import { WorkflowInboxQueryDto } from '../store/workflows/dto/workflow-operation.dto';

const READ = 'store:workflows:read';
const START = 'store:workflows:start';
const TASK = 'store:workflows:task';

/**
 * `/api/v1/workflows`: the API-key surface of Flujos. Thin: it calls the same
 * services as `/api/store/workflows` (the request context carries the key's
 * store and acting user, with the effective permission set). No design,
 * manage, publish or claim endpoints exist here.
 */
@Controller('v1/workflows')
@ApiKeyAuth()
export class ApiV1WorkflowsController {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly instances: WorkflowInstancesService,
    private readonly inbox: WorkflowInboxService,
    private readonly engine: WorkflowEngineService,
    private readonly responseService: ResponseService,
  ) {}

  /** Active (published) flows only, whatever `status` the caller sends. */
  @Get('definitions')
  @Permissions(READ, START)
  async listDefinitions(@Query() query: WorkflowDefinitionsQueryDto) {
    const r = await this.definitions.list({ ...query, status: 'active' });
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get('instances')
  @Permissions(READ, START, TASK)
  async listInstances(@Query() query: WorkflowInstancesQueryDto) {
    const r = await this.instances.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get('instances/:id')
  @Permissions(READ, START, TASK)
  async getInstance(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.instances.get(id));
  }

  @Post('instances')
  @Permissions(START)
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
      idempotencyKey: key,
    });
    return this.responseService.created(result, 'Solicitud iniciada');
  }

  @Get('inbox')
  @Permissions(TASK)
  async listInbox(@Query() query: WorkflowInboxQueryDto) {
    const r = await this.inbox.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Post('tasks/:id/complete')
  @Permissions(TASK)
  async completeTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteWorkflowTaskDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    const result = await this.engine.completeTask({
      taskId: id,
      outcome: dto.outcome,
      values: dto.values,
      comment: dto.comment ?? null,
      expectedRowVersion: dto.expected_row_version,
      idempotencyKey: key,
    });
    return this.responseService.updated(result, 'Tarea completada');
  }
}

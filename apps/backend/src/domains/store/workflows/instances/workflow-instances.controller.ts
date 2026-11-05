import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
      idempotencyKey: key,
    });
    return this.responseService.created(result, 'Solicitud iniciada');
  }

  @Get()
  @Permissions('store:workflows:read')
  async list(@Query() query: WorkflowInstancesQueryDto) {
    const r = await this.instances.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get(':id')
  @Permissions('store:workflows:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.instances.get(id));
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
}

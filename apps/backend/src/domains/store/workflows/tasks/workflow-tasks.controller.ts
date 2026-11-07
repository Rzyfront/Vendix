import {
  Body,
  Controller,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';

import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowEngineService } from '../engine/workflow-engine.service';
import { requireIdempotencyKey } from '../dto/idempotency-key';
import { CompleteWorkflowTaskDto } from '../dto/workflow-instance.dto';

/** Tasks: claim and complete (the engine checks the assignee itself). */
@Controller('store/workflows/tasks')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowTasksController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':id/claim')
  @Permissions('store:workflows:task')
  async claim(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(await this.engine.claimTask(id), 'Tarea tomada');
  }

  @Post(':id/complete')
  @Permissions('store:workflows:task')
  async complete(
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

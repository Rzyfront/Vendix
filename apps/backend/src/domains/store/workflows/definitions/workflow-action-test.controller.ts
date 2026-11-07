import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowActionTestDto } from '../dto/workflow-action-test.dto';
import { WorkflowActionTestService } from './workflow-action-test.service';

/** "Probar esta acción" of any action of the editor (P5.2). */
@Controller('store/workflows/actions')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowActionTestController {
  constructor(
    private readonly tester: WorkflowActionTestService,
    private readonly responseService: ResponseService,
  ) {}

  /** HTTP and connectors run for real (paid sends are throttled); the rest only preview. */
  @Post('test')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Permissions('store:workflows:design')
  async test(@Body() dto: WorkflowActionTestDto) {
    return this.responseService.success(await this.tester.test(dto));
  }
}

import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import {
  TestHttpActionDto,
  WorkflowHttpTestService,
} from './workflow-http-test.service';

/** "Probar esta acción" of the HTTP node: makes the real request. */
@Controller('store/workflows/http')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowHttpTestController {
  constructor(
    private readonly tester: WorkflowHttpTestService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('test')
  @HttpCode(200)
  @Permissions('store:workflows:design')
  async test(@Body() dto: TestHttpActionDto) {
    return this.responseService.success(await this.tester.test(dto));
  }
}

import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { TestWhatsappConnectorDto } from './connectors.dto';
import { WorkflowConnectorsService } from './connectors.service';

/** Connector registry of Flujos (P3.3, R6): status per store and tests. */
@Controller('store/workflows/connectors')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowConnectorsController {
  constructor(
    private readonly connectors: WorkflowConnectorsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:design')
  async list() {
    return this.responseService.success(await this.connectors.list());
  }

  /** Real send / real check. Body only for WhatsApp; email and DIAN take none. */
  @Post(':key/test')
  @HttpCode(200)
  @Permissions('store:workflows:manage')
  async test(@Param('key') key: string, @Body() dto: TestWhatsappConnectorDto) {
    return this.responseService.success(await this.connectors.test(key, dto));
  }
}

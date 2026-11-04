import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CrmService } from '../services/crm.service';
import { CrmPublicService } from '../services/crm-public.service';
import { ActivateCrmDto, UpdateCrmLandingDto } from '../dto/crm.dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/crm')
@UseGuards(PermissionsGuard)
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly crmPublicService: CrmPublicService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('store:crm:read')
  @Get('landing')
  async getLanding() {
    const result = await this.crmService.getLanding();
    return this.responseService.success(result);
  }

  /** F6-A: real store data (products, ecommerce base) for the editor preview. */
  @Permissions('store:crm:read')
  @Get('landing/preview-context')
  async getPreviewContext() {
    const result = await this.crmPublicService.getPreviewContext();
    return this.responseService.success(result);
  }

  @Permissions('store:crm:manage')
  @Post('activate')
  async activate(@Body() _dto: ActivateCrmDto) {
    const result = await this.crmService.activate();
    return this.responseService.success(result, 'CRM activado');
  }

  @Permissions('store:crm:manage')
  @Post('deactivate')
  async deactivate() {
    const result = await this.crmService.deactivate();
    return this.responseService.success(result, 'CRM desactivado');
  }

  @Permissions('store:crm:manage')
  @Put('landing')
  async updateLanding(@Body() dto: UpdateCrmLandingDto) {
    const result = await this.crmService.updateLanding(dto);
    return this.responseService.success(result, 'Landing guardada');
  }

  @Permissions('store:crm:manage')
  @Post('publish')
  async publish() {
    const result = await this.crmService.publish();
    return this.responseService.success(result, 'Landing publicada');
  }

  @Permissions('store:crm:read')
  @Get('generation/:jobId')
  async getGenerationStatus(@Param('jobId') jobId: string) {
    const result = await this.crmService.getGenerationJobStatus(jobId);
    return this.responseService.success(result);
  }
}

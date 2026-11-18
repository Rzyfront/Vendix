import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CrmService } from '../services/crm.service';
import { CrmPublicService } from '../services/crm-public.service';
import { ActivateCrmDto, UpdateCrmLandingDto } from '../dto/crm.dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AiJobMonitorService } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import { CrmLandingJob } from '../interfaces/crm-landing-job.interface';

@Controller('store/crm')
@UseGuards(PermissionsGuard)
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly crmPublicService: CrmPublicService,
    private readonly responseService: ResponseService,
    @InjectQueue('crm-landing')
    private readonly crmLandingQueue: Queue<CrmLandingJob>,
    // @Optional so manual construction in specs keeps working.
    @Optional()
    private readonly aiJobMonitor?: AiJobMonitorService,
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
    // QUI-1020: additive `job_id` so the shared AI job client can wait on it.
    return this.responseService.success(
      { ...result, job_id: result.last_job_id },
      'CRM activado',
    );
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
    // The service validates the tenant (same 404 as an unknown job).
    const result = await this.crmService.getGenerationJobStatus(jobId);
    // QUI-1020: additive progress/timing/failure-class fields.
    const job = await this.crmLandingQueue.getJob(jobId);
    const meta =
      job && this.aiJobMonitor
        ? this.aiJobMonitor.describe(
            job,
            result.status,
            LEGACY_AI_SOURCES.crmLanding,
            job.data?.context,
          )
        : undefined;
    return this.responseService.success({
      ...result,
      // The shared AI job client reads the outcome from `result`.
      result: job?.returnvalue ?? undefined,
      ...meta,
    });
  }
}

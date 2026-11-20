import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import {
  CRM_PIPELINE_MANAGE_PERMISSION,
  CRM_PIPELINE_READ_PERMISSION,
  CrmPipelineService,
} from './crm-pipeline.service';
import { CrmStageTemplatesService } from './crm-stage-templates.service';
import {
  ApplyCrmStageTemplateDto,
  CreateCrmOpportunityDto,
  CreateCrmPipelineDto,
  CreateCrmStageDto,
  CreateCrmStageTemplateDto,
  CrmOpportunitiesQueryDto,
  LoseCrmOpportunityDto,
  MoveCrmOpportunityDto,
  OpenCrmOpportunitiesQueryDto,
  UpdateCrmOpportunityDto,
  UpdateCrmStageDto,
  UpdateCrmStageTemplateDto,
} from './dto/crm-pipeline.dto';

/**
 * Sales pipeline (PLAN-CRM §4.6).
 *
 *   GET   /store/customers/crm/pipelines
 *   POST  /store/customers/crm/pipelines                 {name, template_id}, see-all only
 *   POST  /store/customers/crm/pipelines/:id/apply-template {template_id}, see-all only
 *   POST  /store/customers/crm/pipelines/:id/stages      see-all only
 *   PATCH /store/customers/crm/stages/:id                see-all only, no delete
 *   GET   /store/customers/crm/opportunities             board grouped by stage
 *   GET   /store/customers/crm/opportunities/open        ?customer_id, for the task form
 *   GET   /store/customers/crm/opportunities/:id
 *   POST  /store/customers/crm/opportunities
 *   PATCH /store/customers/crm/opportunities/:id
 *   POST  /store/customers/crm/opportunities/:id/move    {stage_id, sort_order?, lost_reason?}
 *   POST  /store/customers/crm/opportunities/:id/win
 *   POST  /store/customers/crm/opportunities/:id/lose    {lost_reason}
 *   DELETE /store/customers/crm/opportunities/:id        audited
 *   GET    /store/customers/crm/stage-templates          seeds "Embudo estándar"
 *   POST   /store/customers/crm/stage-templates          see-all only
 *   PATCH  /store/customers/crm/stage-templates/:id      see-all only
 *   DELETE /store/customers/crm/stage-templates/:id      see-all only
 */
@Controller('store/customers/crm')
@UseGuards(PermissionsGuard)
export class CrmPipelineController {
  constructor(
    private readonly service: CrmPipelineService,
    private readonly templates: CrmStageTemplatesService,
    private readonly response: ResponseService,
  ) {}

  @Get('pipelines')
  @Permissions(CRM_PIPELINE_READ_PERMISSION)
  async pipelines() {
    return this.response.success(await this.service.listPipelines());
  }

  @Post('pipelines')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async createPipeline(@Body() dto: CreateCrmPipelineDto) {
    return this.response.success(
      await this.templates.createPipeline(dto),
      'Pipeline creado',
    );
  }

  @Post('pipelines/:id/apply-template')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async applyTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyCrmStageTemplateDto,
  ) {
    return this.response.success(
      await this.templates.applyTemplate(id, dto.template_id),
      'Plantilla aplicada',
    );
  }

  @Get('stage-templates')
  @Permissions(CRM_PIPELINE_READ_PERMISSION)
  async stageTemplates() {
    return this.response.success(await this.templates.list());
  }

  @Post('stage-templates')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async createStageTemplate(@Body() dto: CreateCrmStageTemplateDto) {
    return this.response.success(
      await this.templates.create(dto),
      'Plantilla creada',
    );
  }

  @Patch('stage-templates/:id')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async updateStageTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrmStageTemplateDto,
  ) {
    return this.response.success(
      await this.templates.update(id, dto),
      'Plantilla actualizada',
    );
  }

  @Delete('stage-templates/:id')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async removeStageTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.templates.remove(id),
      'Plantilla eliminada',
    );
  }

  @Post('pipelines/:id/stages')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async createStage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCrmStageDto,
  ) {
    return this.response.success(
      await this.service.createStage(id, dto),
      'Etapa creada',
    );
  }

  @Patch('stages/:id')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async updateStage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrmStageDto,
  ) {
    return this.response.success(
      await this.service.updateStage(id, dto),
      'Etapa actualizada',
    );
  }

  @Get('opportunities')
  @Permissions(CRM_PIPELINE_READ_PERMISSION)
  async board(@Query() query: CrmOpportunitiesQueryDto) {
    return this.response.success(await this.service.board(query));
  }

  /** Declared before `opportunities/:id`, which would swallow `open`. */
  @Get('opportunities/open')
  @Permissions(CRM_PIPELINE_READ_PERMISSION)
  async openForCustomer(@Query() query: OpenCrmOpportunitiesQueryDto) {
    return this.response.success(await this.service.openForCustomer(query));
  }

  @Get('opportunities/:id')
  @Permissions(CRM_PIPELINE_READ_PERMISSION)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.findOne(id));
  }

  @Post('opportunities')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async create(@Body() dto: CreateCrmOpportunityDto) {
    return this.response.success(
      await this.service.create(dto),
      'Oportunidad creada',
    );
  }

  @Patch('opportunities/:id')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrmOpportunityDto,
  ) {
    return this.response.success(
      await this.service.update(id, dto),
      'Oportunidad actualizada',
    );
  }

  @Delete('opportunities/:id')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.remove(id),
      'Oportunidad eliminada',
    );
  }

  @Post('opportunities/:id/move')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async move(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveCrmOpportunityDto,
  ) {
    return this.response.success(await this.service.move(id, dto));
  }

  @Post('opportunities/:id/win')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async win(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.win(id),
      'Oportunidad ganada',
    );
  }

  @Post('opportunities/:id/lose')
  @Permissions(CRM_PIPELINE_MANAGE_PERMISSION)
  async lose(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LoseCrmOpportunityDto,
  ) {
    return this.response.success(
      await this.service.lose(id, dto.lost_reason),
      'Oportunidad perdida',
    );
  }
}

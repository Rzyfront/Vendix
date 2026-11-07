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
import { ResponseService } from '@common/responses/response.service';
import { WORKFLOW_V1_JSON_SCHEMA } from '@common/workflows/contract';

import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import {
  CreateWorkflowDefinitionDto,
  ExportWorkflowQueryDto,
  ImportWorkflowDto,
  MigrateWorkflowInstancesDto,
  PublishWorkflowDto,
  SetWorkflowEnabledDto,
  SaveWorkflowDraftDto,
  SimulateWorkflowDto,
  ValidateWorkflowDto,
  WorkflowDefinitionsQueryDto,
} from '../dto/workflow-definition.dto';
import { WorkflowPublicLinksService } from '../public-link/workflow-public-links.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowMigrationService } from './workflow-migration.service';
import { WorkflowSimulatorService } from './workflow-simulator.service';

/** Definitions: drafts, validation, publishing, versions, export/import. */
@Controller('store/workflows/definitions')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowDefinitionsController {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly simulator: WorkflowSimulatorService,
    private readonly publicLinks: WorkflowPublicLinksService,
    private readonly responseService: ResponseService,
    private readonly migrations: WorkflowMigrationService,
  ) {}

  // Static routes first: they must not be captured by `:id`.

  @Get('schema')
  @Permissions('store:workflows:read')
  schema() {
    return this.responseService.success(WORKFLOW_V1_JSON_SCHEMA);
  }

  @Post('validate')
  @Permissions('store:workflows:design')
  async validateBody(@Body() dto: ValidateWorkflowDto) {
    return this.responseService.success(
      await this.definitions.validateDefinition(dto.definition),
    );
  }

  @Post('import')
  @Permissions('store:workflows:design')
  async import(@Body() dto: ImportWorkflowDto) {
    return this.responseService.created(await this.definitions.import(dto));
  }

  // `start` lists definitions so staff can pick one to start a request.
  @Get()
  @Permissions('store:workflows:read', 'store:workflows:start')
  async list(@Query() query: WorkflowDefinitionsQueryDto) {
    const r = await this.definitions.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Post()
  @Permissions('store:workflows:design')
  async create(@Body() dto: CreateWorkflowDefinitionDto) {
    return this.responseService.created(await this.definitions.create(dto));
  }

  @Get(':id')
  @Permissions('store:workflows:read', 'store:workflows:start')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.definitions.get(id));
  }

  @Get(':id/draft')
  @Permissions('store:workflows:design')
  async getDraft(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.definitions.getDraft(id));
  }

  @Patch(':id/draft')
  @Permissions('store:workflows:design')
  async saveDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveWorkflowDraftDto,
  ) {
    return this.responseService.updated(await this.definitions.saveDraft(id, dto));
  }

  @Post(':id/validate')
  @Permissions('store:workflows:design')
  async validate(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.definitions.validate(id));
  }

  @Post(':id/simulate')
  @Permissions('store:workflows:design')
  async simulate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SimulateWorkflowDto,
  ) {
    return this.responseService.success(await this.simulator.simulate(id, dto));
  }

  @Post(':id/publish')
  @Permissions('store:workflows:design')
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishWorkflowDto,
  ) {
    return this.responseService.success(await this.definitions.publish(id, dto));
  }

  @Get(':id/versions')
  @Permissions('store:workflows:read')
  async versions(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.definitions.versions(id));
  }

  @Get(':id/versions/:version')
  @Permissions('store:workflows:read')
  async version(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.responseService.success(await this.definitions.version(id, version));
  }

  @Get(':id/export')
  @Permissions('store:workflows:design')
  async export(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ExportWorkflowQueryDto,
  ) {
    return this.responseService.success(
      await this.definitions.export(id, { version: query.version }),
    );
  }

  /** State of the public form link (the raw token is never recoverable). */
  @Get(':id/public-link')
  @Permissions('store:workflows:design')
  async publicLink(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.publicLinks.status(id));
  }

  /** Creates (or rotates) the link; the token is returned this once. */
  @Post(':id/public-link')
  @Permissions('store:workflows:design')
  async createPublicLink(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.created(
      await this.publicLinks.create(id),
      'Enlace público creado',
    );
  }

  @Delete(':id/public-link')
  @Permissions('store:workflows:design')
  async revokePublicLink(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.publicLinks.revoke(id), 'Enlace revocado');
  }

  /** P2.11: on/off switch; off starts nothing new, live requests go on. */
  @Patch(':id/enabled')
  @Permissions('store:workflows:design')
  async setEnabled(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetWorkflowEnabledDto,
  ) {
    return this.responseService.updated(
      await this.definitions.setEnabled(id, dto.enabled),
      dto.enabled ? 'Flujo encendido' : 'Flujo apagado',
    );
  }

  /** P2.8: what moving the live requests of an old version would do. */
  @Post(':id/migrations/preview')
  @Permissions('store:workflows:design')
  async previewMigration(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MigrateWorkflowInstancesDto,
  ) {
    return this.responseService.success(await this.migrations.preview(id, dto));
  }

  /** P2.8: moves the live requests of an old version to the published one. */
  @Post(':id/migrations')
  @Permissions('store:workflows:design')
  async migrate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MigrateWorkflowInstancesDto,
  ) {
    return this.responseService.success(await this.migrations.migrate(id, dto));
  }

  @Post(':id/archive')
  @Permissions('store:workflows:design')
  async archive(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(await this.definitions.archive(id));
  }

  @Post(':id/unarchive')
  @Permissions('store:workflows:design')
  async unarchive(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(await this.definitions.unarchive(id));
  }
}

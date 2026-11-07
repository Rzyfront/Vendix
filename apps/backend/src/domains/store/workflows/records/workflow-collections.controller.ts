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
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowCollectionsService } from './workflow-collections.service';
import {
  CreateWorkflowCollectionDto,
  UpdateWorkflowCollectionDto,
  WorkflowCollectionsQueryDto,
} from './workflow-records.dto';

/** P3.6: custom collections (design) — read `workflows:read`, write `workflows:design`. */
@Controller('store/workflows/collections')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowCollectionsController {
  constructor(
    private readonly collections: WorkflowCollectionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:read')
  async list(@Query() query: WorkflowCollectionsQueryDto) {
    return this.responseService.success(await this.collections.list(query));
  }

  @Get(':id')
  @Permissions('store:workflows:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.collections.get(id));
  }

  @Post()
  @Permissions('store:workflows:design')
  async create(@Body() dto: CreateWorkflowCollectionDto) {
    return this.responseService.created(await this.collections.create(dto), 'Colección creada');
  }

  @Patch(':id')
  @Permissions('store:workflows:design')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkflowCollectionDto) {
    return this.responseService.success(await this.collections.update(id, dto), 'Colección actualizada');
  }

  /** Archives (never deletes) the collection. */
  @Delete(':id')
  @Permissions('store:workflows:design')
  async archive(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.collections.archive(id), 'Colección archivada');
  }
}

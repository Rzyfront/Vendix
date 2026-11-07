import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import {
  CreateWorkflowSecretDto,
  UpdateWorkflowSecretDto,
} from './workflow-secrets.dto';
import { WorkflowSecretsService } from './workflow-secrets.service';

/** Store secrets for `{{secrets.NAME}}` in the HTTP node. Values are never returned. */
@Controller('store/workflows/secrets')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowSecretsController {
  constructor(
    private readonly secrets: WorkflowSecretsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:workflows:design')
  async list() {
    return this.responseService.success(await this.secrets.list());
  }

  @Post()
  @Permissions('store:workflows:manage')
  async create(@Body() dto: CreateWorkflowSecretDto) {
    return this.responseService.created(
      await this.secrets.create(dto),
      'Secreto guardado. Su valor no se vuelve a mostrar.',
    );
  }

  @Put(':id')
  @Permissions('store:workflows:manage')
  async replace(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkflowSecretDto,
  ) {
    return this.responseService.updated(
      await this.secrets.replace(id, dto),
      'Secreto actualizado',
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions('store:workflows:manage')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(
      await this.secrets.remove(id),
      'Secreto eliminado',
    );
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

import { ResponseService } from '../../common/responses/response.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ReceivedDocumentContextQueryDto } from './dto/received-document-context.dto';
import {
  CreateDocumentReceptionConnectionDto,
  DocumentReceptionConnectionQueryDto,
  UpdateDocumentReceptionConnectionDto,
} from './dto/document-reception-connection.dto';
import { ManualDocumentReceptionSyncDto } from './dto/document-reception-sync.dto';
import { DocumentReceptionConnectionsService } from './services/document-reception-connections.service';
import { DocumentReceptionManualSyncService } from './services/document-reception-manual-sync.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';

/** Collection query preserves bounded pagination and validates the selected store. */
export class OrganizationDocumentReceptionConnectionsQueryDto extends DocumentReceptionConnectionQueryDto implements ReceivedDocumentContextQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;
}

const CONFIGURE_PERMISSION = 'organization:invoicing:received:connections:configure';
const SYNC_PERMISSION = 'organization:invoicing:received:connections:sync';

@Controller('organization/invoicing/received-documents/connections')
@UseGuards(PermissionsGuard)
export class OrganizationDocumentReceptionConnectionsController {
  constructor(
    private readonly connections: DocumentReceptionConnectionsService,
    private readonly manualSync: DocumentReceptionManualSyncService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
  ) {}

  @Get()
  @Permissions(CONFIGURE_PERMISSION)
  async list(@Query() query: OrganizationDocumentReceptionConnectionsQueryDto) {
    const context = await this.contexts.resolveOrganization(query.store_id);
    const result = await this.connections.list(context, query);
    return this.responses.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Conexiones de recepción obtenidas',
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions(CONFIGURE_PERMISSION)
  async create(
    @Body() dto: CreateDocumentReceptionConnectionDto,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.created(
      await this.connections.create(context, dto),
      'Conexión de recepción creada',
    );
  }

  @Get(':id/runs')
  @Permissions(CONFIGURE_PERMISSION)
  async listRuns(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: OrganizationDocumentReceptionConnectionsQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(query.store_id);
    const result = await this.connections.listRuns(context, id, query);
    return this.responses.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Ejecuciones de recepción obtenidas',
    );
  }

  @Get(':id')
  @Permissions(CONFIGURE_PERMISSION)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.success(
      await this.connections.findOne(context, id),
      'Conexión de recepción obtenida',
    );
  }

  @Patch(':id')
  @Permissions(CONFIGURE_PERMISSION)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDocumentReceptionConnectionDto,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.updated(
      await this.connections.update(context, id, dto),
      'Conexión de recepción actualizada',
    );
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions(SYNC_PERMISSION)
  async sync(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ManualDocumentReceptionSyncDto,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.success(
      await this.manualSync.request(context, id, dto),
      'Sincronización de recepción solicitada',
    );
  }

  @Post(':id/runs/:runId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions(SYNC_PERMISSION)
  async retry(
    @Param('id', ParseIntPipe) id: number,
    @Param('runId', ParseIntPipe) runId: number,
    @Query() scope: ReceivedDocumentContextQueryDto,
  ) {
    const context = await this.contexts.resolveOrganization(scope.store_id);
    return this.responses.success(
      await this.manualSync.retry(context, id, runId),
      'Reintento de recepción solicitado',
    );
  }
}

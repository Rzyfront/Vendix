import {
  BadRequestException,
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
import { DocumentReceptionConnectionsService } from './services/document-reception-connections.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';

/** Bounded collection query that combines paging with the optional store override. */
export class DocumentReceptionConnectionsQueryDto extends DocumentReceptionConnectionQueryDto implements ReceivedDocumentContextQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;
}

const CONFIGURE_PERMISSION = 'invoicing:received:connections:configure';

@Controller('store/invoicing/received-documents/connections')
@UseGuards(PermissionsGuard)
export class StoreDocumentReceptionConnectionsController {
  constructor(
    private readonly connections: DocumentReceptionConnectionsService,
    private readonly contexts: ReceivedDocumentsContextService,
    private readonly responses: ResponseService,
  ) {}

  @Get()
  @Permissions(CONFIGURE_PERMISSION)
  async list(@Query() query: DocumentReceptionConnectionsQueryDto) {
    this.rejectStoreOverride(query.store_id);
    const context = await this.contexts.resolveStore();
    const result = await this.connections.list(context, {
      page: query.page,
      limit: query.limit,
    });
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
    this.rejectStoreOverride(scope.store_id);
    const context = await this.contexts.resolveStore();
    return this.responses.created(
      await this.connections.create(context, dto),
      'Conexión de recepción creada',
    );
  }

  @Get(':id/runs')
  @Permissions(CONFIGURE_PERMISSION)
  async listRuns(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DocumentReceptionConnectionsQueryDto,
  ) {
    this.rejectStoreOverride(query.store_id);
    const context = await this.contexts.resolveStore();
    const result = await this.connections.listRuns(context, id, {
      page: query.page,
      limit: query.limit,
    });
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
    this.rejectStoreOverride(scope.store_id);
    const context = await this.contexts.resolveStore();
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
    this.rejectStoreOverride(scope.store_id);
    const context = await this.contexts.resolveStore();
    return this.responses.updated(
      await this.connections.update(context, id, dto),
      'Conexión de recepción actualizada',
    );
  }

  private rejectStoreOverride(storeId?: number): void {
    if (storeId !== undefined) {
      throw new BadRequestException(
        'La tienda se resuelve desde el contexto autenticado.',
      );
    }
  }
}

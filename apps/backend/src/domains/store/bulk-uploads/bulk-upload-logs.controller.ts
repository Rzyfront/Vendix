import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { BulkUploadLogsService } from './bulk-upload-logs.service';
import { BulkUploadJobsService } from './bulk-upload-jobs.service';
import {
  BULK_UPLOAD_ANY_PERMISSION,
  BULK_UPLOAD_TYPE_PERMISSIONS,
  BulkUploadType,
} from './bulk-upload-log.types';
import {
  CheckBulkUploadDuplicateDto,
  QueryBulkUploadLogsDto,
  RegisterBulkUploadDto,
} from './dto/bulk-upload-log.dto';
import { QueryActiveBulkJobDto } from './dto/bulk-upload-job.dto';

/**
 * QUI-1004 — historial de cargas masivas de la tienda del contexto.
 *
 * El historial es solo lectura (`store:bulk_uploads:read`). Consultar si un
 * archivo ya se cargó y registrar una carga hecha en el navegador exigen el
 * permiso de ESA carga (`BULK_UPLOAD_TYPE_PERMISSIONS`): el decorador deja
 * pasar a quien tenga alguno y `assertUploadPermission` exige el del tipo.
 */
@Controller('store/bulk-uploads')
@UseGuards(PermissionsGuard)
export class BulkUploadLogsController {
  private readonly logger = new Logger(BulkUploadLogsController.name);

  constructor(
    private readonly bulkUploadLogsService: BulkUploadLogsService,
    private readonly responseService: ResponseService,
    private readonly bulkUploadJobsService: BulkUploadJobsService,
  ) {}

  @ApiOperation({
    summary:
      'Listar el historial de cargas masivas de la tienda, filtrable por tipo y por fecha',
  })
  @Get()
  @Permissions('store:bulk_uploads:read')
  async list(@Query() query: QueryBulkUploadLogsDto) {
    const result = await this.bulkUploadLogsService.list(query);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Historial de cargas masivas',
    );
  }

  @ApiOperation({
    summary:
      'Avisar si un archivo ya se cargó en esta tienda para el mismo tipo de carga',
  })
  @Post('check-duplicate')
  @Permissions(...BULK_UPLOAD_ANY_PERMISSION)
  async checkDuplicate(
    @Body() dto: CheckBulkUploadDuplicateDto,
    @Req() request: any,
  ) {
    this.assertUploadPermission(request, dto.upload_type);
    const duplicate = await this.bulkUploadLogsService.findDuplicate(
      dto.upload_type,
      dto.file_hash,
    );
    return this.responseService.success(
      { duplicate_of: duplicate },
      duplicate ? 'El archivo ya se cargó antes' : 'Archivo nuevo',
    );
  }

  @ApiOperation({
    summary:
      'Registrar una carga masiva que el navegador procesó (carga masiva de compras)',
  })
  @Post()
  @Permissions(...BULK_UPLOAD_ANY_PERMISSION)
  async register(@Body() dto: RegisterBulkUploadDto, @Req() request: any) {
    this.assertUploadPermission(request, dto.upload_type);
    const row = await this.bulkUploadLogsService.register(dto);
    return this.responseService.created(
      { id: row.id, status: row.status },
      'Carga masiva registrada',
    );
  }

  // QUI-1009 — trabajos durables. Van ANTES de `:id`. Cada ruta exige el
  // permiso del tipo de la carga (`assertUploadPermission`); la fila se lee con
  // la tienda del contexto, así que una carga ajena responde 404.

  @ApiOperation({
    summary: 'Carga masiva activa (en cola o en curso) de la tienda para un tipo',
  })
  @Get('jobs/active')
  @Permissions(...BULK_UPLOAD_ANY_PERMISSION)
  async activeJob(@Query() query: QueryActiveBulkJobDto, @Req() request: any) {
    this.assertUploadPermission(request, query.upload_type);
    const job = await this.bulkUploadJobsService.getActive(query.upload_type);
    return this.responseService.success(job, 'Carga masiva activa');
  }

  @ApiOperation({ summary: 'Estado y avance de un trabajo de carga masiva' })
  @Get('jobs/:id')
  @Permissions(...BULK_UPLOAD_ANY_PERMISSION)
  async jobStatus(@Param('id', ParseIntPipe) id: number, @Req() request: any) {
    this.assertUploadPermission(
      request,
      await this.bulkUploadJobsService.getType(id),
    );
    const job = await this.bulkUploadJobsService.getView(id);
    return this.responseService.success(job, 'Trabajo de carga masiva');
  }

  @ApiOperation({ summary: 'Resultados por fila de un trabajo de carga masiva' })
  @Get('jobs/:id/results')
  @Permissions(...BULK_UPLOAD_ANY_PERMISSION)
  async jobResults(@Param('id', ParseIntPipe) id: number, @Req() request: any) {
    this.assertUploadPermission(
      request,
      await this.bulkUploadJobsService.getType(id),
    );
    const results = await this.bulkUploadJobsService.getResults(id);
    return this.responseService.success(results, 'Resultados de la carga masiva');
  }

  @ApiOperation({
    summary: 'Reintentar un trabajo de carga masiva que falló por un problema técnico',
  })
  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions(...BULK_UPLOAD_ANY_PERMISSION)
  async retryJob(@Param('id', ParseIntPipe) id: number, @Req() request: any) {
    this.assertUploadPermission(
      request,
      await this.bulkUploadJobsService.getType(id),
    );
    const job = await this.bulkUploadJobsService.retry(id);
    return this.responseService.success(job, 'Carga masiva reintentada');
  }

  @ApiOperation({ summary: 'Ver una carga masiva del historial de la tienda' })
  @Get(':id')
  @Permissions('store:bulk_uploads:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const row = await this.bulkUploadLogsService.findOne(id);
    return this.responseService.success(row, 'Carga masiva');
  }

  /** Calco de `assertNamedPermission` (products-bulk-edit.controller). */
  private assertUploadPermission(request: any, type: BulkUploadType): void {
    const roles: string[] = request?.user?.roles ?? [];
    if (roles.includes(UserRole.SUPER_ADMIN)) return;
    const required = BULK_UPLOAD_TYPE_PERMISSIONS[type];
    const granted: Array<{ name?: string; status?: string }> =
      request?.user?.permissions ?? [];
    const hasIt = granted.some(
      (perm) => perm?.name === required && perm?.status === 'active',
    );
    if (!hasIt) {
      this.logger.warn(
        `Bloqueado: falta '${required}' para cargas '${type}' (user=${request?.user?.id ?? 'desconocido'})`,
      );
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }
  }
}

import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuditService, AuditAction, AuditResource } from './audit.service';

@ApiTags('Audit')
@Controller('audit')
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @ApiOperation({
    summary: 'Obtener logs de auditoría',
    description: 'Consulta los logs de auditoría con filtros opcionales',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs obtenidos exitosamente',
  })
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('storeId') storeId?: string, // ✅ Nuevo parámetro storeId
    @Query('action') action?: AuditAction,
    @Query('resource') resource?: AuditResource,
    @Query('resourceId') resourceId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const filters: any = {};

    if (userId) filters.userId = parseInt(userId);
    if (storeId) filters.storeId = parseInt(storeId); // ✅ Procesar storeId
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (resourceId) filters.resourceId = parseInt(resourceId);
    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);
    if (organizationId) filters.organizationId = parseInt(organizationId);

    return await this.auditService.getAuditLogs(filters);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Obtener estadísticas de auditoría',
    description: 'Obtiene estadísticas generales de los logs de auditoría',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Estadísticas obtenidas exitosamente',
  })
  async getAuditStats(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    return await this.auditService.getAuditStats(from, to);
  }
}

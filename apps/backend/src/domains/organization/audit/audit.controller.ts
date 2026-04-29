import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpStatus,
  Res,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProduces,
} from '@nestjs/swagger';
import { Response } from 'express';
import { OrganizationAuditService } from './audit.service';
import {
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';
import { ResponseService } from '@common/responses/response.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Audit')
@Controller('organization/audit')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
@ApiBearerAuth()
export class AuditController {
  constructor(
    private readonly auditService: OrganizationAuditService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('logs')
  @ApiOperation({
    summary: 'Get organization audit logs',
    description:
      'Retrieve audit logs for the organization with optional filters',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit logs retrieved successfully',
  })
  @Permissions('organization:audit:read')
  async getAuditLogs(
    @Query('user_id') user_id?: string,
    @Query('store_id') store_id?: string,
    @Query('action') action?: AuditAction,
    @Query('resource') resource?: AuditResource,
    @Query('resource_id') resource_id?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: any = {};

    if (user_id) filters.user_id = parseInt(user_id);
    if (store_id) filters.store_id = parseInt(store_id);
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (resource_id) filters.resource_id = parseInt(resource_id);
    if (from_date) filters.from_date = new Date(from_date);
    if (to_date) filters.to_date = new Date(to_date);
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const result = await this.auditService.getAuditLogs(filters);
    const limitNum = limit ? parseInt(limit) : 50;
    const offsetNum = offset ? parseInt(offset) : 0;
    const page = offsetNum ? offsetNum / limitNum + 1 : 1;

    return this.responseService.paginated(
      result.data,
      page,
      limitNum,
      result.total,
    );
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get audit statistics',
    description: 'Retrieve general statistics from audit logs',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit statistics retrieved successfully',
  })
  @Permissions('organization:audit:read')
  async getAuditStats(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const stats = await this.auditService.getAuditStats(from, to);
    return this.responseService.success(
      stats,
      'Audit statistics retrieved successfully',
    );
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export audit logs',
    description: 'Export audit logs as CSV or Excel',
  })
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit logs exported successfully',
  })
  @Permissions('organization:audit:read')
  @Header('Content-Type', 'text/csv')
  async exportAuditLogs(
    @Query('user_id') user_id?: string,
    @Query('store_id') store_id?: string,
    @Query('action') action?: AuditAction,
    @Query('resource') resource?: AuditResource,
    @Query('resource_id') resource_id?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
    @Query('format') format?: string,
    @Res() res?: Response,
  ) {
    const filters: any = {};

    if (user_id) filters.user_id = parseInt(user_id);
    if (store_id) filters.store_id = parseInt(store_id);
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (resource_id) filters.resource_id = parseInt(resource_id);
    if (from_date) filters.from_date = new Date(from_date);
    if (to_date) filters.to_date = new Date(to_date);

    const logs = await this.auditService.getAuditLogsForExport(filters);

    const headers = [
      'ID',
      'Fecha',
      'Usuario',
      'Email',
      'Acción',
      'Recurso',
      'ID Recurso',
      'IP',
      'Valores Anteriores',
      'Nuevos Valores',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.created_at.toISOString(),
      log.users ? `${log.users.first_name} ${log.users.last_name}` : 'Sistema',
      log.users?.email || '',
      log.action,
      log.resource,
      log.resource_id || '',
      log.ip_address || '',
      log.old_values ? JSON.stringify(log.old_values) : '',
      log.new_values ? JSON.stringify(log.new_values) : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');

    const filename = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;

    res?.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res?.setHeader('Content-Type', 'text/csv; charset=utf-8');

    return res?.send(csvContent);
  }
}

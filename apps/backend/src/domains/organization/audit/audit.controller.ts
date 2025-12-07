import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuditService, AuditAction, AuditResource } from './audit.service';
import { ResponseService } from '@common/responses/response.service';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Admin Audit')
@Controller('organization/admin/audit')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
@ApiBearerAuth()
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly responseService: ResponseService,
  ) { }

  @Get('logs')
  @ApiOperation({
    summary: 'Get audit logs',
    description: 'Retrieve audit logs with optional filters',
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

    const logs = await this.auditService.getAuditLogs(filters);
    return this.responseService.success(
      logs,
      'Audit logs retrieved successfully',
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
}

import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuditService, AuditAction, AuditResource } from './audit.service';
import { ResponseService } from '../../common/responses/response.service';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';

@ApiTags('Admin Audit')
@Controller('admin/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@ApiBearerAuth()
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('logs')
  @ApiOperation({
    summary: 'Get audit logs',
    description: 'Retrieve audit logs with optional filters',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit logs retrieved successfully',
  })
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('storeId') storeId?: string,
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
    if (storeId) filters.storeId = parseInt(storeId);
    if (action) filters.action = action;
    if (resource) filters.resource = resource;
    if (resourceId) filters.resourceId = parseInt(resourceId);
    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);
    if (organizationId) filters.organizationId = parseInt(organizationId);

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

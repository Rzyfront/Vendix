import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuditService, AuditAction } from '../audit/audit.service';

@ApiTags('Security Logs')
@Controller('security-logs')
@ApiBearerAuth()
export class SecurityLogsController {
  constructor(private readonly auditService: AuditService) {}

  @Get('failed-logins')
  @ApiOperation({
    summary: 'Obtener logs de login fallidos',
    description:
      'Consulta todos los eventos de login fallidos con detalles de seguridad',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs obtenidos exitosamente',
  })
  async getFailedLoginLogs(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: any = {
      action: AuditAction.LOGIN_FAILED,
      limit: limit ? parseInt(limit) : 50,
    };

    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);

    return await this.auditService.getAuditLogs(filters);
  }

  @Get('account-locks')
  @ApiOperation({
    summary: 'Obtener logs de bloqueo de cuentas',
    description:
      'Consulta todos los eventos de bloqueo de cuentas por intentos fallidos',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs obtenidos exitosamente',
  })
  async getAccountLockLogs(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const filters: any = {
      action: AuditAction.ACCOUNT_LOCKED,
    };

    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);

    return await this.auditService.getAuditLogs(filters);
  }

  @Get('password-changes')
  @ApiOperation({
    summary: 'Obtener logs de cambios de contraseña',
    description: 'Consulta todos los eventos de cambio de contraseña',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs obtenidos exitosamente',
  })
  async getPasswordChangeLogs(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const filters: any = {
      action: AuditAction.PASSWORD_CHANGE,
    };

    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);

    return await this.auditService.getAuditLogs(filters);
  }

  @Get('suspicious-activity')
  @ApiOperation({
    summary: 'Obtener logs de actividad sospechosa',
    description: 'Consulta eventos de seguridad que requieren atención',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs obtenidos exitosamente',
  })
  async getSuspiciousActivityLogs(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const filters: any = {
      action: AuditAction.SUSPICIOUS_ACTIVITY,
    };

    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);

    return await this.auditService.getAuditLogs(filters);
  }

  @Get('security-summary')
  @ApiOperation({
    summary: 'Obtener resumen de seguridad',
    description: 'Obtiene estadísticas generales de eventos de seguridad',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resumen obtenido exitosamente',
  })
  async getSecuritySummary(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const [failedLogins, accountLocks, passwordChanges] = await Promise.all([
      this.auditService.getAuditLogs({
        action: AuditAction.LOGIN_FAILED,
        fromDate: from,
        toDate: to,
      }),
      this.auditService.getAuditLogs({
        action: AuditAction.ACCOUNT_LOCKED,
        fromDate: from,
        toDate: to,
      }),
      this.auditService.getAuditLogs({
        action: AuditAction.PASSWORD_CHANGE,
        fromDate: from,
        toDate: to,
      }),
    ]);

    return {
      summary: {
        failedLogins: failedLogins.length,
        accountLocks: accountLocks.length,
        passwordChanges: passwordChanges.length,
        totalSecurityEvents:
          failedLogins.length + accountLocks.length + passwordChanges.length,
      },
      period: {
        from: from || 'All time',
        to: to || 'Now',
      },
    };
  }
}

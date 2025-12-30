import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SuperAdminAuditService } from '../superadmin/audit/audit.service';
import { AuditAction } from '../../common/audit/audit.service';
import { ResponseService } from '@common/responses/response.service';

@ApiTags('Security Logs')
@Controller('security-logs')
@ApiBearerAuth()
export class SecurityLogsController {
  constructor(
    private readonly auditService: SuperAdminAuditService,
    private readonly responseService: ResponseService,
  ) { }

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
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: any = {
        action: AuditAction.LOGIN_FAILED,
        limit: limit ? parseInt(limit) : 50,
      };

      if (from_date) filters.from_date = new Date(from_date);
      if (to_date) filters.to_date = new Date(to_date);

      const logs = await this.auditService.getAuditLogs(filters);
      return this.responseService.success(
        logs,
        'Logs de login fallidos obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener logs de login fallidos',
        error.message,
      );
    }
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
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    try {
      const filters: any = {
        action: AuditAction.ACCOUNT_LOCKED,
      };

      if (from_date) filters.from_date = new Date(from_date);
      if (to_date) filters.to_date = new Date(to_date);

      const logs = await this.auditService.getAuditLogs(filters);
      return this.responseService.success(
        logs,
        'Logs de bloqueo de cuentas obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener logs de bloqueo de cuentas',
        error.message,
      );
    }
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
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    try {
      const filters: any = {
        action: AuditAction.PASSWORD_CHANGE,
      };

      if (from_date) filters.from_date = new Date(from_date);
      if (to_date) filters.to_date = new Date(to_date);

      const logs = await this.auditService.getAuditLogs(filters);
      return this.responseService.success(
        logs,
        'Logs de cambios de contraseña obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener logs de cambios de contraseña',
        error.message,
      );
    }
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
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    try {
      const filters: any = {
        action: AuditAction.SUSPICIOUS_ACTIVITY,
      };

      if (from_date) filters.from_date = new Date(from_date);
      if (to_date) filters.to_date = new Date(to_date);

      const logs = await this.auditService.getAuditLogs(filters);
      return this.responseService.success(
        logs,
        'Logs de actividad sospechosa obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener logs de actividad sospechosa',
        error.message,
      );
    }
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
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    const from = from_date ? new Date(from_date) : undefined;
    const to = to_date ? new Date(to_date) : undefined;

    try {
      const [failedLogins, accountLocks, passwordChanges] = await Promise.all([
        this.auditService.getAuditLogs({
          action: AuditAction.LOGIN_FAILED,
          from_date: from,
          to_date: to,
        }),
        this.auditService.getAuditLogs({
          action: AuditAction.ACCOUNT_LOCKED,
          from_date: from,
          to_date: to,
        }),
        this.auditService.getAuditLogs({
          action: AuditAction.PASSWORD_CHANGE,
          from_date: from,
          to_date: to,
        }),
      ]);

      const summary = {
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

      return this.responseService.success(
        summary,
        'Resumen de seguridad obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener resumen de seguridad',
        error.message,
      );
    }
  }
}

"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityLogsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const audit_service_1 = require("../audit/audit.service");
const response_service_1 = require("../../common/responses/response.service");
let SecurityLogsController = class SecurityLogsController {
    constructor(auditService, responseService) {
        this.auditService = auditService;
        this.responseService = responseService;
    }
    async getFailedLoginLogs(fromDate, toDate, limit) {
        try {
            const filters = {
                action: audit_service_1.AuditAction.LOGIN_FAILED,
                limit: limit ? parseInt(limit) : 50,
            };
            if (fromDate)
                filters.fromDate = new Date(fromDate);
            if (toDate)
                filters.toDate = new Date(toDate);
            const logs = await this.auditService.getAuditLogs(filters);
            return this.responseService.success(logs, 'Logs de login fallidos obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener logs de login fallidos', error.message);
        }
    }
    async getAccountLockLogs(fromDate, toDate) {
        try {
            const filters = {
                action: audit_service_1.AuditAction.ACCOUNT_LOCKED,
            };
            if (fromDate)
                filters.fromDate = new Date(fromDate);
            if (toDate)
                filters.toDate = new Date(toDate);
            const logs = await this.auditService.getAuditLogs(filters);
            return this.responseService.success(logs, 'Logs de bloqueo de cuentas obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener logs de bloqueo de cuentas', error.message);
        }
    }
    async getPasswordChangeLogs(fromDate, toDate) {
        try {
            const filters = {
                action: audit_service_1.AuditAction.PASSWORD_CHANGE,
            };
            if (fromDate)
                filters.fromDate = new Date(fromDate);
            if (toDate)
                filters.toDate = new Date(toDate);
            const logs = await this.auditService.getAuditLogs(filters);
            return this.responseService.success(logs, 'Logs de cambios de contraseña obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener logs de cambios de contraseña', error.message);
        }
    }
    async getSuspiciousActivityLogs(fromDate, toDate) {
        try {
            const filters = {
                action: audit_service_1.AuditAction.SUSPICIOUS_ACTIVITY,
            };
            if (fromDate)
                filters.fromDate = new Date(fromDate);
            if (toDate)
                filters.toDate = new Date(toDate);
            const logs = await this.auditService.getAuditLogs(filters);
            return this.responseService.success(logs, 'Logs de actividad sospechosa obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener logs de actividad sospechosa', error.message);
        }
    }
    async getSecuritySummary(fromDate, toDate) {
        const from = fromDate ? new Date(fromDate) : undefined;
        const to = toDate ? new Date(toDate) : undefined;
        try {
            const [failedLogins, accountLocks, passwordChanges] = await Promise.all([
                this.auditService.getAuditLogs({
                    action: audit_service_1.AuditAction.LOGIN_FAILED,
                    fromDate: from,
                    toDate: to,
                }),
                this.auditService.getAuditLogs({
                    action: audit_service_1.AuditAction.ACCOUNT_LOCKED,
                    fromDate: from,
                    toDate: to,
                }),
                this.auditService.getAuditLogs({
                    action: audit_service_1.AuditAction.PASSWORD_CHANGE,
                    fromDate: from,
                    toDate: to,
                }),
            ]);
            const summary = {
                summary: {
                    failedLogins: failedLogins.length,
                    accountLocks: accountLocks.length,
                    passwordChanges: passwordChanges.length,
                    totalSecurityEvents: failedLogins.length + accountLocks.length + passwordChanges.length,
                },
                period: {
                    from: from || 'All time',
                    to: to || 'Now',
                },
            };
            return this.responseService.success(summary, 'Resumen de seguridad obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener resumen de seguridad', error.message);
        }
    }
};
exports.SecurityLogsController = SecurityLogsController;
__decorate([
    (0, common_1.Get)('failed-logins'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener logs de login fallidos',
        description: 'Consulta todos los eventos de login fallidos con detalles de seguridad',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Logs obtenidos exitosamente',
    }),
    __param(0, (0, common_1.Query)('fromDate')),
    __param(1, (0, common_1.Query)('toDate')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], SecurityLogsController.prototype, "getFailedLoginLogs", null);
__decorate([
    (0, common_1.Get)('account-locks'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener logs de bloqueo de cuentas',
        description: 'Consulta todos los eventos de bloqueo de cuentas por intentos fallidos',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Logs obtenidos exitosamente',
    }),
    __param(0, (0, common_1.Query)('fromDate')),
    __param(1, (0, common_1.Query)('toDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SecurityLogsController.prototype, "getAccountLockLogs", null);
__decorate([
    (0, common_1.Get)('password-changes'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener logs de cambios de contraseña',
        description: 'Consulta todos los eventos de cambio de contraseña',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Logs obtenidos exitosamente',
    }),
    __param(0, (0, common_1.Query)('fromDate')),
    __param(1, (0, common_1.Query)('toDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SecurityLogsController.prototype, "getPasswordChangeLogs", null);
__decorate([
    (0, common_1.Get)('suspicious-activity'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener logs de actividad sospechosa',
        description: 'Consulta eventos de seguridad que requieren atención',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Logs obtenidos exitosamente',
    }),
    __param(0, (0, common_1.Query)('fromDate')),
    __param(1, (0, common_1.Query)('toDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SecurityLogsController.prototype, "getSuspiciousActivityLogs", null);
__decorate([
    (0, common_1.Get)('security-summary'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener resumen de seguridad',
        description: 'Obtiene estadísticas generales de eventos de seguridad',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Resumen obtenido exitosamente',
    }),
    __param(0, (0, common_1.Query)('fromDate')),
    __param(1, (0, common_1.Query)('toDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SecurityLogsController.prototype, "getSecuritySummary", null);
exports.SecurityLogsController = SecurityLogsController = __decorate([
    (0, swagger_1.ApiTags)('Security Logs'),
    (0, common_1.Controller)('security-logs'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [audit_service_1.AuditService,
        response_service_1.ResponseService])
], SecurityLogsController);
//# sourceMappingURL=security-logs.controller.js.map
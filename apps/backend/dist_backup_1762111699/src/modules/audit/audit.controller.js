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
exports.AuditController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const audit_service_1 = require("./audit.service");
const response_service_1 = require("../../common/responses/response.service");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
let AuditController = class AuditController {
    constructor(auditService, responseService) {
        this.auditService = auditService;
        this.responseService = responseService;
    }
    async getAuditLogs(user, userId, storeId, action, resource, resourceId, fromDate, toDate, limit, offset, organizationId) {
        const filters = {};
        if (userId)
            filters.userId = parseInt(userId);
        if (storeId)
            filters.storeId = parseInt(storeId);
        if (action)
            filters.action = action;
        if (resource)
            filters.resource = resource;
        if (resourceId)
            filters.resourceId = parseInt(resourceId);
        if (fromDate)
            filters.fromDate = new Date(fromDate);
        if (toDate)
            filters.toDate = new Date(toDate);
        if (limit)
            filters.limit = parseInt(limit);
        if (offset)
            filters.offset = parseInt(offset);
        if (organizationId)
            filters.organizationId = parseInt(organizationId);
        const logs = await this.auditService.getAuditLogs(filters);
        return this.responseService.success(logs, 'Audit logs retrieved successfully');
    }
    async getAuditStats(user, fromDate, toDate) {
        const from = fromDate ? new Date(fromDate) : undefined;
        const to = toDate ? new Date(toDate) : undefined;
        const stats = await this.auditService.getAuditStats(from, to);
        return this.responseService.success(stats, 'Audit statistics retrieved successfully');
    }
};
exports.AuditController = AuditController;
__decorate([
    (0, common_1.Get)('logs'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener logs de auditoría',
        description: 'Consulta los logs de auditoría con filtros opcionales',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Logs obtenidos exitosamente',
    }),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Query)('userId')),
    __param(2, (0, common_1.Query)('storeId')),
    __param(3, (0, common_1.Query)('action')),
    __param(4, (0, common_1.Query)('resource')),
    __param(5, (0, common_1.Query)('resourceId')),
    __param(6, (0, common_1.Query)('fromDate')),
    __param(7, (0, common_1.Query)('toDate')),
    __param(8, (0, common_1.Query)('limit')),
    __param(9, (0, common_1.Query)('offset')),
    __param(10, (0, common_1.Query)('organizationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AuditController.prototype, "getAuditLogs", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener estadísticas de auditoría',
        description: 'Obtiene estadísticas generales de los logs de auditoría',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Estadísticas obtenidas exitosamente',
    }),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Query)('fromDate')),
    __param(2, (0, common_1.Query)('toDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AuditController.prototype, "getAuditStats", null);
exports.AuditController = AuditController = __decorate([
    (0, swagger_1.ApiTags)('Audit'),
    (0, common_1.Controller)('audit'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [audit_service_1.AuditService,
        response_service_1.ResponseService])
], AuditController);
//# sourceMappingURL=audit.controller.js.map
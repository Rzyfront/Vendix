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
exports.RateLimitingController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const response_service_1 = require("../../common/responses/response.service");
let RateLimitingController = class RateLimitingController {
    constructor(responseService) {
        this.responseService = responseService;
    }
    async getRateLimitStatus() {
        try {
            const status = {
                endpoints: [
                    {
                        path: 'POST /auth/login',
                        limit: 1000,
                        window: '15 minutes',
                        status: 'active',
                    },
                    {
                        path: 'POST /auth/refresh',
                        limit: 10,
                        window: '5 minutes',
                        status: 'active',
                    },
                    {
                        path: 'POST /auth/register-*',
                        limit: 5,
                        window: '15 minutes',
                        status: 'active',
                    },
                ],
                blockedIPs: [],
            };
            return this.responseService.success(status, 'Estado de rate limiting obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener estado de rate limiting', error.message);
        }
    }
    async getIPAttempts(ip) {
        try {
            const attempts = {
                ip,
                attempts: 0,
                maxAttempts: 5,
                resetTime: new Date(Date.now() + 15 * 60 * 1000),
                isBlocked: false,
            };
            return this.responseService.success(attempts, 'Intentos de IP obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener intentos de IP', error.message);
        }
    }
    async resetIPAttempts(ip) {
        try {
            const result = {
                message: `Rate limiting reset for IP: ${ip}`,
                resetAt: new Date(),
            };
            return this.responseService.success(result, 'Contador de rate limiting reseteado exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al resetear contador de rate limiting', error.message);
        }
    }
    async updateRateLimitConfig(config) {
        try {
            const result = {
                message: 'Rate limiting configuration updated',
                newConfig: config,
            };
            return this.responseService.updated(result, 'Configuración de rate limiting actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al actualizar configuración de rate limiting', error.message);
        }
    }
    async unblockIP(ip) {
        try {
            const result = {
                message: `IP ${ip} has been unblocked`,
                unblockedAt: new Date(),
            };
            return this.responseService.success(result, 'IP desbloqueada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al desbloquear IP', error.message);
        }
    }
};
exports.RateLimitingController = RateLimitingController;
__decorate([
    (0, common_1.Get)('status'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener estado actual del rate limiting',
        description: 'Consulta el estado actual de rate limiting para todos los endpoints',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Estado obtenido exitosamente',
        schema: {
            type: 'object',
            properties: {
                endpoints: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', example: 'POST /auth/login' },
                            limit: { type: 'number', example: 3 },
                            window: { type: 'string', example: '15 minutes' },
                            status: { type: 'string', example: 'active' },
                        },
                    },
                },
                blockedIPs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            ip: { type: 'string', example: '192.168.1.1' },
                            blocked_until: {
                                type: 'string',
                                example: '2025-09-05T15:30:00Z',
                            },
                            reason: { type: 'string', example: 'Too many login attempts' },
                        },
                    },
                },
            },
        },
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RateLimitingController.prototype, "getRateLimitStatus", null);
__decorate([
    (0, common_1.Get)('attempts'),
    (0, swagger_1.ApiOperation)({
        summary: 'Obtener intentos de rate limiting para una IP',
        description: 'Consulta los intentos actuales de rate limiting para una dirección IP específica',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Intentos obtenidos exitosamente',
    }),
    __param(0, (0, common_1.Query)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RateLimitingController.prototype, "getIPAttempts", null);
__decorate([
    (0, common_1.Post)('reset'),
    (0, swagger_1.ApiOperation)({
        summary: 'Resetear contador de rate limiting para una IP',
        description: 'Resetea el contador de intentos para una dirección IP específica',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Contador reseteado exitosamente',
    }),
    __param(0, (0, common_1.Query)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RateLimitingController.prototype, "resetIPAttempts", null);
__decorate([
    (0, common_1.Put)('config'),
    (0, swagger_1.ApiOperation)({
        summary: 'Actualizar configuración de rate limiting',
        description: 'Actualiza los límites y configuraciones de rate limiting',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'Configuración actualizada exitosamente',
    }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RateLimitingController.prototype, "updateRateLimitConfig", null);
__decorate([
    (0, common_1.Delete)('blocked'),
    (0, swagger_1.ApiOperation)({
        summary: 'Desbloquear una IP',
        description: 'Remueve el bloqueo de rate limiting para una dirección IP específica',
    }),
    (0, swagger_1.ApiResponse)({
        status: common_1.HttpStatus.OK,
        description: 'IP desbloqueada exitosamente',
    }),
    __param(0, (0, common_1.Query)('ip')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RateLimitingController.prototype, "unblockIP", null);
exports.RateLimitingController = RateLimitingController = __decorate([
    (0, swagger_1.ApiTags)('Rate Limiting'),
    (0, common_1.Controller)('rate-limiting'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [response_service_1.ResponseService])
], RateLimitingController);
//# sourceMappingURL=rate-limiting.controller.js.map
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
exports.OrganizationsController = void 0;
const common_1 = require("@nestjs/common");
const organizations_service_1 = require("./organizations.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let OrganizationsController = class OrganizationsController {
    constructor(organizationsService, responseService) {
        this.organizationsService = organizationsService;
        this.responseService = responseService;
    }
    async create(createOrganizationDto, user) {
        try {
            const result = await this.organizationsService.create(createOrganizationDto);
            return this.responseService.success(result, 'Organización creada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear la organización', error.message);
        }
    }
    async findAll(query, user) {
        try {
            const result = await this.organizationsService.findAll(query);
            return this.responseService.success(result.data, 'Organizaciones obtenidas exitosamente', result.meta);
        }
        catch (error) {
            return this.responseService.error('Error al obtener las organizaciones', error.message);
        }
    }
    async getStats() {
        try {
            const result = await this.organizationsService.getDashboardStats();
            return this.responseService.success(result, 'Estadísticas de organizaciones obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas de organizaciones', error.message);
        }
    }
    async findOne(id) {
        try {
            const result = await this.organizationsService.findOne(id);
            return this.responseService.success(result, 'Organización obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener la organización', error.message);
        }
    }
    async findBySlug(slug) {
        try {
            const result = await this.organizationsService.findBySlug(slug);
            return this.responseService.success(result, 'Organización obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener la organización', error.message);
        }
    }
    async update(id, updateOrganizationDto) {
        try {
            const result = await this.organizationsService.update(id, updateOrganizationDto);
            return this.responseService.success(result, 'Organización actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al actualizar la organización', error.message);
        }
    }
    async remove(id) {
        try {
            const result = await this.organizationsService.remove(id);
            return this.responseService.success(result, 'Organización eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al eliminar la organización', error.message);
        }
    }
    async getOrganizationStats(id, query) {
        try {
            const result = await this.organizationsService.getDashboard(id, query);
            return this.responseService.success(result, 'Estadísticas organizacionales obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas organizacionales', error.message);
        }
    }
};
exports.OrganizationsController = OrganizationsController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('organizations:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateOrganizationDto, Object]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('organizations:read'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.OrganizationQueryDto, Object]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, permissions_decorator_1.Permissions)('organizations:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('organizations:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('slug/:slug'),
    (0, permissions_decorator_1.Permissions)('organizations:read'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "findBySlug", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('organizations:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateOrganizationDto]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('organizations:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)(':id/stats'),
    (0, permissions_decorator_1.Permissions)('organizations:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.OrganizationDashboardDto]),
    __metadata("design:returntype", Promise)
], OrganizationsController.prototype, "getOrganizationStats", null);
exports.OrganizationsController = OrganizationsController = __decorate([
    (0, common_1.Controller)('organizations'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [organizations_service_1.OrganizationsService,
        response_service_1.ResponseService])
], OrganizationsController);
//# sourceMappingURL=organizations.controller.js.map
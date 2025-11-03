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
exports.AdminOrganizationsController = void 0;
const common_1 = require("@nestjs/common");
const admin_organizations_service_1 = require("./admin-organizations.service");
const dto_1 = require("../organizations/dto");
const super_admin_guard_1 = require("../auth/guards/super-admin.guard");
const super_admin_decorator_1 = require("../auth/decorators/super-admin.decorator");
const response_service_1 = require("../../common/responses/response.service");
let AdminOrganizationsController = class AdminOrganizationsController {
    constructor(adminOrganizationsService, responseService) {
        this.adminOrganizationsService = adminOrganizationsService;
        this.responseService = responseService;
    }
    async create(createOrganizationDto) {
        try {
            const result = await this.adminOrganizationsService.create(createOrganizationDto);
            return this.responseService.success(result, 'Organización creada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear la organización', error.message);
        }
    }
    async findAll(query) {
        try {
            const result = await this.adminOrganizationsService.findAll(query);
            return this.responseService.success(result.data, 'Organizaciones obtenidas exitosamente', result.meta);
        }
        catch (error) {
            return this.responseService.error('Error al obtener las organizaciones', error.message);
        }
    }
    async getStats() {
        try {
            const result = await this.adminOrganizationsService.getDashboardStats();
            return this.responseService.success(result, 'Estadísticas de organizaciones obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas de organizaciones', error.message);
        }
    }
    async findOne(id) {
        try {
            const result = await this.adminOrganizationsService.findOne(id);
            return this.responseService.success(result, 'Organización obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener la organización', error.message);
        }
    }
    async findBySlug(slug) {
        try {
            const result = await this.adminOrganizationsService.findBySlug(slug);
            return this.responseService.success(result, 'Organización obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener la organización', error.message);
        }
    }
    async update(id, updateOrganizationDto) {
        try {
            const result = await this.adminOrganizationsService.update(id, updateOrganizationDto);
            return this.responseService.success(result, 'Organización actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al actualizar la organización', error.message);
        }
    }
    async remove(id) {
        try {
            const result = await this.adminOrganizationsService.remove(id);
            return this.responseService.success(result, 'Organización eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al eliminar la organización', error.message);
        }
    }
    async getOrganizationStats(id, query) {
        try {
            const result = await this.adminOrganizationsService.getDashboard(id, query);
            return this.responseService.success(result, 'Estadísticas organizacionales obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas organizacionales', error.message);
        }
    }
};
exports.AdminOrganizationsController = AdminOrganizationsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateOrganizationDto]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AdminOrganizationQueryDto]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('slug/:slug'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "findBySlug", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateOrganizationDto]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)(':id/stats'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.OrganizationDashboardDto]),
    __metadata("design:returntype", Promise)
], AdminOrganizationsController.prototype, "getOrganizationStats", null);
exports.AdminOrganizationsController = AdminOrganizationsController = __decorate([
    (0, common_1.Controller)('admin/organizations'),
    (0, common_1.UseGuards)(super_admin_guard_1.SuperAdminGuard),
    (0, super_admin_decorator_1.SuperAdmin)(),
    __metadata("design:paramtypes", [admin_organizations_service_1.AdminOrganizationsService,
        response_service_1.ResponseService])
], AdminOrganizationsController);
//# sourceMappingURL=admin-organizations.controller.js.map
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
exports.AdminDomainsController = void 0;
const common_1 = require("@nestjs/common");
const admin_domains_service_1 = require("./admin-domains.service");
const domain_settings_dto_1 = require("../domains/dto/domain-settings.dto");
const super_admin_decorator_1 = require("../auth/decorators/super-admin.decorator");
const super_admin_guard_1 = require("../auth/guards/super-admin.guard");
const swagger_1 = require("@nestjs/swagger");
let AdminDomainsController = class AdminDomainsController {
    constructor(adminDomainsService) {
        this.adminDomainsService = adminDomainsService;
    }
    create(createDomainSettingDto) {
        return this.adminDomainsService.create(createDomainSettingDto);
    }
    findAll(query) {
        return this.adminDomainsService.findAll(query);
    }
    getDashboardStats() {
        return this.adminDomainsService.getDashboardStats();
    }
    findOne(id) {
        return this.adminDomainsService.findOne(+id);
    }
    update(id, updateDomainSettingDto) {
        return this.adminDomainsService.update(+id, updateDomainSettingDto);
    }
    remove(id) {
        return this.adminDomainsService.remove(+id);
    }
    verifyDomain(id) {
        return this.adminDomainsService.verifyDomain(+id);
    }
};
exports.AdminDomainsController = AdminDomainsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new domain' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Domain created successfully' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_settings_dto_1.CreateDomainSettingDto]),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get all domains with pagination and filtering' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Domains retrieved successfully' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Get dashboard statistics for domains' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Dashboard statistics retrieved successfully',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "getDashboardStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a domain by ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Domain retrieved successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Domain not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a domain' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Domain updated successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Domain not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, domain_settings_dto_1.UpdateDomainSettingDto]),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a domain' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Domain deleted successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Domain not found' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Cannot delete primary domain' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/verify'),
    (0, swagger_1.ApiOperation)({ summary: 'Verify domain configuration' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Domain verification completed' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Domain not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminDomainsController.prototype, "verifyDomain", null);
exports.AdminDomainsController = AdminDomainsController = __decorate([
    (0, swagger_1.ApiTags)('Admin Domains'),
    (0, common_1.Controller)('admin/domains'),
    (0, common_1.UseGuards)(super_admin_guard_1.SuperAdminGuard),
    (0, super_admin_decorator_1.SuperAdmin)(),
    __metadata("design:paramtypes", [admin_domains_service_1.AdminDomainsService])
], AdminDomainsController);
//# sourceMappingURL=admin-domains.controller.js.map
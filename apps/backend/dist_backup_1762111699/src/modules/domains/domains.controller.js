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
var DomainsController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainsController = void 0;
const common_1 = require("@nestjs/common");
const public_decorator_1 = require("../auth/decorators/public.decorator");
const roles_guard_1 = require("../auth/guards/roles.guard");
const roles_decorator_1 = require("../auth/decorators/roles.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const responses_1 = require("../../common/responses");
const domains_service_1 = require("./domains.service");
const domain_settings_dto_1 = require("./dto/domain-settings.dto");
let DomainsController = DomainsController_1 = class DomainsController {
    constructor(domainsService, responseService) {
        this.domainsService = domainsService;
        this.responseService = responseService;
        this.logger = new common_1.Logger(DomainsController_1.name);
    }
    async resolveDomain(hostname, subdomain, forwardedHost) {
        const result = await this.domainsService.resolveDomain(hostname, subdomain, forwardedHost);
        return this.responseService.success(result, 'Domain resolved successfully');
    }
    async checkHostnameAvailability(hostname) {
        const result = await this.domainsService.checkHostnameAvailability(hostname);
        return this.responseService.success(result, 'Hostname availability checked successfully');
    }
    async createDomainSetting(createDomainSettingDto, user) {
        const result = await this.domainsService.createDomainSetting(createDomainSettingDto);
        return this.responseService.created(result, 'Domain setting created successfully');
    }
    async getAllDomainSettings(organizationId, storeId, search, limit, offset) {
        const filters = {};
        if (organizationId) {
            const orgId = parseInt(organizationId, 10);
            if (isNaN(orgId)) {
                throw new common_1.BadRequestException('Invalid organizationId parameter');
            }
            filters.organizationId = orgId;
        }
        if (storeId) {
            const sId = parseInt(storeId, 10);
            if (isNaN(sId)) {
                throw new common_1.BadRequestException('Invalid storeId parameter');
            }
            filters.storeId = sId;
        }
        if (search)
            filters.search = search;
        if (limit) {
            const lmt = parseInt(limit, 10);
            if (isNaN(lmt) || lmt <= 0) {
                throw new common_1.BadRequestException('Invalid limit parameter');
            }
            filters.limit = lmt;
        }
        if (offset) {
            const off = parseInt(offset, 10);
            if (isNaN(off) || off < 0) {
                throw new common_1.BadRequestException('Invalid offset parameter');
            }
            filters.offset = off;
        }
        const result = await this.domainsService.getAllDomainSettings(filters);
        const page = Math.floor((filters.offset || 0) / (filters.limit || 10)) + 1;
        const limitValue = filters.limit || 10;
        return this.responseService.paginated(result.data, result.total, page, limitValue, 'Domain settings retrieved successfully');
    }
    async getDomainStats() {
        const stats = await this.domainsService.getDomainStats();
        return this.responseService.success(stats, 'Domain statistics retrieved successfully');
    }
    async getDomainSettingByHostname(hostname) {
        const result = await this.domainsService.getDomainSettingByHostname(hostname);
        return this.responseService.success(result, 'Domain setting retrieved successfully');
    }
    async getDomainSettingById(id) {
        const domainId = parseInt(id, 10);
        if (isNaN(domainId)) {
            throw new common_1.BadRequestException('Invalid domain ID');
        }
        const result = await this.domainsService.getDomainSettingById(domainId);
        return this.responseService.success(result, 'Domain setting retrieved successfully');
    }
    async updateDomainSetting(hostname, updateDomainSettingDto) {
        const result = await this.domainsService.updateDomainSetting(hostname, updateDomainSettingDto);
        return this.responseService.updated(result, 'Domain setting updated successfully');
    }
    async deleteDomainSetting(hostname) {
        await this.domainsService.deleteDomainSetting(hostname);
        return this.responseService.deleted('Domain setting deleted successfully');
    }
    async duplicateDomainSetting(hostname, duplicateData) {
        const result = await this.domainsService.duplicateDomainSetting(hostname, duplicateData.newHostname);
        return this.responseService.created(result, 'Domain setting duplicated successfully');
    }
    async getDomainSettingsByOrganization(organizationId) {
        const orgId = parseInt(organizationId, 10);
        if (isNaN(orgId)) {
            throw new common_1.BadRequestException('Invalid organization ID');
        }
        const result = await this.domainsService.getAllDomainSettings({
            organizationId: orgId,
        });
        return this.responseService.success(result.data, 'Domain settings retrieved successfully');
    }
    async getDomainSettingsByStore(storeId) {
        const sId = parseInt(storeId, 10);
        if (isNaN(sId)) {
            throw new common_1.BadRequestException('Invalid store ID');
        }
        const result = await this.domainsService.getAllDomainSettings({
            storeId: sId,
        });
        return this.responseService.success(result.data, 'Domain settings retrieved successfully');
    }
    async validateHostname(data) {
        const result = await this.domainsService.validateHostname(data.hostname);
        return this.responseService.success(result, 'Hostname validated successfully');
    }
    async verifyDomain(hostname, body) {
        const result = await this.domainsService.verifyDomain(hostname, body);
        return this.responseService.success(result, 'Domain verified successfully');
    }
};
exports.DomainsController = DomainsController;
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('resolve/:hostname'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('hostname')),
    __param(1, (0, common_1.Query)('subdomain')),
    __param(2, (0, common_1.Headers)('x-forwarded-host')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "resolveDomain", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('check/:hostname'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('hostname')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "checkHostnameAvailability", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_settings_dto_1.CreateDomainSettingDto, Object]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "createDomainSetting", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Query)('organizationId')),
    __param(1, (0, common_1.Query)('storeId')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "getAllDomainSettings", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "getDomainStats", null);
__decorate([
    (0, common_1.Get)('hostname/:hostname'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('hostname')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "getDomainSettingByHostname", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "getDomainSettingById", null);
__decorate([
    (0, common_1.Put)('hostname/:hostname'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('hostname')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, domain_settings_dto_1.UpdateDomainSettingDto]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "updateDomainSetting", null);
__decorate([
    (0, common_1.Delete)('hostname/:hostname'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('hostname')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "deleteDomainSetting", null);
__decorate([
    (0, common_1.Post)('hostname/:hostname/duplicate'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('hostname')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, domain_settings_dto_1.DuplicateDomainDto]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "duplicateDomainSetting", null);
__decorate([
    (0, common_1.Get)('organization/:organizationId'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('organizationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "getDomainSettingsByOrganization", null);
__decorate([
    (0, common_1.Get)('store/:storeId'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('storeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "getDomainSettingsByStore", null);
__decorate([
    (0, common_1.Post)('validate-hostname'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [domain_settings_dto_1.ValidateHostnameDto]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "validateHostname", null);
__decorate([
    (0, common_1.Post)('hostname/:hostname/verify'),
    (0, roles_decorator_1.Roles)('super_admin', 'admin', 'owner'),
    __param(0, (0, common_1.Param)('hostname')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, domain_settings_dto_1.VerifyDomainDto]),
    __metadata("design:returntype", Promise)
], DomainsController.prototype, "verifyDomain", null);
exports.DomainsController = DomainsController = DomainsController_1 = __decorate([
    (0, common_1.Controller)('domains'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [domains_service_1.DomainsService,
        responses_1.ResponseService])
], DomainsController);
//# sourceMappingURL=domains.controller.js.map
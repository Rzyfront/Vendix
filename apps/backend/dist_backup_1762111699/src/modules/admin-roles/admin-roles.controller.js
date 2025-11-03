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
exports.AdminRolesController = void 0;
const common_1 = require("@nestjs/common");
const admin_roles_service_1 = require("./admin-roles.service");
const role_dto_1 = require("../roles/dto/role.dto");
const super_admin_decorator_1 = require("../auth/decorators/super-admin.decorator");
const super_admin_guard_1 = require("../auth/guards/super-admin.guard");
const swagger_1 = require("@nestjs/swagger");
let AdminRolesController = class AdminRolesController {
    constructor(adminRolesService) {
        this.adminRolesService = adminRolesService;
    }
    create(createRoleDto) {
        return this.adminRolesService.create(createRoleDto);
    }
    findAll(query) {
        return this.adminRolesService.findAll(query);
    }
    getDashboardStats() {
        return this.adminRolesService.getDashboardStats();
    }
    findOne(id) {
        return this.adminRolesService.findOne(+id);
    }
    update(id, updateRoleDto) {
        return this.adminRolesService.update(+id, updateRoleDto);
    }
    remove(id) {
        return this.adminRolesService.remove(+id);
    }
    assignPermissions(id, assignPermissionsDto) {
        return this.adminRolesService.assignPermissions(+id, assignPermissionsDto);
    }
    removePermissions(id, removePermissionsDto) {
        return this.adminRolesService.removePermissions(+id, removePermissionsDto);
    }
};
exports.AdminRolesController = AdminRolesController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new role' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Role created successfully' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [role_dto_1.CreateRoleDto]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get all roles with pagination and filtering' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Roles retrieved successfully' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Get dashboard statistics for roles' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Dashboard statistics retrieved successfully',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "getDashboardStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a role by ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Role retrieved successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Role not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a role' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Role updated successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Role not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, role_dto_1.UpdateRoleDto]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a role' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Role deleted successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Role not found' }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Cannot delete system roles or roles with existing data',
    }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/permissions/assign'),
    (0, swagger_1.ApiOperation)({ summary: 'Assign permissions to a role' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Permissions assigned successfully',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Role not found' }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Some permissions are already assigned',
    }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, role_dto_1.AssignPermissionsDto]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "assignPermissions", null);
__decorate([
    (0, common_1.Post)(':id/permissions/remove'),
    (0, swagger_1.ApiOperation)({ summary: 'Remove permissions from a role' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permissions removed successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Role not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, role_dto_1.RemovePermissionsDto]),
    __metadata("design:returntype", void 0)
], AdminRolesController.prototype, "removePermissions", null);
exports.AdminRolesController = AdminRolesController = __decorate([
    (0, swagger_1.ApiTags)('Admin Roles'),
    (0, common_1.Controller)('admin/roles'),
    (0, common_1.UseGuards)(super_admin_guard_1.SuperAdminGuard),
    (0, super_admin_decorator_1.SuperAdmin)(),
    __metadata("design:paramtypes", [admin_roles_service_1.AdminRolesService])
], AdminRolesController);
//# sourceMappingURL=admin-roles.controller.js.map
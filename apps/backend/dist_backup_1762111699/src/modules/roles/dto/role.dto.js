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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleWithPermissionDescriptionsDto = exports.RoleDashboardStatsDto = exports.RemoveRoleFromUserDto = exports.AssignRoleToUserDto = exports.RemovePermissionsDto = exports.AssignPermissionsDto = exports.UpdateRoleDto = exports.CreateRoleDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class CreateRoleDto {
}
exports.CreateRoleDto = CreateRoleDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Nombre único del rol',
        example: 'manager',
        minLength: 2,
        maxLength: 50,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], CreateRoleDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Descripción del rol',
        example: 'Gestor de tienda con permisos administrativos',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateRoleDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Indica si es un rol del sistema (no se puede eliminar)',
        example: false,
        default: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateRoleDto.prototype, "is_system_role", void 0);
class UpdateRoleDto {
}
exports.UpdateRoleDto = UpdateRoleDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Nombre único del rol',
        example: 'senior_manager',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(50),
    __metadata("design:type", String)
], UpdateRoleDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Descripción del rol',
        example: 'Gestor senior con permisos avanzados',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateRoleDto.prototype, "description", void 0);
class AssignPermissionsDto {
}
exports.AssignPermissionsDto = AssignPermissionsDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Lista de IDs de permisos a asignar',
        example: [1, 2, 3],
        type: [Number],
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsInt)({ each: true }),
    __metadata("design:type", Array)
], AssignPermissionsDto.prototype, "permissionIds", void 0);
class RemovePermissionsDto {
}
exports.RemovePermissionsDto = RemovePermissionsDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Lista de IDs de permisos a remover',
        example: [2, 4],
        type: [Number],
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsInt)({ each: true }),
    __metadata("design:type", Array)
], RemovePermissionsDto.prototype, "permissionIds", void 0);
class AssignRoleToUserDto {
}
exports.AssignRoleToUserDto = AssignRoleToUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del usuario',
        example: 123,
    }),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], AssignRoleToUserDto.prototype, "userId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del rol a asignar',
        example: 5,
    }),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], AssignRoleToUserDto.prototype, "roleId", void 0);
class RemoveRoleFromUserDto {
}
exports.RemoveRoleFromUserDto = RemoveRoleFromUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del usuario',
        example: 123,
    }),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], RemoveRoleFromUserDto.prototype, "userId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del rol a remover',
        example: 5,
    }),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], RemoveRoleFromUserDto.prototype, "roleId", void 0);
class RoleDashboardStatsDto {
}
exports.RoleDashboardStatsDto = RoleDashboardStatsDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Total de roles en el sistema',
        example: 15,
    }),
    __metadata("design:type", Number)
], RoleDashboardStatsDto.prototype, "total_roles", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Total de roles del sistema',
        example: 5,
    }),
    __metadata("design:type", Number)
], RoleDashboardStatsDto.prototype, "system_roles", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Total de roles personalizados',
        example: 10,
    }),
    __metadata("design:type", Number)
], RoleDashboardStatsDto.prototype, "custom_roles", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Total de permisos disponibles',
        example: 42,
    }),
    __metadata("design:type", Number)
], RoleDashboardStatsDto.prototype, "total_permissions", void 0);
class RoleWithPermissionDescriptionsDto {
}
exports.RoleWithPermissionDescriptionsDto = RoleWithPermissionDescriptionsDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'ID del rol',
        example: 1,
    }),
    __metadata("design:type", Number)
], RoleWithPermissionDescriptionsDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Nombre del rol',
        example: 'manager',
    }),
    __metadata("design:type", String)
], RoleWithPermissionDescriptionsDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Descripción del rol',
        example: 'Gestor de tienda con permisos administrativos',
    }),
    __metadata("design:type", String)
], RoleWithPermissionDescriptionsDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Indica si es un rol del sistema',
        example: false,
    }),
    __metadata("design:type", Boolean)
], RoleWithPermissionDescriptionsDto.prototype, "is_system_role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Fecha de creación',
        example: '2023-01-01T00:00:00.000Z',
    }),
    __metadata("design:type", Date)
], RoleWithPermissionDescriptionsDto.prototype, "created_at", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Fecha de actualización',
        example: '2023-01-01T00:00:00.000Z',
    }),
    __metadata("design:type", Date)
], RoleWithPermissionDescriptionsDto.prototype, "updated_at", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Array con las descripciones de los permisos',
        example: ['Crear usuarios', 'Editar productos', 'Ver reportes'],
        type: [String],
    }),
    __metadata("design:type", Array)
], RoleWithPermissionDescriptionsDto.prototype, "permissions", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Usuarios asignados al rol',
        type: 'array',
        items: {
            type: 'object',
            properties: {
                id: { type: 'number' },
                email: { type: 'string' },
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                state: { type: 'string' },
            },
        },
    }),
    __metadata("design:type", Array)
], RoleWithPermissionDescriptionsDto.prototype, "user_roles", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Conteo de usuarios asignados',
        example: 5,
    }),
    __metadata("design:type", Object)
], RoleWithPermissionDescriptionsDto.prototype, "_count", void 0);
//# sourceMappingURL=role.dto.js.map
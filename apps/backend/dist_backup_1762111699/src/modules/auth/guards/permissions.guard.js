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
exports.PermissionsGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const permissions_decorator_1 = require("../decorators/permissions.decorator");
const user_role_enum_1 = require("../enums/user-role.enum");
let PermissionsGuard = class PermissionsGuard {
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const requiredPermissions = this.reflector.getAllAndOverride(permissions_decorator_1.PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
        if (!requiredPermissions) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const { user } = request;
        const { method, route } = request;
        if (!user) {
            throw new common_1.ForbiddenException('Usuario no autenticado');
        }
        if (user.roles && user.roles.includes(user_role_enum_1.UserRole.SUPER_ADMIN)) {
            return true;
        }
        if (!user.permissions || user.permissions.length === 0) {
            throw new common_1.ForbiddenException('Usuario sin permisos asignados');
        }
        const currentPath = route?.path || request.url;
        const currentMethod = method.toUpperCase();
        const hasPermission = user.permissions.some((permission) => {
            const pathMatches = permission.path === currentPath ||
                currentPath.startsWith(permission.path);
            const methodMatches = permission.method === currentMethod || permission.method === 'ALL';
            const isActive = permission.status === 'active';
            return pathMatches && methodMatches && isActive;
        });
        const hasNamedPermission = requiredPermissions.some((permissionName) => user.permissions.some((userPerm) => userPerm.path.includes(permissionName) &&
            userPerm.status === 'active'));
        if (!hasPermission && !hasNamedPermission) {
            throw new common_1.ForbiddenException(`Acceso denegado. Se requiere permiso para ${currentMethod} ${currentPath}`);
        }
        return true;
    }
};
exports.PermissionsGuard = PermissionsGuard;
exports.PermissionsGuard = PermissionsGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], PermissionsGuard);
//# sourceMappingURL=permissions.guard.js.map
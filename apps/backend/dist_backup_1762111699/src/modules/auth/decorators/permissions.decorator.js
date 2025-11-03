"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Permissions = exports.RequirePermissions = exports.PERMISSIONS_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.PERMISSIONS_KEY = 'permissions';
const RequirePermissions = (...permissions) => (0, common_1.SetMetadata)(exports.PERMISSIONS_KEY, permissions);
exports.RequirePermissions = RequirePermissions;
exports.Permissions = exports.RequirePermissions;
//# sourceMappingURL=permissions.decorator.js.map
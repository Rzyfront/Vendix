"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuperAdmin = exports.SUPER_ADMIN_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.SUPER_ADMIN_KEY = 'super_admin';
const SuperAdmin = () => (0, common_1.SetMetadata)(exports.SUPER_ADMIN_KEY, true);
exports.SuperAdmin = SuperAdmin;
//# sourceMappingURL=super-admin.decorator.js.map
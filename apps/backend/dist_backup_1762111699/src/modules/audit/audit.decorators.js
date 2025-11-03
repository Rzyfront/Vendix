"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InjectAuditService = void 0;
const common_1 = require("@nestjs/common");
const audit_service_1 = require("./audit.service");
const InjectAuditService = () => (0, common_1.Inject)(audit_service_1.AuditService);
exports.InjectAuditService = InjectAuditService;
//# sourceMappingURL=audit.decorators.js.map
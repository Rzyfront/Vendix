"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestContext = void 0;
const common_1 = require("@nestjs/common");
const request_context_service_1 = require("../context/request-context.service");
exports.RequestContext = (0, common_1.createParamDecorator)((data, ctx) => {
    const context = request_context_service_1.RequestContextService.getContext();
    return data ? context?.[data] : context;
});
//# sourceMappingURL=request-context.decorator.js.map
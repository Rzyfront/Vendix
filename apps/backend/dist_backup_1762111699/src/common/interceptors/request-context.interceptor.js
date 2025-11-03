"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestContextInterceptor = void 0;
const common_1 = require("@nestjs/common");
const request_context_service_1 = require("../context/request-context.service");
let RequestContextInterceptor = class RequestContextInterceptor {
    intercept(context, next) {
        const ctx = context.switchToHttp();
        const req = ctx.getRequest();
        const user = req.user;
        const requestId = req.headers['x-request-id'] ||
            Math.random().toString(36).substring(2, 10);
        console.error(`[CTX-INT] Interceptor ejecutado para path: ${req.path} | user: ${user ? 'SI' : 'NO'}`);
        if (!user) {
            return next.handle();
        }
        const roles = user.user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];
        const is_super_admin = roles.includes('super_admin');
        const is_owner = roles.includes('owner');
        const organization_id = user.organization_id;
        const store_id = user.store_id;
        const contextObj = {
            user_id: user.id,
            organization_id: organization_id,
            store_id: store_id,
            roles,
            is_super_admin,
            is_owner,
            email: user.email,
        };
        console.error(`[${requestId}] [CTX-INT] Context set: User ${user.id} | Org ${contextObj.organization_id || 'N/A'} | Store ${contextObj.store_id || 'N/A'} | Roles: ${roles.join(', ')}`);
        return request_context_service_1.RequestContextService.asyncLocalStorage.run(contextObj, () => {
            return next.handle();
        });
    }
};
exports.RequestContextInterceptor = RequestContextInterceptor;
exports.RequestContextInterceptor = RequestContextInterceptor = __decorate([
    (0, common_1.Injectable)()
], RequestContextInterceptor);
//# sourceMappingURL=request-context.interceptor.js.map
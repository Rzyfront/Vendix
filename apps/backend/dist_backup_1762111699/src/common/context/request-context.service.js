"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestContextService = void 0;
const common_1 = require("@nestjs/common");
const async_hooks_1 = require("async_hooks");
let RequestContextService = class RequestContextService {
    static run(context, callback) {
        this.currentContext = context;
        return this.asyncLocalStorage.run(context, callback);
    }
    static getContext() {
        return this.asyncLocalStorage.getStore() || this.currentContext;
    }
    static getOrganizationId() {
        return this.getContext()?.organization_id;
    }
    static getStoreId() {
        return this.getContext()?.store_id;
    }
    static getUserId() {
        return this.getContext()?.user_id;
    }
    static isSuperAdmin() {
        return this.getContext()?.is_super_admin || false;
    }
    static isOwner() {
        return this.getContext()?.is_owner || false;
    }
    static hasRole(roleName) {
        const roles = this.getContext()?.roles || [];
        return roles.includes(roleName);
    }
    static getRoles() {
        return this.getContext()?.roles || [];
    }
};
exports.RequestContextService = RequestContextService;
RequestContextService.asyncLocalStorage = new async_hooks_1.AsyncLocalStorage();
exports.RequestContextService = RequestContextService = __decorate([
    (0, common_1.Injectable)()
], RequestContextService);
//# sourceMappingURL=request-context.service.js.map
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
exports.AuditInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const audit_service_1 = require("./audit.service");
let AuditInterceptor = class AuditInterceptor {
    constructor(auditService) {
        this.auditService = auditService;
    }
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const handler = context.getHandler();
        const controller = context.getClass();
        const userId = request.user?.id;
        const method = request.method;
        const url = request.url;
        if (!userId) {
            return next.handle();
        }
        return next.handle().pipe((0, operators_1.tap)(async (data) => {
            try {
                if (method === 'POST' && this.isCreateOperation(url)) {
                    await this.logCreateOperation(userId, url, data);
                }
                else if (method === 'PUT' && this.isUpdateOperation(url, method)) {
                    await this.logUpdateOperation(userId, url, request.body, data);
                }
                else if (method === 'DELETE' && this.isDeleteOperation(url)) {
                    await this.logDeleteOperation(userId, url);
                }
            }
            catch (error) {
                console.error('Error en AuditInterceptor:', error);
            }
        }));
    }
    isCreateOperation(url) {
        return (url.includes('/create') || url.includes('/register') || !url.includes('/'));
    }
    isUpdateOperation(url, method) {
        return url.includes('/update') || url.includes('/edit') || method === 'PUT';
    }
    isDeleteOperation(method) {
        return method === 'DELETE';
    }
    async logCreateOperation(userId, url, data) {
        const resource = this.extractResourceFromUrl(url);
        if (resource && data?.id) {
            await this.auditService.logCreate(userId, resource, data.id, data);
        }
    }
    async logUpdateOperation(userId, url, oldData, newData) {
        const resource = this.extractResourceFromUrl(url);
        if (resource && newData?.id) {
            await this.auditService.logUpdate(userId, resource, newData.id, oldData, newData);
        }
    }
    async logDeleteOperation(userId, url) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url);
        if (resource && resourceId) {
            await this.auditService.logDelete(userId, resource, resourceId, {});
        }
    }
    extractResourceFromUrl(url) {
        const segments = url.split('/').filter((s) => s);
        const resourceMap = {
            users: audit_service_1.AuditResource.USERS,
            organizations: audit_service_1.AuditResource.ORGANIZATIONS,
            stores: audit_service_1.AuditResource.STORES,
            products: audit_service_1.AuditResource.PRODUCTS,
            orders: audit_service_1.AuditResource.ORDERS,
        };
        for (const segment of segments) {
            if (resourceMap[segment]) {
                return resourceMap[segment];
            }
        }
        return null;
    }
    extractIdFromUrl(url) {
        const segments = url.split('/').filter((s) => s);
        for (const segment of segments) {
            const id = parseInt(segment);
            if (!isNaN(id)) {
                return id;
            }
        }
        return null;
    }
};
exports.AuditInterceptor = AuditInterceptor;
exports.AuditInterceptor = AuditInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], AuditInterceptor);
//# sourceMappingURL=audit.interceptor.js.map
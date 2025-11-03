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
exports.AuditService = exports.AuditResource = exports.AuditAction = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
var AuditAction;
(function (AuditAction) {
    AuditAction["CREATE"] = "CREATE";
    AuditAction["UPDATE"] = "UPDATE";
    AuditAction["DELETE"] = "DELETE";
    AuditAction["LOGIN"] = "LOGIN";
    AuditAction["LOGOUT"] = "LOGOUT";
    AuditAction["PASSWORD_CHANGE"] = "PASSWORD_CHANGE";
    AuditAction["EMAIL_VERIFY"] = "EMAIL_VERIFY";
    AuditAction["ONBOARDING_COMPLETE"] = "ONBOARDING_COMPLETE";
    AuditAction["PERMISSION_CHANGE"] = "PERMISSION_CHANGE";
    AuditAction["LOGIN_FAILED"] = "LOGIN_FAILED";
    AuditAction["ACCOUNT_LOCKED"] = "ACCOUNT_LOCKED";
    AuditAction["ACCOUNT_UNLOCKED"] = "ACCOUNT_UNLOCKED";
    AuditAction["SUSPICIOUS_ACTIVITY"] = "SUSPICIOUS_ACTIVITY";
    AuditAction["PASSWORD_RESET"] = "PASSWORD_RESET";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
var AuditResource;
(function (AuditResource) {
    AuditResource["USERS"] = "users";
    AuditResource["ORGANIZATIONS"] = "organizations";
    AuditResource["STORES"] = "stores";
    AuditResource["DOMAIN_SETTINGS"] = "domain_settings";
    AuditResource["PRODUCTS"] = "products";
    AuditResource["ORDERS"] = "orders";
    AuditResource["AUTH"] = "auth";
    AuditResource["ROLES"] = "roles";
    AuditResource["PERMISSIONS"] = "permissions";
    AuditResource["SYSTEM"] = "system";
})(AuditResource || (exports.AuditResource = AuditResource = {}));
let AuditService = class AuditService {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async log(auditData) {
        try {
            await this.prismaService.audit_logs.create({
                data: {
                    user_id: auditData.userId,
                    store_id: auditData.storeId,
                    organization_id: auditData.organizationId,
                    action: auditData.action,
                    resource: auditData.resource,
                    resource_id: auditData.resourceId,
                    old_values: auditData.oldValues
                        ? JSON.parse(JSON.stringify(auditData.oldValues))
                        : null,
                    new_values: auditData.newValues
                        ? JSON.parse(JSON.stringify(auditData.newValues))
                        : null,
                    ip_address: auditData.ipAddress,
                    user_agent: auditData.userAgent,
                },
            });
            console.log(`📊 AUDIT: ${auditData.action} on ${auditData.resource}${auditData.resourceId ? ` (${auditData.resourceId})` : ''} by user ${auditData.userId || 'system'}`);
        }
        catch (error) {
            console.error('❌ Error registrando auditoría:', error);
        }
    }
    async logCreate(userId, resource, resourceId, newValues, metadata) {
        await this.log({
            userId,
            action: AuditAction.CREATE,
            resource,
            resourceId,
            newValues,
            metadata,
        });
    }
    async logUpdate(userId, resource, resourceId, oldValues, newValues, metadata) {
        await this.log({
            userId,
            action: AuditAction.UPDATE,
            resource,
            resourceId,
            oldValues,
            newValues,
            metadata,
        });
    }
    async logDelete(userId, resource, resourceId, oldValues, metadata) {
        await this.log({
            userId,
            action: AuditAction.DELETE,
            resource,
            resourceId,
            oldValues,
            metadata,
        });
    }
    async logAuth(userId, action, metadata, ipAddress, userAgent) {
        await this.log({
            userId,
            action,
            resource: AuditResource.AUTH,
            metadata,
            ipAddress,
            userAgent,
        });
    }
    async logSystem(action, resource, metadata) {
        await this.log({
            action,
            resource,
            metadata,
        });
    }
    async getAuditLogs(filters) {
        const where = {};
        if (filters?.userId)
            where.user_id = filters.userId;
        if (filters?.storeId)
            where.store_id = filters.storeId;
        if (filters?.action)
            where.action = filters.action;
        if (filters?.resource)
            where.resource = filters.resource;
        if (filters?.resourceId)
            where.resource_id = filters.resourceId;
        if (filters?.fromDate || filters?.toDate) {
            where.created_at = {};
            if (filters.fromDate)
                where.created_at.gte = filters.fromDate;
            if (filters.toDate)
                where.created_at.lte = filters.toDate;
        }
        return await this.prismaService.audit_logs.findMany({
            where,
            include: {
                users: {
                    select: {
                        id: true,
                        email: true,
                        first_name: true,
                        last_name: true,
                        organization_id: true,
                    },
                },
                stores: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        organization_id: true,
                    },
                },
            },
            orderBy: { created_at: 'desc' },
            take: filters?.limit || 50,
            skip: filters?.offset || 0,
        });
    }
    async getAuditStats(fromDate, toDate) {
        const where = {};
        if (fromDate || toDate) {
            where.created_at = {};
            if (fromDate)
                where.created_at.gte = fromDate;
            if (toDate)
                where.created_at.lte = toDate;
        }
        const [totalLogs, logsByAction, logsByResource] = await Promise.all([
            this.prismaService.audit_logs.count({ where }),
            this.prismaService.audit_logs.groupBy({
                by: ['action'],
                where,
                _count: { id: true },
            }),
            this.prismaService.audit_logs.groupBy({
                by: ['resource'],
                where,
                _count: { id: true },
            }),
        ]);
        const logsByActionFormatted = {};
        logsByAction.forEach((item) => {
            logsByActionFormatted[item.action] = item._count.id;
        });
        const logsByResourceFormatted = {};
        logsByResource.forEach((item) => {
            logsByResourceFormatted[item.resource] = item._count.id;
        });
        return {
            total_logs: totalLogs,
            logs_by_action: logsByActionFormatted,
            logs_by_resource: logsByResourceFormatted,
        };
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuditService);
//# sourceMappingURL=audit.service.js.map
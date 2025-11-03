import { AuditService, AuditAction, AuditResource } from './audit.service';
import { ResponseService } from '../../common/responses/response.service';
export declare class AuditController {
    private readonly auditService;
    private readonly responseService;
    constructor(auditService: AuditService, responseService: ResponseService);
    getAuditLogs(user: any, userId?: string, storeId?: string, action?: AuditAction, resource?: AuditResource, resourceId?: string, fromDate?: string, toDate?: string, limit?: string, offset?: string, organizationId?: string): Promise<import("../../common").SuccessResponse<any>>;
    getAuditStats(user: any, fromDate?: string, toDate?: string): Promise<import("../../common").SuccessResponse<{
        total_logs: any;
        logs_by_action: Record<string, number>;
        logs_by_resource: Record<string, number>;
    }>>;
}

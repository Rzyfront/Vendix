import { AuditService } from '../audit/audit.service';
import { ResponseService } from '../../common/responses/response.service';
export declare class SecurityLogsController {
    private readonly auditService;
    private readonly responseService;
    constructor(auditService: AuditService, responseService: ResponseService);
    getFailedLoginLogs(fromDate?: string, toDate?: string, limit?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getAccountLockLogs(fromDate?: string, toDate?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getPasswordChangeLogs(fromDate?: string, toDate?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getSuspiciousActivityLogs(fromDate?: string, toDate?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getSecuritySummary(fromDate?: string, toDate?: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        summary: {
            failedLogins: any;
            accountLocks: any;
            passwordChanges: any;
            totalSecurityEvents: any;
        };
        period: {
            from: string | Date;
            to: string | Date;
        };
    }>>;
}

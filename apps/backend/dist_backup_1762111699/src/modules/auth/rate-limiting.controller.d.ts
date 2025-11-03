import { ResponseService } from '../../common/responses/response.service';
export declare class RateLimitingController {
    private readonly responseService;
    constructor(responseService: ResponseService);
    getRateLimitStatus(): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        endpoints: {
            path: string;
            limit: number;
            window: string;
            status: string;
        }[];
        blockedIPs: never[];
    }>>;
    getIPAttempts(ip: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        ip: string;
        attempts: number;
        maxAttempts: number;
        resetTime: Date;
        isBlocked: boolean;
    }>>;
    resetIPAttempts(ip: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
        resetAt: Date;
    }>>;
    updateRateLimitConfig(config: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
        newConfig: any;
    }>>;
    unblockIP(ip: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
        unblockedAt: Date;
    }>>;
}

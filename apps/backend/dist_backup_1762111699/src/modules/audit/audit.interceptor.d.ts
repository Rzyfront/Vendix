import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuditService } from './audit.service';
export declare class AuditInterceptor implements NestInterceptor {
    private readonly auditService;
    constructor(auditService: AuditService);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
    private isCreateOperation;
    private isUpdateOperation;
    private isDeleteOperation;
    private logCreateOperation;
    private logUpdateOperation;
    private logDeleteOperation;
    private extractResourceFromUrl;
    private extractIdFromUrl;
}

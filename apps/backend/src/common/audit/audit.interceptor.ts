import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService, AuditAction, AuditResource } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(private readonly auditService: AuditService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const method = request.method;
        const url = request.url;
        const body = request.body;
        const query = request.query;
        const userId = request.user?.id;

        if (!userId) {
            return next.handle();
        }

        return next.handle().pipe(
            tap(async (data) => {
                try {
                    if (method === 'GET') {
                        await this.logGetOperation(userId, url, query);
                    } else if (method === 'POST' && this.isCreateOperation(url)) {
                        await this.logCreateOperation(userId, url, data);
                    } else if (method === 'PUT' && this.isUpdateOperation(url, method)) {
                        await this.logUpdateOperation(userId, url, body, data);
                    } else if (
                        method === 'DELETE' &&
                        this.isDeleteOperation(url, method)
                    ) {
                        await this.logDeleteOperation(userId, url);
                    }
                } catch (error) {
                    console.error('Error en AuditInterceptor:', error);
                }
            }),
        );
    }

    private isCreateOperation(url: string): boolean {
        return (
            url.includes('/create') ||
            url.includes('/register') ||
            (url.includes('/api/') &&
                !url.includes('/update') &&
                !url.includes('/edit') &&
                !url.includes('/delete'))
        );
    }

    private isUpdateOperation(url: string, method: string): boolean {
        return (
            url.includes('/update') ||
            url.includes('/edit') ||
            (method === 'PUT' &&
                !url.includes('/create') &&
                !url.includes('/register') &&
                !url.includes('/delete'))
        );
    }

    private isDeleteOperation(url: string, method: string): boolean {
        return method === 'DELETE' || url.includes('/delete');
    }

    private async logGetOperation(userId: number, url: string, query: any) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url);

        if (resource) {
            const hasQuery = Object.keys(query).length > 0;
            const action = hasQuery ? AuditAction.SEARCH : AuditAction.VIEW;

            await this.auditService.log({
                userId,
                action,
                resource,
                resourceId: resourceId || undefined,
                metadata: hasQuery ? { query } : undefined,
            });
        }
    }

    private async logCreateOperation(userId: number, url: string, data: any) {
        const resource = this.extractResourceFromUrl(url);
        if (resource && data?.id) {
            await this.auditService.logCreate(userId, resource, data.id, data);
        }
    }

    private async logUpdateOperation(
        userId: number,
        url: string,
        oldData: any,
        newData: any,
    ) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url) || newData?.id;

        if (resource && resourceId) {
            await this.auditService.logUpdate(
                userId,
                resource,
                resourceId,
                oldData,
                newData,
                { method: 'UPDATE' }
            );
        }
    }

    private async logDeleteOperation(userId: number, url: string) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url);
        if (resource && resourceId) {
            await this.auditService.logDelete(userId, resource, resourceId, {});
        }
    }

    private extractResourceFromUrl(url: string): AuditResource | null {
        const cleanUrl = url.split('?')[0];
        const segments = cleanUrl.split('/').filter((s) => s);
        const resourceMap: Record<string, AuditResource> = {
            users: AuditResource.USERS,
            organizations: AuditResource.ORGANIZATIONS,
            stores: AuditResource.STORES,
            products: AuditResource.PRODUCTS,
            orders: AuditResource.ORDERS,
            auth: AuditResource.AUTH,
            roles: AuditResource.ROLES,
            permissions: AuditResource.PERMISSIONS,
        };

        for (const segment of segments) {
            if (resourceMap[segment]) {
                return resourceMap[segment];
            }
        }

        return null;
    }

    private extractIdFromUrl(url: string): number | null {
        const cleanUrl = url.split('?')[0];
        const segments = cleanUrl.split('/').filter((s) => s);
        for (const segment of segments) {
            const id = parseInt(segment);
            if (!isNaN(id)) {
                return id;
            }
        }
        return null;
    }
}

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
        const user = request.user;
        const userId = user?.id;

        if (!userId) {
            return next.handle();
        }

        return next.handle().pipe(
            tap(async (data) => {
                try {
                    // Obtener organization_id y store_id del contexto o del body/query
                    const organizationId = this.getOrganizationId(request);
                    const storeId = this.getStoreId(request);

                    if (method === 'GET') {
                        await this.logGetOperation(userId, organizationId, storeId, url, query);
                    } else if (method === 'POST' && this.isCreateOperation(url)) {
                        await this.logCreateOperation(userId, organizationId, storeId, url, data);
                    } else if ((method === 'PUT' || method === 'PATCH') && this.isUpdateOperation(url, method)) {
                        await this.logUpdateOperation(userId, organizationId, storeId, url, body, data);
                    } else if (
                        (method === 'DELETE' || url.includes('/delete')) &&
                        this.isDeleteOperation(url, method)
                    ) {
                        await this.logDeleteOperation(userId, organizationId, storeId, url);
                    }
                } catch (error) {
                    // Error logging audit
                }
            }),
        );
    }

    private getOrganizationId(request: any): number | undefined {
        // 1. Del usuario autenticado
        if (request.user?.organization_id) {
            return request.user.organization_id;
        }

        // 2. Intentar obtener del body o query o params
        const bodyOrgId = request.body?.organization_id || request.body?.organizationId;
        const queryOrgId = request.query?.organization_id || request.query?.organizationId;
        const paramOrgId = request.params?.organization_id || request.params?.organizationId;

        if (bodyOrgId) return parseInt(bodyOrgId);
        if (queryOrgId) return parseInt(queryOrgId);
        if (paramOrgId) return parseInt(paramOrgId);

        // 3. Intentar extraer de la URL si tiene el patrón /organizations/:id/
        const urlSegments = request.url.split('/');
        const orgIndex = urlSegments.indexOf('organizations');
        if (orgIndex !== -1 && urlSegments[orgIndex + 1]) {
            const id = parseInt(urlSegments[orgIndex + 1]);
            if (!isNaN(id)) return id;
        }

        return undefined;
    }

    private getStoreId(request: any): number | undefined {
        // 1. Del usuario autenticado
        if (request.user?.store_id) {
            return request.user.store_id;
        }

        // 2. Intentar obtener del body o query o params
        const bodyStoreId = request.body?.store_id || request.body?.storeId;
        const queryStoreId = request.query?.store_id || request.query?.storeId;
        const paramStoreId = request.params?.store_id || request.params?.storeId || request.params?.id; // En rutas de stores, :id suele ser el storeId

        // Si la URL empieza por /store/ o contiene /stores/, el siguiente segmento suele ser el ID en rutas RESTful
        const urlSegments = request.url.split('?')[0].split('/').filter(s => s);

        if (bodyStoreId) return parseInt(bodyStoreId);
        if (queryStoreId) return parseInt(queryStoreId);
        if (paramStoreId && request.url.includes('/stores/')) return parseInt(paramStoreId);

        // 3. Lógica específica de segmentos URL
        const storeIndex = urlSegments.indexOf('stores');
        if (storeIndex !== -1 && urlSegments[storeIndex + 1]) {
            const id = parseInt(urlSegments[storeIndex + 1]);
            if (!isNaN(id)) return id;
        }

        return undefined;
    }

    private isCreateOperation(url: string): boolean {
        return (
            url.includes('/create') ||
            url.includes('/register') ||
            (url.includes('/api/') &&
                !url.includes('/update') &&
                !url.includes('/edit') &&
                !url.includes('/delete')) ||
            // General REST POST usually means create if not a specific action
            (!url.includes('/search') && !url.includes('/login') && !url.includes('/logout'))
        );
    }

    private isUpdateOperation(url: string, method: string): boolean {
        return (
            url.includes('/update') ||
            url.includes('/edit') ||
            ((method === 'PUT' || method === 'PATCH') &&
                !url.includes('/create') &&
                !url.includes('/register') &&
                !url.includes('/delete'))
        );
    }

    private isDeleteOperation(url: string, method: string): boolean {
        return method === 'DELETE' || url.includes('/delete') || url.includes('/remove');
    }

    private async logGetOperation(userId: number, organizationId: number | undefined, storeId: number | undefined, url: string, query: any) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url);

        if (resource) {
            const hasQuery = Object.keys(query).length > 0;
            const action = hasQuery ? AuditAction.SEARCH : AuditAction.VIEW;

            await this.auditService.log({
                userId,
                organizationId,
                storeId,
                action,
                resource,
                resourceId: resourceId || undefined,
                metadata: hasQuery ? { query } : undefined,
            });
        }
    }

    private async logCreateOperation(userId: number, organizationId: number | undefined, storeId: number | undefined, url: string, data: any) {
        const resource = this.extractResourceFromUrl(url);
        if (resource && data?.id) {
            await this.auditService.log({
                userId,
                organizationId,
                storeId,
                action: AuditAction.CREATE,
                resource,
                resourceId: data.id,
                newValues: data,
            });
        }
    }

    private async logUpdateOperation(
        userId: number,
        organizationId: number | undefined,
        storeId: number | undefined,
        url: string,
        oldData: any,
        newData: any,
    ) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url) || newData?.id || oldData?.id;

        if (resource && resourceId) {
            await this.auditService.log({
                userId,
                organizationId,
                storeId,
                action: AuditAction.UPDATE,
                resource,
                resourceId,
                oldValues: oldData,
                newValues: newData,
                metadata: { method: 'UPDATE' }
            });
        }
    }

    private async logDeleteOperation(userId: number, organizationId: number | undefined, storeId: number | undefined, url: string) {
        const resource = this.extractResourceFromUrl(url);
        const resourceId = this.extractIdFromUrl(url);
        if (resource && resourceId) {
            await this.auditService.log({
                userId,
                organizationId,
                storeId,
                action: AuditAction.DELETE,
                resource,
                resourceId,
                oldValues: {},
            });
        }
    }

    private extractResourceFromUrl(url: string): AuditResource | string | null {
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
            addresses: AuditResource.ADDRESSES,
            categories: AuditResource.CATEGORIES,
            brands: AuditResource.BRANDS,
            customers: AuditResource.CUSTOMERS,
            suppliers: AuditResource.SUPPLIERS,
            inventory: AuditResource.INVENTORY,
            'stock-levels': AuditResource.STOCK_LEVELS,
            transactions: AuditResource.TRANSACTIONS,
            payments: AuditResource.PAYMENTS,
            taxes: AuditResource.TAXES,
            domains: AuditResource.DOMAINS,
            settings: AuditResource.SETTINGS,
            'onboarding-wizard': AuditResource.SYSTEM,
            'onboarding': AuditResource.SYSTEM,
            'upload': AuditResource.SYSTEM,
        };

        // Try to find the most specific resource (last matching segment)
        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i];
            if (resourceMap[segment]) {
                return resourceMap[segment];
            }
        }

        return null;
    }

    private extractIdFromUrl(url: string): number | null {
        const cleanUrl = url.split('?')[0];
        const segments = cleanUrl.split('/').filter((s) => s);
        // Look for the last numeric segment that isn't at a known resource position
        for (let i = segments.length - 1; i >= 0; i--) {
            const id = parseInt(segments[i]);
            if (!isNaN(id) && segments[i].length < 10) { // Simple check to avoid some large numbers/timestamps if any
                return id;
            }
        }
        return null;
    }
}

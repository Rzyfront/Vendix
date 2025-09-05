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
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const handler = context.getHandler();
    const controller = context.getClass();

    const userId = request.user?.id;
    const method = request.method;
    const url = request.url;

    // Solo auditar si hay usuario autenticado
    if (!userId) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (data) => {
        try {
          // Detectar tipo de operación basado en el método HTTP y URL
          if (method === 'POST' && this.isCreateOperation(url)) {
            await this.logCreateOperation(userId, url, data);
          } else if (method === 'PUT' && this.isUpdateOperation(url, method)) {
            await this.logUpdateOperation(userId, url, request.body, data);
          } else if (method === 'DELETE' && this.isDeleteOperation(url)) {
            await this.logDeleteOperation(userId, url);
          }
        } catch (error) {
          console.error('Error en AuditInterceptor:', error);
        }
      }),
    );
  }

  private isCreateOperation(url: string): boolean {
    return url.includes('/create') || url.includes('/register') || !url.includes('/');
  }

  private isUpdateOperation(url: string, method: string): boolean {
    return url.includes('/update') || url.includes('/edit') || method === 'PUT';
  }

  private isDeleteOperation(method: string): boolean {
    return method === 'DELETE';
  }

  private async logCreateOperation(userId: number, url: string, data: any) {
    const resource = this.extractResourceFromUrl(url);
    if (resource && data?.id) {
      await this.auditService.logCreate(userId, resource, data.id, data);
    }
  }

  private async logUpdateOperation(userId: number, url: string, oldData: any, newData: any) {
    const resource = this.extractResourceFromUrl(url);
    if (resource && newData?.id) {
      await this.auditService.logUpdate(userId, resource, newData.id, oldData, newData);
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
    const segments = url.split('/').filter(s => s);
    const resourceMap: Record<string, AuditResource> = {
      'users': AuditResource.USERS,
      'organizations': AuditResource.ORGANIZATIONS,
      'stores': AuditResource.STORES,
      'products': AuditResource.PRODUCTS,
      'orders': AuditResource.ORDERS,
    };

    for (const segment of segments) {
      if (resourceMap[segment]) {
        return resourceMap[segment];
      }
    }

    return null;
  }

  private extractIdFromUrl(url: string): number | null {
    const segments = url.split('/').filter(s => s);
    for (const segment of segments) {
      const id = parseInt(segment);
      if (!isNaN(id)) {
        return id;
      }
    }
    return null;
  }
}

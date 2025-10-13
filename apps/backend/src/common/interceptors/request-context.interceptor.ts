import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService, RequestContext } from '../context/request-context.service';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const user = req.user;
    const requestId = req.headers['x-request-id'] || Math.random().toString(36).substring(2, 10);

    // Log forzado para saber si el interceptor se ejecuta
    console.error(`[CTX-INT] Interceptor ejecutado para path: ${req.path} | user: ${user ? 'SI' : 'NO'}`);

    if (!user) {
      return next.handle();
    }

    const roles = user.user_roles?.map(ur => ur.roles?.name).filter(Boolean) || [];
    const is_super_admin = roles.includes('super_admin');
    const is_owner = roles.includes('owner');

    const organization_id = user.organization_id;
    const store_id = user.store_id;

    const contextObj: RequestContext = {
      user_id: user.id,
      organization_id: organization_id,
      store_id: store_id,
      roles,
      is_super_admin,
      is_owner,
      email: user.email,
    };

    // Forzar log a stderr para Docker
    console.error(`[${requestId}] [CTX-INT] Context set: User ${user.id} | Org ${contextObj.organization_id || 'N/A'} | Store ${contextObj.store_id || 'N/A'} | Roles: ${roles.join(', ')}`);

    return RequestContextService.asyncLocalStorage.run(contextObj, () => {
      return next.handle();
    });
  }
}

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  RequestContextService,
  RequestContext,
} from '../context/request-context.service';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const requestId = req.headers['x-request-id'] || 'unknown';
    const user = req.user;
    if (!user) return next.handle();

    const roles =
      user.user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];
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

    return RequestContextService.asyncLocalStorage.run(contextObj, () => {
      return next.handle();
    });
  }
}

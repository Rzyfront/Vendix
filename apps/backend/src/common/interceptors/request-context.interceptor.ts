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
    const user = req.user;

    // Create a base context object
    const contextObj: RequestContext = {
      is_super_admin: false,
      is_owner: false,
    };

    if (user) {
      const roles =
        user.user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];

      contextObj.user_id = user.id;
      contextObj.organization_id = user.organization_id;
      contextObj.store_id = user.store_id;
      contextObj.roles = roles;
      contextObj.is_super_admin = roles.includes('super_admin');
      contextObj.is_owner = roles.includes('owner');
      contextObj.email = user.email;
    }

    // Always run within AsyncLocalStorage to ensure a request-safe context
    return RequestContextService.asyncLocalStorage.run(contextObj, () => {
      return next.handle();
    });
  }
}

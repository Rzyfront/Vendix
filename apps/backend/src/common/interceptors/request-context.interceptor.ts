import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  RequestContextService,
  RequestContext,
} from '../context/request-context.service';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContextInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const user = req.user;
    const domain_context = req['domain_context'];

    // Create context object
    const contextObj: RequestContext = {
      is_super_admin: false,
      is_owner: false,
    };

    // Combined Context Logic
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

    // In ecommerce routes, the DomainResolverMiddleware might have found a store_id
    // This has priority or fills the gap for non-authenticated users
    if (domain_context) {
      if (domain_context.store_id) {
        contextObj.store_id = domain_context.store_id;
      }
      if (domain_context.organization_id && !contextObj.organization_id) {
        contextObj.organization_id = domain_context.organization_id;
      }
    }

    this.logger.debug(
      `Context Initialized: store_id=${contextObj.store_id}, user_id=${contextObj.user_id}, path=${req.originalUrl}`,
    );

    // Always run within AsyncLocalStorage to ensure a request-safe context
    return RequestContextService.asyncLocalStorage.run(contextObj, () => {
      return next.handle();
    });
  }
}

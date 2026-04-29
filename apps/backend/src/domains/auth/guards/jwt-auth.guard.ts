import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '@common/decorators/optional-auth.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    // CORS preflight: OPTIONS requests carry no credentials by spec.
    // Always allow them to pass — `app.enableCors()` handles the actual
    // preflight response. Without this short-circuit, any upstream proxy
    // that bypasses the cors middleware (or rewrites the request) causes
    // the guard to throw 401 → browser reports "preflight does not have
    // HTTP ok status".
    if (request.method === 'OPTIONS') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Check if the route is one of the public routes
    const path = request.path;
    const publicPaths = ['/api/health', '/api-docs'];
    if (
      publicPaths.some(
        (publicPath) =>
          path === publicPath || path.startsWith(publicPath + '/'),
      )
    ) {
      return true;
    }

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isOptionalAuth) {
      return super.canActivate(context);
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isOptionalAuth && (err || !user)) {
      return null;
    }
    return super.handleRequest(err, user, info, context);
  }
}

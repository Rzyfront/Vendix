import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Check if the route is one of the public routes
    const request = context.switchToHttp().getRequest();
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

    console.log('JWT Guard - Path:', path, 'Is Public:', isPublic);
    console.log(
      'JWT Guard - Headers:',
      request.headers.authorization ? 'Bearer token present' : 'No auth header',
    );

    return super.canActivate(context);
  }
}

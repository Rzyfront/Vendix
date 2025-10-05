import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.organizationId) {
      throw new UnauthorizedException('No organization scope found in token.');
    }

    // Inject organizationId into the query params for services to use
    request.query.organization_id = user.organizationId;

    return true;
  }
}

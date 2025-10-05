import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class StoreScopeGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If the token includes a storeId, inject it into the query params.
    if (user && user.storeId) {
      request.query.store_id = user.storeId;
    }

    // This guard does not block requests, it only injects the storeId if present.
    // Other guards or service logic should handle authorization if a storeId is required.
    return true;
  }
}

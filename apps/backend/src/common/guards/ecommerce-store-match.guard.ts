import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { ErrorCodes, VendixHttpException } from '../errors';

/**
 * QUI-966 (S1) — pins an authenticated ecommerce request to the store its
 * token was issued for.
 *
 * `DomainResolverMiddleware` resolves the store from `x-store-id` / `?store_id`
 * / hostname, and `RequestContextInterceptor` lets that value override the
 * JWT's `store_id`. Without this gate a customer of store A could create
 * bookings, holds and orders in store B (even of another organization) just
 * by changing the header.
 *
 * Synchronous on purpose: both values are already on the request, so there is
 * no Prisma lookup (see `StoreTenantGuard` for why async work in interceptors
 * breaks the AsyncLocalStorage scope). `@Public()` handlers are skipped — a
 * shopper browsing another store's availability with a stale token is fine.
 */
@Injectable()
export class EcommerceStoreMatchGuard implements CanActivate {
  private readonly logger = new Logger(EcommerceStoreMatchGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    // No user → the JWT guard already decided (401) or the route is open.
    if (!user) return true;

    const domainStoreId = Number(req?.domain_context?.store_id);
    if (!Number.isInteger(domainStoreId) || domainStoreId <= 0) return true;

    const tokenStoreId = Number(user.store_id);
    if (tokenStoreId === domainStoreId) return true;

    this.logger.warn(
      `Blocked cross-store ecommerce request: user_id=${user.id} token_store=${user.store_id ?? 'none'} resolved_store=${domainStoreId}`,
    );
    throw new VendixHttpException(ErrorCodes.ECOM_STORE_MISMATCH_001, undefined, {
      token_store_id: user.store_id ?? null,
      resolved_store_id: domainStoreId,
    });
  }
}

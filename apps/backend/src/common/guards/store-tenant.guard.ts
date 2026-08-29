import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../errors';

/**
 * CP-DTLP-20260827 — IDOR fix for `POST /store/print-formats/render` (H-1).
 *
 * Background: before this gate the print gateway accepted whatever
 * `x-store-id` the caller sent and trusted it to resolve a store. A token
 * belonging to `tech-solutions` (org=2) carrying `x-store-id: 999` rendered
 * an order owned by `org=3` — the gateway happily executed because every
 * downstream lookup keyed off the header, never off the JWT.
 *
 * Implementation: NestJS Guard (`CanActivate`) returning Promise<boolean>.
 * Reads `x-store-id` from the request, looks up the store unscoped via
 * `GlobalPrismaService`, compares `store.organization_id` against the
 * JWT's `organization_id`. Mismatches throw
 * `VendixHttpException(PRINT_RENDER_TENANT_MISMATCH_001)` which the global
 * exception filter renders as HTTP 403.
 *
 * Why a Guard, not an Interceptor:
 *   - v1 was an Interceptor wrapping `next.handle()` inside a `switchMap`
 *     over `from(prisma.findUnique(...))`. The prisma promise resolved in a
 *     microtask scheduled inside the AsyncLocalStorage.run() set up by
 *     RequestContextInterceptor, but `switchMap`'s continuation ran on a
 *     later tick that had already exited the AsyncLocalStorage scope. Result:
 *     `RequestContextService.getContext() === undefined` for every request
 *     hitting the controller, throwing `ROLE_SCOPE_003` and making the
 *     entire `/store/print-formats` surface unusable.
 *   - Guards run synchronously (or with Promise<boolean>) BEFORE the
 *     RequestContextInterceptor chain — they don't subscribe to anything, so
 *     the asyncLocalStorage scope set up later is intact. The async prisma
 *     lookup happens inside the guard's own Promise context; if it throws,
 *     the request never reaches the controller. If it passes, the controller
 *     runs with the AsyncLocalStorage that the next interceptor sets up.
 *   - Domain-resolver middleware only populates `req['domain_context']` for
 *     `/ecommerce/` paths, so we cannot rely on that here — we MUST hit
 *     Prisma. The guard is the right tool because it can await the lookup.
 *
 * Why `GlobalPrismaService` (unscoped): the comparison is across tenants by
 * definition; a service scoped to `request.user.organization_id` would
 * tautologically always agree.
 */
@Injectable()
export class StoreTenantGuard implements CanActivate {
  private readonly logger = new Logger(StoreTenantGuard.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest();

    // Header is optional — let the controller/DTO surface its own validation
    // error if it's missing. Guards should not duplicate DTO validation.
    const xStoreIdHeader = req?.headers?.['x-store-id'];
    const xStoreIdRaw = Array.isArray(xStoreIdHeader)
      ? xStoreIdHeader[0]
      : xStoreIdHeader;
    if (xStoreIdRaw === undefined || xStoreIdRaw === null || xStoreIdRaw === '') {
      return true;
    }

    const parsedStoreId = Number(xStoreIdRaw);
    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
      // Same shape-error policy as missing — DTO/ValidationPipe will reject
      // a non-numeric store id; this gate only cares about tenant ownership.
      return true;
    }

    const user = req?.user;
    const jwtOrganizationId = user?.organization_id;
    if (jwtOrganizationId === undefined || jwtOrganizationId === null) {
      this.logger.warn(
        `Refusing render: JWT has no organization_id (user_id=${user?.id ?? 'unknown'})`,
      );
      throw new VendixHttpException(
        ErrorCodes.PRINT_RENDER_TENANT_MISMATCH_001,
        undefined,
        { reason: 'jwt_missing_organization_id' },
      );
    }

    const store = await this.globalPrisma.stores.findUnique({
      where: { id: parsedStoreId },
      select: { organization_id: true },
    });
    if (!store) {
      // STORE_FIND_001 — canonical "store not found". DTO never sees the id.
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }
    if (store.organization_id !== jwtOrganizationId) {
      this.logger.warn(
        `Blocked cross-tenant render: jwt_org=${jwtOrganizationId} x-store-id=${parsedStoreId} store_org=${store.organization_id}`,
      );
      throw new VendixHttpException(
        ErrorCodes.PRINT_RENDER_TENANT_MISMATCH_001,
        undefined,
        {
          jwt_organization_id: jwtOrganizationId,
          x_store_id: parsedStoreId,
          store_organization_id: store.organization_id,
        },
      );
    }

    return true;
  }
}

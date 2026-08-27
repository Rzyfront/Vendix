import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../errors';

/**
 * CP-DTLP-20260827 — IDOR fix for `POST /store/print-formats/render` (H-1).
 *
 * Background: before this gate the print gateway accepted whatever
 * `x-store-id` the caller sent and trusted it to resolve a store. A token
 * belonging to `tech-solutions` (org=2) carrying `x-store-id: 999` rendered
 * an order owned by `org=3` — the gateway happily executed because every
 * downstream lookup keyed off the header, never off the JWT.
 *
 * What it does: validates that the store resolved from `x-store-id` belongs
 * to the same `organization_id` that issued the JWT, BEFORE the request
 * reaches the gateway. Mismatches answer `PRINT_RENDER_TENANT_MISMATCH_001`
 * (403). Missing `x-store-id` is a no-op here — the controller will surface
 * its own `400` validation error against the DTO, so we deliberately do not
 * pre-validate shape.
 *
 * Why `GlobalPrismaService` and not a scoped store service: the whole point
 * of this check is to compare two different organizations, so a service that
 * is itself scoped to `request.user.organization_id` would tautologically
 * always agree. We need the unscoped read.
 */
@Injectable()
export class StoreTenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(StoreTenantInterceptor.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();

    // Header is optional — let the controller/DTO surface the validation
    // error if it's missing. Interceptors should not duplicate DTO
    // validation rules.
    const xStoreIdHeader = req?.headers?.['x-store-id'];
    const xStoreIdRaw = Array.isArray(xStoreIdHeader)
      ? xStoreIdHeader[0]
      : xStoreIdHeader;
    if (xStoreIdRaw === undefined || xStoreIdRaw === null || xStoreIdRaw === '') {
      return next.handle();
    }

    const parsedStoreId = Number(xStoreIdRaw);
    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
      // Same logic as missing: a non-numeric `x-store-id` is a shape error
      // that the DTO/ValidationPipe will reject; this gate only cares about
      // tenant ownership of a syntactically valid identifier.
      return next.handle();
    }

    const user = req?.user;
    const jwtOrganizationId = user?.organization_id;
    if (jwtOrganizationId === undefined || jwtOrganizationId === null) {
      // If the JWT does not carry an organization_id we cannot prove the
      // store belongs to the caller. Fail closed: cross-tenant is exactly
      // what this interceptor exists to prevent.
      this.logger.warn(
        `Refusing render: JWT has no organization_id (user_id=${user?.id ?? 'unknown'})`,
      );
      throw new VendixHttpException(
        ErrorCodes.PRINT_RENDER_TENANT_MISMATCH_001,
        undefined,
        { reason: 'jwt_missing_organization_id' },
      );
    }

    // Look up the store from the unscoped global client — the comparison is
    // across tenants by definition.
    return from(
      this.globalPrisma.stores.findUnique({
        where: { id: parsedStoreId },
        select: { organization_id: true },
      }),
    ).pipe(
      switchMap((store) => {
        if (!store) {
          // Use STORE_FIND_001 (404) — the DTO/ValidationPipe never sees a
          // store id, this is the canonical "store not found" code.
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
        return next.handle();
      }),
    );
  }
}
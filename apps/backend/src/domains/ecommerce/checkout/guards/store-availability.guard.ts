import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Blocks ecommerce checkout when the store has been explicitly marked as
 * unavailable (`settings.ecommerce.general.store_available === false`).
 *
 * The store is resolved from `req['domain_context'].store_id`, populated by
 * DomainResolverMiddleware on ecommerce routes. We read it directly off the
 * request (NOT RequestContextService / AsyncLocalStorage) because the
 * RequestContextInterceptor runs AFTER guards, so the ALS context is not yet
 * populated at this stage — same rationale documented in StoreOperationsGuard.
 *
 * Fail-open: when there is no store in context, or the flag is not EXACTLY
 * `false` (absent / `true`), the guard lets the request through. The default
 * (`store_available` absent) therefore behaves as `true`.
 */
@Injectable()
export class StoreAvailabilityGuard implements CanActivate {
  private readonly logger = new Logger(StoreAvailabilityGuard.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<
        Request & { domain_context?: { store_id?: number | null } }
      >();

    const storeId = req?.['domain_context']?.store_id;
    if (!storeId) return true;

    const row = await this.globalPrisma.store_settings.findFirst({
      where: { store_id: storeId },
      select: { settings: true },
    });

    const settings = row?.settings as
      | { ecommerce?: { general?: { store_available?: boolean } } }
      | null
      | undefined;

    if (settings?.ecommerce?.general?.store_available === false) {
      this.logger.warn(
        `Checkout blocked: store ${storeId} is unavailable (store_available=false)`,
      );
      throw new VendixHttpException(ErrorCodes.ECOM_CHECKOUT_004);
    }

    return true;
  }
}

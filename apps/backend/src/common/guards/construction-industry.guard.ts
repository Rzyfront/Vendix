import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../errors';
import { storeSupportsContracts } from '../helpers/industry-capabilities.helper';

/**
 * A.2 (ADR-02, ERR-03) — industry gate for the contracts flow.
 *
 * The contracts flow (quotation with `destination=contract`, contract
 * record, preloaded AIU invoice) is a special construction-regime flow.
 * Only stores whose `industries` include `construction` may use it; every
 * other store gets 403 `CONTRACT_INDUSTRY_001` ("No disponible en tu
 * industria"), even if the caller bypasses the hidden frontend menu with
 * curl/Postman. Menu visibility is UX only — this guard is the real
 * authorization boundary.
 *
 * Semantics mirror the frontend OR rule (`getModulesHiddenByIndustries`):
 * a multi-industry store that includes `construction` passes.
 *
 * Pass-through cases (other layers own those errors):
 * - No `store_id` on `req.user` (auth/context guards handle it).
 * - Store row not found (the domain's own NOT_FOUND owns it).
 *
 * Why `GlobalPrismaService` (unscoped): same reason as `StoreTenantGuard` —
 * the guard runs before the request-scoped context exists, so it must do
 * its own lookup.
 *
 * Wiring: C.1 applies it to the contracts controller
 * (`POST /store/contracts/from-quotation/:id`, `GET/PATCH /store/contracts/:id`)
 * and D.1 to the AIU invoice endpoint. It ships in A.2 so the 403 contract
 * (FB-02/ERR-03) exists before the first contracts endpoint does.
 */
@Injectable()
export class ConstructionIndustryGuard implements CanActivate {
  private readonly logger = new Logger(ConstructionIndustryGuard.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const storeId = req?.user?.store_id as number | null | undefined;

    // No store in context — not this guard's concern.
    if (!storeId) {
      return true;
    }

    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });

    // Unknown store — the domain's own NOT_FOUND owns that error.
    if (!store) {
      return true;
    }

    if (storeSupportsContracts(store.industries)) {
      return true;
    }

    this.logger.warn(
      `Blocked contracts flow: store_id=${storeId} industries=[${(store.industries ?? []).join(',') || 'none'}]`,
    );
    throw new VendixHttpException(
      ErrorCodes.CONTRACT_INDUSTRY_001,
      undefined,
      {
        store_id: storeId,
        industries: store.industries ?? [],
      },
    );
  }
}

import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../errors';
import { storeSupportsLodging } from '../helpers/industry-capabilities.helper';

/**
 * Hotelería (H0.1) — industry gate for the lodging inventory endpoints.
 *
 * Creating a room type creates a "Noche – {type}" service product, so a store
 * without the `hospitality` industry must not reach it even through curl:
 * 403 `LODGING_INDUSTRY_001`. Menu visibility is UX only. Same semantics and
 * pass-through cases as `ConstructionIndustryGuard` (no store in context or
 * unknown store: other layers own those errors).
 */
@Injectable()
export class LodgingIndustryGuard implements CanActivate {
  private readonly logger = new Logger(LodgingIndustryGuard.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const storeId = req?.user?.store_id as number | null | undefined;
    if (!storeId) {
      return true;
    }

    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    if (!store || storeSupportsLodging(store.industries)) {
      return true;
    }

    this.logger.warn(
      `Blocked lodging flow: store_id=${storeId} industries=[${(store.industries ?? []).join(',') || 'none'}]`,
    );
    throw new VendixHttpException(ErrorCodes.LODGING_INDUSTRY_001, undefined, {
      store_id: storeId,
      industries: store.industries ?? [],
    });
  }
}

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Refuses every Vexi endpoint when the store has the assistant switched off.
 *
 * The switch is enforced here as well as in the router and the sidebar because
 * hiding a UI is not disabling a feature: without this, a store that turned
 * Vexi off could still be driven through it with a bare `curl`, spending the
 * store's own AI quota.
 *
 * Absent setting means enabled — Vexi ships on, and a tenant whose settings row
 * predates the switch must not silently lose the assistant. Same reason a store
 * with no settings row at all passes: the switch has to be turned off on
 * purpose, never by omission.
 *
 * Reads the store id from `req.user` and queries with an explicit `store_id`
 * filter rather than going through `SettingsService`. Guards run *before* the
 * interceptor that populates the AsyncLocalStorage request context, so anything
 * that resolves the tenant from ALS throws `STORE_CONTEXT_001` here for every
 * request — the switch would stop being a switch and become an outage. Same
 * constraint `StoreOperationsGuard` works around.
 */
@Injectable()
export class VexiEnabledGuard implements CanActivate {
  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const reqUser = (req as Request & { user?: { store_id?: number | null } })
      .user;
    const storeId = reqUser?.store_id ?? RequestContextService.getStoreId();

    // No store in scope means this is not a store-tenant call; let the
    // downstream guards decide. Failing closed here would break org-level
    // callers that never had a store to check in the first place.
    if (!storeId) {
      return true;
    }

    const row = await this.globalPrisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });

    const settings = row?.settings as { vexi?: { enabled?: boolean } } | null;

    if (settings?.vexi?.enabled === false) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        'Vexi está desactivado para esta tienda. Un propietario o administrador puede volver a activarlo en Configuración → Vexi.',
      );
    }

    return true;
  }
}

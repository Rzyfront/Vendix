import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Opens the shared agent-engine endpoints under `/store/vexi/*` (confirmations,
 * read-aloud voice, objectives, attachments, ui-result, tasks, activity) only
 * when the store switched **Vex** on.
 *
 * History: these routes were born for the internal Vexi dock and opened with
 * `settings.vexi.enabled`. The internal Vexi is retired (Vexi now only serves
 * customers in the public apps, through `ecommerce/vexi-public`, which never
 * touches these routes), and Vex is the agent that still consumes them. So the
 * switch that opens them is `settings.vex.enabled`; the old `vexi.enabled`
 * opens nothing anymore. Without this, a store with Vex on but Vexi off would
 * get a Vex whose approvals and read-aloud voice fail.
 *
 * Absent setting means DISABLED: only an explicit `true` opens the endpoints.
 * The routes write to the merchant's own data, so it has to be a decision an
 * owner or admin took on purpose.
 *
 * Reads the store id from `req.user` and queries with an explicit `store_id`
 * filter rather than going through `SettingsService`. Guards run *before* the
 * interceptor that populates the AsyncLocalStorage request context, so anything
 * that resolves the tenant from ALS throws `STORE_CONTEXT_001` here for every
 * request. Same constraint `StoreOperationsGuard` works around.
 *
 * `/store/vexi/voice/confirmations/*` (mobile app) keeps bypassing this guard
 * through `VexiSurfaceEnabledGuard`.
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

    const settings = row?.settings as { vex?: { enabled?: boolean } } | null;

    if (settings?.vex?.enabled !== true) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        'Vex está desactivado para esta tienda. Un propietario o administrador puede activarlo en Configuración → Agentes IA.',
      );
    }

    return true;
  }
}

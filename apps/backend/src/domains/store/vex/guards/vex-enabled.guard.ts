import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/**
 * Refuses every Vex endpoint unless the store switched the agent on.
 *
 * A mirror of `VexiEnabledGuard` with its own switch (`settings.vex.enabled`)
 * and its own copy path (Configuración → Agentes IA, pestaña Vex): Vex and
 * Vexi are enabled independently, and Vex burns far more budget per turn
 * (longer iterations, bigger catalog), so sharing one toggle would let a store
 * that only wanted the dock pay for the full agent.
 *
 * Same fail-closed rule: only an explicit `true` opens the endpoints. Same
 * ALS constraint: guards run before the interceptor that populates the request
 * context, so the store id comes from `req.user` and the lookup goes through
 * `GlobalPrismaService` with an explicit `store_id` filter.
 */
@Injectable()
export class VexEnabledGuard implements CanActivate {
  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const reqUser = (req as Request & { user?: { store_id?: number | null } })
      .user;
    const storeId = reqUser?.store_id ?? RequestContextService.getStoreId();

    // No store in scope means this is not a store-tenant call; let the
    // downstream guards decide, exactly as the Vexi twin does.
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
        'Vex está desactivado para esta tienda. Un propietario o administrador puede volver a activarlo en Configuración → Agentes IA, pestaña Vex.',
      );
    }

    return true;
  }
}

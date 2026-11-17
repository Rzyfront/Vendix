import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
  createParamDecorator,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../common/services/platform-org.service';

/**
 * Tienda, organización y usuario ya verificados por {@link PlatformStoreGuard}.
 * Los handlers leen SOLO esto, nunca el token, para saber dónde operan.
 */
export interface PlatformCrmContext {
  store_id: number;
  organization_id: number;
  user_id: number;
}

export const PLATFORM_CRM_REQUEST_KEY = 'platformCrm';

/** Inyecta el {@link PlatformCrmContext} que dejó el guard en el request. */
export const PlatformCrmCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformCrmContext => {
    const request = ctx.switchToHttp().getRequest();
    const resolved = request?.[PLATFORM_CRM_REQUEST_KEY] as
      | PlatformCrmContext
      | undefined;
    // Sin guard no hay contexto: falla cerrado igual que el guard.
    if (!resolved) throw new NotFoundException();
    return resolved;
  },
);

function strictPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Candados 1, 4 y 5 de odd/tasks/vendix-platform-crm-enlace.md.
 *
 * Abre la ruta solo si TODO esto se cumple, leído de la base y no del token:
 * - `VENDIX_PLATFORM_ORG_ID` está definida y es un entero positivo;
 * - la tienda del request existe, está activa y su organización es
 *   `is_platform = true`;
 * - esa organización es la que resuelve `PlatformOrgService` Y la de la
 *   variable de entorno;
 * - el usuario pertenece a esa misma organización.
 *
 * No hay bypass por super admin ni por owner. Cualquier otro caso responde
 * `NotFoundException` (404), igual que una ruta inexistente: ninguna tienda
 * ajena puede distinguir que la función existe.
 */
@Injectable()
export class PlatformStoreGuard implements CanActivate {
  private readonly logger = new Logger(PlatformStoreGuard.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request?.user as
      | { id?: unknown; store_id?: unknown }
      | undefined;

    let resolved: PlatformCrmContext | null = null;
    let reason = 'unknown';
    try {
      ({ resolved, reason } = await this.resolve(user));
    } catch (error) {
      // Un fallo de lectura no puede abrir la ruta.
      reason = 'resolution_error';
      this.logger.error(
        `platform-crm guard resolution failed: ${(error as Error)?.message}`,
      );
    }

    if (!resolved) {
      this.logger.warn(
        JSON.stringify({
          event: 'PLATFORM_CRM_DENIED',
          reason,
          user_id: user?.id ?? null,
          store_id: user?.store_id ?? null,
          method: request?.method,
          path: request?.route?.path ?? request?.url,
        }),
      );
      throw new NotFoundException();
    }

    request[PLATFORM_CRM_REQUEST_KEY] = resolved;
    return true;
  }

  private async resolve(
    user: { id?: unknown; store_id?: unknown } | undefined,
  ): Promise<{ resolved: PlatformCrmContext | null; reason: string }> {
    const envOrgId = strictPositiveInt(process.env.VENDIX_PLATFORM_ORG_ID);
    if (!envOrgId) return { resolved: null, reason: 'env_missing' };

    const userId = strictPositiveInt(user?.id);
    const storeId = strictPositiveInt(user?.store_id);
    if (!userId || !storeId) return { resolved: null, reason: 'no_store_context' };

    const db = this.prisma.withoutScope();
    const store = await db.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        is_active: true,
        organization_id: true,
        organizations: { select: { is_platform: true } },
      },
    });
    if (!store || store.is_active !== true) {
      return { resolved: null, reason: 'store_unavailable' };
    }
    if (store.organizations?.is_platform !== true) {
      return { resolved: null, reason: 'store_not_platform' };
    }
    if (store.organization_id !== envOrgId) {
      return { resolved: null, reason: 'env_mismatch' };
    }

    const platformOrgId = await this.platformOrg.getPlatformOrganizationId();
    if (platformOrgId !== store.organization_id) {
      return { resolved: null, reason: 'platform_org_mismatch' };
    }

    const member = await db.users.findUnique({
      where: { id: userId },
      select: { organization_id: true },
    });
    if (member?.organization_id !== store.organization_id) {
      return { resolved: null, reason: 'user_outside_platform_org' };
    }

    return {
      resolved: {
        store_id: store.id,
        organization_id: store.organization_id,
        user_id: userId,
      },
      reason: 'ok',
    };
  }
}

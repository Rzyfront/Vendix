import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../errors';
import { INDUSTRY_MODULE_KEY } from '../decorators/industry-module.decorator';
import { AccessAuditLogger } from '../access/access-audit.logger';
import { AccessGateModeService } from '../access/access-gate-mode.service';
import {
  industryAllowsKey,
  normalizeModuleIndustries,
} from '../access/module-industries';

/**
 * apps-f4 S7 — industry gate by panel module key (`@IndustryModule(key)`).
 *
 * `audit` mode (default): logs `would_block` and lets the request through.
 * `enforce` mode (Redis flag): logs `blocked` and throws 403 `MODULE_INDUSTRY_001`.
 * No store in context or unknown store: other layers own those errors.
 * Must run after the global JWT guard (needs `req.user`).
 */
@Injectable()
export class IndustryModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly modeService: AccessGateModeService,
    private readonly auditLogger: AccessAuditLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(
      INDUSTRY_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!key) return true;

    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    const storeId = user?.store_id as number | null | undefined;
    if (!storeId) return true;

    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    if (!store || industryAllowsKey(key, store.industries)) return true;

    const mode = await this.modeService.modeForStore(storeId);
    const enforce = mode === 'enforce';
    this.auditLogger.record({
      source: 'backend',
      surface: 'api',
      store_id: storeId,
      organization_id: user.organization_id ?? null,
      user_id: user.id ?? null,
      role: Array.isArray(user.roles) ? (user.roles[0] ?? null) : null,
      key,
      industry: normalizeModuleIndustries(store.industries),
      decision: enforce ? 'blocked' : 'would_block',
      layer: 'industry',
      route: this.routeOf(req),
      mode,
    });

    if (!enforce) return true;
    throw new VendixHttpException(
      ErrorCodes.MODULE_INDUSTRY_001,
      'Este módulo no está disponible para la industria de tu tienda.',
      { key },
    );
  }

  private routeOf(req: any): string {
    const pattern: string | undefined = req?.route?.path;
    const path =
      pattern ?? String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
    return `${String(req?.method ?? 'GET').toUpperCase()} ${path}`;
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';

export const MODULE_FLOW_KEY = 'module_flow';
export const RequireModuleFlow = (module: 'accounting' | 'payroll' | 'invoicing') =>
  SetMetadata(MODULE_FLOW_KEY, module);

@Injectable()
export class ModuleFlowGuard implements CanActivate {
  private readonly logger = new Logger(ModuleFlowGuard.name);
  private cache = new Map<string, { enabled: boolean; expires: number }>();

  constructor(
    private reflector: Reflector,
    private prisma: StorePrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<string>(MODULE_FLOW_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;

    const request = context.switchToHttp().getRequest();
    const store_id = request.store_id ?? request.context?.store_id;
    if (!store_id) return true;

    const cache_key = `${store_id}_${module}`;
    const cached = this.cache.get(cache_key);
    if (cached && cached.expires > Date.now()) {
      if (!cached.enabled) {
        throw new ForbiddenException(`Module "${module}" is disabled for this store`);
      }
      return true;
    }

    try {
      const settings = await this.prisma.withoutScope().store_settings.findUnique({
        where: { store_id },
        select: { settings: true },
      });
      const s = (settings?.settings as any) || {};

      let enabled: boolean;
      if (s.module_flows?.[module]) {
        enabled = s.module_flows[module].enabled !== false;
      } else if (module === 'accounting' && s.accounting_flows) {
        // Legacy fallback: accounting_flows exists = module was implicitly enabled
        enabled = true;
      } else if (!s.module_flows) {
        // No module_flows at all = legacy store, all modules implicitly enabled
        enabled = true;
      } else {
        // module_flows exists but this specific module is not configured
        enabled = false;
      }

      this.cache.set(cache_key, { enabled, expires: Date.now() + 5 * 60 * 1000 });

      if (!enabled) {
        throw new ForbiddenException(`Module "${module}" is disabled for this store`);
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;

      // Fail-closed: usar cache expirado como fallback, sino denegar
      const stale = this.cache.get(cache_key);
      if (stale) {
        this.logger.warn(
          `DB error for module "${module}" store ${store_id}, using expired cache (enabled=${stale.enabled})`,
        );
        if (!stale.enabled) {
          throw new ForbiddenException(`Module "${module}" is disabled for this store`);
        }
        return true;
      }

      this.logger.warn(
        `DB error for module "${module}" store ${store_id}, no cache available — denying access`,
      );
      return false;
    }
  }
}

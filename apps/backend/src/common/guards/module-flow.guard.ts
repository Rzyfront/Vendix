import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Reflector } from '@nestjs/core';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { FiscalStatusResolverService } from '../services/fiscal-status-resolver.service';

export const MODULE_FLOW_KEY = 'module_flow';
export const RequireModuleFlow = (
  module: 'accounting' | 'payroll' | 'invoicing',
) => SetMetadata(MODULE_FLOW_KEY, module);

/**
 * Skip the ModuleFlowGuard for a specific handler/controller.
 *
 * Use this for "bootstrap" endpoints that the fiscal-status wizard needs
 * to call BEFORE the module is fully ACTIVE (i.e. while it is in WIP).
 * Without this, the guard would 403 the very endpoints required to
 * populate the data that transitions the module from WIP to ACTIVE,
 * creating a deadlock.
 *
 * Do NOT apply to day-to-day operations (creating journal entries,
 * emitting invoices, running payroll, etc.). Those must keep the
 * `@RequireModuleFlow(...)` gate.
 */
export const SKIP_MODULE_FLOW_KEY = 'skip_module_flow';
export const SkipModuleFlowGuard = () =>
  SetMetadata(SKIP_MODULE_FLOW_KEY, true);

@Injectable()
export class ModuleFlowGuard implements CanActivate {
  private readonly logger = new Logger(ModuleFlowGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: StorePrismaService,
    private fiscalStatusResolver: FiscalStatusResolverService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<string>(MODULE_FLOW_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;

    // Bootstrap bypass: endpoints used by the fiscal-status wizard to
    // transition a module from WIP -> ACTIVE must not be blocked by the
    // very gate they are trying to satisfy.
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_MODULE_FLOW_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const store_id =
      request.store_id ?? request.context?.store_id ?? request.user?.store_id;
    const organization_id =
      request.organization_id ??
      request.context?.organization_id ??
      request.user?.organization_id;
    if (!store_id && !organization_id) return true;

    const cacheKey = `mflow:${organization_id ?? 'org'}:${store_id ?? 'none'}:${module}`;
    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== undefined && cached !== null) {
      if (!cached) {
        throw new ForbiddenException(
          `Module "${module}" is disabled for this store`,
        );
      }
      return true;
    }

    try {
      if (organization_id) {
        try {
          const fiscalStatus = await this.fiscalStatusResolver.getStatusBlock(
            Number(organization_id),
            store_id ? Number(store_id) : null,
          );
          if (fiscalStatus.source_exists) {
            const state = fiscalStatus.fiscal_status[module as any]?.state;
            const enabledByFiscalStatus =
              state === 'ACTIVE' || state === 'LOCKED';
            await this.cache.set(cacheKey, enabledByFiscalStatus, 300_000);

            if (!enabledByFiscalStatus) {
              throw new ForbiddenException(
                `Fiscal area "${module}" is inactive for this tenant`,
              );
            }
            return true;
          }
        } catch (error) {
          if (error instanceof ForbiddenException) throw error;
          if (!store_id) return true;
        }
      }

      if (!store_id) return true;

      const settings = await this.prisma
        .withoutScope()
        .store_settings.findUnique({
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

      await this.cache.set(cacheKey, enabled, 300_000);

      if (!enabled) {
        throw new ForbiddenException(
          `Module "${module}" is disabled for this store`,
        );
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;

      this.logger.warn(
        `DB error for module "${module}" store ${store_id}, no cache available — denying access`,
      );
      return false;
    }
  }
}

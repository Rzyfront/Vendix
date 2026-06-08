import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FiscalArea } from '../interfaces/fiscal-status.interface';
import { FiscalGateService } from '../services/fiscal-gate.service';

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

/**
 * Gatea endpoints HTTP por área fiscal maestra. Delega toda la regla
 * (fiscal_status manda, module_flows refina, default estricto, fallback
 * legacy) en FiscalGateService — única fuente compartida con el listener
 * de auto-asientos. No cachea localmente: el resolver subyacente ya tiene
 * caché de 30s con invalidación al activar/desactivar áreas, evitando el
 * 403 fantasma de hasta 5min tras activar el wizard.
 */
@Injectable()
export class ModuleFlowGuard implements CanActivate {
  private readonly logger = new Logger(ModuleFlowGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly fiscalGate: FiscalGateService,
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

    // Sin contexto de organización no se puede resolver el área fiscal maestra;
    // mantener el comportamiento permisivo previo para esos requests.
    if (!organization_id) return true;

    try {
      const enabled = await this.fiscalGate.isAreaEnabled(
        Number(organization_id),
        store_id != null ? Number(store_id) : null,
        module as FiscalArea,
      );
      if (!enabled) {
        throw new ForbiddenException(
          `Fiscal area "${module}" is inactive for this tenant`,
        );
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.warn(
        `Module flow check failed for "${module}" (org ${organization_id}) — denying access: ${(error as Error).message}`,
      );
      return false;
    }
  }
}

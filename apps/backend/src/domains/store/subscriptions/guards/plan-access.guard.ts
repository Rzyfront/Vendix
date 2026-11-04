import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { AccessAuditLogger } from '../../../../common/access/access-audit.logger';
import { AccessGateModeService } from '../../../../common/access/access-gate-mode.service';
import { AccessGateMode } from '../../../../common/access/access-audit.types';
import {
  isSaleFlow,
  mappedPlanModuleForApiPath,
  planModuleForApiPath,
} from '../../../../common/access/plan-modules';
import { CurrentPlan, PlanAccessService } from '../services/plan-access.service';

interface GateUser {
  id?: number | null;
  store_id?: number | null;
  organization_id?: number | null;
  roles?: string[] | null;
}

/**
 * Plan layer of the access gate on HTTP (odd/tasks/planes-matriz-accesos.md
 * §4.2). Global, registered after JwtAuthGuard, DomainScopeGuard and
 * StoreOperationsGuard, so `req.user` is populated and the subscription gate
 * already ran.
 *
 * - Only API paths mapped in `PLAN_MODULE_API_ROUTES` are evaluated; public
 *   routes, dashboard, subscription, account, help/support and health are not
 *   in the map (or are listed in `PLAN_GATE_EXEMPT_API_PREFIXES`).
 * - `audit` (default): records `would_block` (layer `plan`) and lets through.
 * - `enforce` (Redis `access_gate:plan:enforce:all|store:<id>` = '1'): records
 *   `blocked` and throws `403 PLAN_MODULE_NOT_INCLUDED` with
 *   `{ module, current_plan, required_plans, upgrade_url }`.
 * - Sale flow (`isSaleFlow`, plan-modules.ts): NEVER 403. A sale endpoint
 *   under a module the plan lacks is let through in every mode and recorded
 *   as `would_block` with the real mode, so `would_block` + `enforce` in the
 *   audit log reads "a sale used a module outside the plan".
 * - Super admin passes. Any internal failure lets the request through.
 */
@Injectable()
export class PlanAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planAccess: PlanAccessService,
    private readonly modeService: AccessGateModeService,
    private readonly auditLogger: AccessAuditLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: GateUser }>();
    const path = String(req?.originalUrl ?? req?.url ?? '');
    const method = String(req?.method ?? 'GET');
    const saleFlow = isSaleFlow({ apiPath: path, method });
    const moduleKey = saleFlow
      ? mappedPlanModuleForApiPath(path)
      : planModuleForApiPath(path, method);
    if (!moduleKey) return true;

    const user = req.user;
    if (!user) return true;
    if (Array.isArray(user.roles) && user.roles.includes('super_admin')) {
      return true;
    }

    const isOrgPath = path.toLowerCase().startsWith('/api/organization/');
    let mode: AccessGateMode;
    let current: CurrentPlan | null = null;
    let denied: boolean;
    try {
      if (!isOrgPath && user.store_id) {
        const state = await this.planAccess.blockedForStore(user.store_id);
        current = state.current;
        denied = state.blocked.includes(moduleKey);
        if (!denied) return true;
        mode = await this.modeService.planModeForStore(user.store_id);
      } else if (isOrgPath && user.organization_id) {
        const blocked = await this.planAccess.blockedForOrganization(
          user.organization_id,
        );
        denied = blocked.includes(moduleKey);
        if (!denied) return true;
        mode = await this.modeService.planModeForOrganization();
      } else {
        return true;
      }
    } catch {
      return true;
    }

    const enforce = mode === 'enforce' && !saleFlow;
    this.auditLogger.record({
      source: 'backend',
      surface: 'api',
      store_id: isOrgPath ? null : (user.store_id ?? null),
      organization_id: user.organization_id ?? null,
      user_id: user.id ?? null,
      role: Array.isArray(user.roles) ? (user.roles[0] ?? null) : null,
      key: moduleKey,
      industry: [],
      decision: enforce ? 'blocked' : 'would_block',
      layer: 'plan',
      route: this.routeOf(req),
      mode,
    });
    if (!enforce) return true;
    // Never reached on a sale: `enforce` is false whenever `saleFlow` is true.

    const details = await this.planAccess.denial(moduleKey, current);
    throw new VendixHttpException(
      ErrorCodes.PLAN_MODULE_NOT_INCLUDED,
      'Tu plan actual no incluye este módulo.',
      { ...details },
    );
  }

  private routeOf(req: Request): string {
    const pattern: string | undefined = (req as { route?: { path?: string } })
      ?.route?.path;
    const path =
      pattern ?? String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
    return `${String(req?.method ?? 'GET').toUpperCase()} ${path}`;
  }
}

import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ResponseService } from '../../../common/responses/response.service';
import { AccessGateService } from '../../../common/access/access-gate.service';
import { AccessAuditBatchDto } from '../../../common/access/dto/access-audit-events.dto';
import { PlanAccessService } from '../subscriptions/services/plan-access.service';
import { SkipSubscriptionGate } from '../subscriptions/decorators/skip-subscription-gate.decorator';

/**
 * apps-f4: any authenticated store-admin user may read the gate state and
 * report audit events (no `@Permissions`: it is the gate's own plumbing).
 * DomainScopeGuard already confines `/store/*` to STORE_ADMIN tokens.
 */
@Controller('store/access-gate')
export class StoreAccessGateController {
  constructor(
    private readonly accessGate: AccessGateService,
    private readonly responseService: ResponseService,
    private readonly planAccess: PlanAccessService,
  ) {}

  @Get()
  async getState(@Req() req: any) {
    // Plan layer (plan_module_rules): what the plan in force does not include
    // and which plans do. Its own `mode` (separate Redis flag).
    const [state, plan] = await Promise.all([
      this.accessGate.getStoreState(req.user),
      this.planAccess.storeState(req.user?.store_id),
    ]);
    const data = { ...state, plan };
    return this.responseService.success(data, 'Estado de la compuerta');
  }

  // Not a business write: must keep working for stores without subscription.
  @SkipSubscriptionGate()
  @Post('audit')
  async audit(@Req() req: any, @Body() body: AccessAuditBatchDto) {
    const data = await this.accessGate.recordStoreEvents(req.user, body);
    return this.responseService.success(data, 'Eventos registrados');
  }
}

import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ResponseService } from '../../../common/responses/response.service';
import { AccessGateService } from '../../../common/access/access-gate.service';
import { AccessAuditBatchDto } from '../../../common/access/dto/access-audit-events.dto';
import { PlanAccessService } from '../../store/subscriptions/services/plan-access.service';

/**
 * apps-f4: ORG_ADMIN counterpart of `/store/access-gate`. No `@Permissions`
 * (any authenticated org-admin user); DomainScopeGuard confines
 * `/organization/*` to ORG_ADMIN tokens.
 */
@Controller('organization/access-gate')
export class OrgAccessGateController {
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
      this.accessGate.getOrganizationState(req.user),
      this.planAccess.organizationState(req.user?.organization_id),
    ]);
    const data = { ...state, plan };
    return this.responseService.success(data, 'Estado de la compuerta');
  }

  @Post('audit')
  async audit(@Req() req: any, @Body() body: AccessAuditBatchDto) {
    const data = await this.accessGate.recordOrganizationEvents(req.user, body);
    return this.responseService.success(data, 'Eventos registrados');
  }
}

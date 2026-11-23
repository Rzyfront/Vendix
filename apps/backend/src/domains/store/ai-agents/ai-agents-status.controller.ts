import { Controller, Get, UseGuards } from '@nestjs/common';
import { AgentRuntimeConfigService } from '../../../ai-engine/agent-runtime-config.service';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { SkipSubscriptionGate } from '../subscriptions/decorators/skip-subscription-gate.decorator';

/**
 * Same "why is it off" answer the super admin sees for this store: the plan
 * or the store switch. Read-only, so it stays reachable without a plan.
 */
@SkipSubscriptionGate()
@Controller('store/ai-agents')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class AIAgentsStatusController {
  constructor(
    private readonly runtime: AgentRuntimeConfigService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('status')
  async status() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const agents = await this.runtime.getAgentStatuses(storeId);
    return this.responseService.success(
      { agents },
      'Agent status retrieved successfully',
    );
  }
}

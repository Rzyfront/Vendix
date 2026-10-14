import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { DecideServiceProposalDto } from './dto/decide-service-proposal.dto';
import { ServiceBudgetsService } from './service-budgets.service';

@Controller('ecommerce/service-proposals')
export class ServiceProposalDecisionController {
  constructor(
    private readonly serviceBudgetsService: ServiceBudgetsService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Post(':token/decision')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async decide(
    @Param('token') token: string,
    @Body() dto: DecideServiceProposalDto,
  ) {
    return this.responseService.updated(
      await this.serviceBudgetsService.decideWithToken(token, dto),
      'Decisión registrada.',
    );
  }
}

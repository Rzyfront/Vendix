import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { ResponseService, SuccessResponse } from '@common/responses';
import { PublicPlansService, PublicPlanDto } from './public-plans.service';

/**
 * 📦 PublicPlansController
 *
 * Provides unauthenticated access to the active SaaS subscription plans.
 * Used by the marketing/landing page to display the pricing table.
 *
 * Security notes:
 * - @Public() bypasses JWT guard (intentional — pricing is public data).
 * - @Throttle limits to 100 requests/min per IP to prevent DDoS/scraping.
 * - Service layer whitelists only safe public fields (no cost_* / partner_* data).
 *
 * Route: GET /api/public/plans
 */
@Controller('public/plans')
export class PublicPlansController {
  private readonly logger = new Logger(PublicPlansController.name);

  constructor(
    private readonly publicPlansService: PublicPlansService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * GET /api/public/plans
   *
   * Returns all active subscription plans with public-safe fields only.
   * Rate-limited to 100 requests per minute per IP.
   */
  @Public()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(): Promise<SuccessResponse<PublicPlanDto[]>> {
    this.logger.log('GET /public/plans — public pricing request');

    const plans = await this.publicPlansService.findAll();

    return this.responseService.success(plans, 'Subscription plans retrieved successfully');
  }
}

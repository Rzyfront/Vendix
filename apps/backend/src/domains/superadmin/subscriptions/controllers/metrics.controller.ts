import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { ResponseService } from '../../../../common/responses/response.service';
import { SubscriptionMetricsService } from '../services/subscription-metrics.service';

type PeriodPreset = 'last_30' | 'last_90' | 'last_365' | 'custom';

@ApiTags('Superadmin Subscriptions - Metrics')
@Controller('superadmin/subscriptions/metrics')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SubscriptionMetricsController {
  constructor(
    private readonly metrics: SubscriptionMetricsService,
    private readonly response: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:read')
  @Get()
  @ApiOperation({
    summary: 'SaaS metrics dashboard: MRR, Churn, ARPU, LTV, breakdowns',
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['last_30', 'last_90', 'last_365', 'custom'],
  })
  @ApiQuery({ name: 'start', required: false, type: String })
  @ApiQuery({ name: 'end', required: false, type: String })
  @ApiQuery({ name: 'evolution_months', required: false, type: Number })
  async getMetrics(
    @Query('period') period: PeriodPreset = 'last_30',
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('evolution_months') evolutionMonths?: string,
  ) {
    const { periodStart, periodEnd } = this.resolvePeriod(period, start, end);
    const months = this.parseEvolutionMonths(evolutionMonths);

    const [mrr, churn, arpu, ltv, activeBreakdown, mrrEvolution] =
      await Promise.all([
        this.metrics.getMRR(periodStart, periodEnd),
        this.metrics.getChurnRate(periodStart, periodEnd),
        this.metrics.getARPU(periodStart, periodEnd),
        this.metrics.getLTV(periodStart, periodEnd),
        this.metrics.getActiveBreakdown(),
        this.metrics.getMRREvolution(months),
      ]);

    const payload = {
      period: {
        preset: period,
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
      },
      mrr: {
        value: mrr.value.toString(),
        monthly_avg: mrr.monthly_avg.toString(),
        currency: mrr.currency,
      },
      churn: {
        rate_pct: churn.rate_pct,
        cancelled_count: churn.cancelled_count,
        active_at_start: churn.active_at_start,
      },
      arpu: {
        value: arpu.value.toString(),
        currency: arpu.currency,
        active_subs: arpu.active_subs,
      },
      ltv: {
        value: ltv.value ? ltv.value.toString() : null,
        currency: ltv.currency,
      },
      active_breakdown: activeBreakdown,
      mrr_evolution: mrrEvolution.map((p) => ({
        month: p.month,
        mrr: p.mrr.toString(),
      })),
    };

    return this.response.success(payload, 'Subscription metrics retrieved');
  }

  // ─── helpers ───────────────────────────────────────────────────────
  private resolvePeriod(
    preset: PeriodPreset,
    start?: string,
    end?: string,
  ): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    if (preset === 'custom') {
      if (!start || !end) {
        throw new BadRequestException(
          'period=custom requires start and end ISO date params',
        );
      }
      const periodStart = new Date(start);
      const periodEnd = new Date(end);
      if (
        Number.isNaN(periodStart.getTime()) ||
        Number.isNaN(periodEnd.getTime())
      ) {
        throw new BadRequestException('Invalid start/end dates');
      }
      if (periodEnd.getTime() <= periodStart.getTime()) {
        throw new BadRequestException('end must be after start');
      }
      return { periodStart, periodEnd };
    }

    const days = preset === 'last_365' ? 365 : preset === 'last_90' ? 90 : 30;
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { periodStart, periodEnd };
  }

  private parseEvolutionMonths(raw?: string): number {
    if (!raw) return 12;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 12;
    return Math.min(36, Math.floor(n));
  }
}

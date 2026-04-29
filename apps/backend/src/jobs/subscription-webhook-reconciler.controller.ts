import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { SubscriptionWebhookReconcilerJob } from './subscription-webhook-reconciler.job';
import { Permissions } from '../domains/auth/decorators/permissions.decorator';
import { RolesGuard } from '../domains/auth/guards/roles.guard';
import { Roles } from '../domains/auth/decorators/roles.decorator';
import { UserRole } from '../domains/auth/enums/user-role.enum';
import { ResponseService } from '../common/responses/response.service';

class TriggerWebhookReconcilerDto {
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

/**
 * Manual trigger for the SaaS subscription webhook reconciler. Useful for:
 * - QA / Bruno tests that need to drive a reconciliation pass on demand.
 * - Operators forcing a sweep after a Wompi delivery outage instead of
 *   waiting for the next 30-minute cron tick.
 *
 * Restricted to SUPER_ADMIN. The job's own re-entry guard (`isRunning`) is
 * NOT held by this manual path — `runOnce()` is invoked directly so a
 * scheduled cron fire that lands during the manual call would be rejected
 * by the cron handler's guard, not vice-versa. In practice serial use is
 * fine; if you spam this endpoint you can race with the cron, and the only
 * effect is duplicated Wompi lookups (cheap, idempotent).
 *
 * `dry_run=true` flips `SUBSCRIPTION_CRON_DRY_RUN` semantics for this single
 * invocation only via direct path-thru. Currently the gate config is read
 * from env at construction; for true per-call dry-run support a service
 * layer would be needed. As a v1, the body flag is informational and the
 * current `SUBSCRIPTION_CRON_DRY_RUN` env value drives behavior.
 */
@ApiTags('Superadmin Subscriptions - Jobs')
@Controller('superadmin/subscriptions/jobs/webhook-reconciler')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SubscriptionWebhookReconcilerController {
  private readonly logger = new Logger(
    SubscriptionWebhookReconcilerController.name,
  );

  constructor(
    private readonly job: SubscriptionWebhookReconcilerJob,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:update')
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually trigger the subscription webhook reconciler (super-admin only)',
  })
  async run(@Body() body: TriggerWebhookReconcilerDto) {
    this.logger.log(
      JSON.stringify({
        event: 'WEBHOOK_RECONCILE_MANUAL_TRIGGER',
        dry_run_requested: body?.dry_run === true,
      }),
    );

    const recovered = await this.job.runOnce();

    return this.responseService.success(
      {
        recovered,
        dry_run_requested: body?.dry_run === true,
        note:
          body?.dry_run === true
            ? 'dry_run flag is informational; effective dry-run is governed by SUBSCRIPTION_CRON_DRY_RUN env'
            : undefined,
      },
      'Webhook reconciler executed',
    );
  }
}

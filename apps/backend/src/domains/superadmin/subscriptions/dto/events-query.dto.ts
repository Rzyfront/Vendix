import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class EventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsIn([
    'created',
    'activated',
    'renewed',
    'trial_started',
    'trial_ended',
    'payment_succeeded',
    'payment_failed',
    'state_transition',
    'plan_changed',
    'cancelled',
    'reactivated',
    'promotional_applied',
    'partner_override_applied',
    'partner_commission_accrued',
    'partner_commission_paid',
  ])
  type?: string;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}

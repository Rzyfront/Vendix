import { IsOptional, IsString, IsInt, IsEnum, Min } from 'class-validator';
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
  @IsEnum(['created', 'activated', 'renewed', 'trial_started', 'trial_ended', 'payment_succeeded', 'payment_failed', 'state_transition', 'plan_changed', 'cancelled', 'reactivated', 'promotional_applied', 'partner_override_applied', 'partner_commission_accrued', 'partner_commission_paid'])
  type?: string;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}

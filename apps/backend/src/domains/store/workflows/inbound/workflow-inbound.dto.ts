import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { INBOUND_MAX_RATE_PER_MINUTE } from './workflow-inbound.rules';

export class UpdateInboundHookDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INBOUND_MAX_RATE_PER_MINUTE)
  rate_limit_per_minute?: number;
}

export class UpdateMailboxDto {
  @IsBoolean()
  is_active!: boolean;
}

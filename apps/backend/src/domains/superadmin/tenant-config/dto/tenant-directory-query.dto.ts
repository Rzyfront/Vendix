import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const DIAN_ENABLEMENT_STATUSES = [
  'not_started',
  'testing',
  'test_set_passed',
  'enabled',
  'suspended',
  'expired',
] as const;

export type DianEnablementStatus = (typeof DIAN_ENABLEMENT_STATUSES)[number];

export class TenantDirectoryQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(DIAN_ENABLEMENT_STATUSES)
  enablement_status?: DianEnablementStatus;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

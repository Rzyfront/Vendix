import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { membership_access_result_enum } from '@prisma/client';

/**
 * Query DTO for listing access logs (audit trail).
 */
export class AccessLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customer_id?: number;

  @IsOptional()
  @IsEnum(membership_access_result_enum)
  result?: membership_access_result_enum;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}

import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { membership_status_enum } from '@prisma/client';

/**
 * Query DTO for the membership list endpoint.
 */
export class MembershipQueryDto {
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
  @IsEnum(membership_status_enum)
  status?: membership_status_enum;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customer_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  plan_id?: number;
}

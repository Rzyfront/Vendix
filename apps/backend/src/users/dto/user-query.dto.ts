import { IsOptional, IsString, IsInt, Min, IsEnum, IsBoolean, IsDateString } from 'class-validator';
import { user_state_enum } from '@prisma/client';
import { Transform } from 'class-transformer';

export class UserQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(user_state_enum)
  state?: user_state_enum;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  include_inactive?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  email_verified?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  two_factor_enabled?: boolean;
}

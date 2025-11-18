import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
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
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  organization_id?: number;

  @IsOptional()
  @IsString()
  role?: string;
}

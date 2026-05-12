import {
  IsOptional,
  IsInt,
  IsEnum,
  IsBoolean,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { location_type_enum } from '@prisma/client';

export class OrgLocationQueryDto {
  /** Optional breakdown filter when operating_scope=ORGANIZATION; required when STORE. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsEnum(location_type_enum)
  type?: location_type_enum;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

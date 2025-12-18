import { IsOptional, IsInt, IsEnum, IsBoolean, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { location_type_enum } from '@prisma/client';

export class LocationQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  organization_id?: number;

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

import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { dispatch_route_status_enum } from '@prisma/client';

export class DispatchRouteQueryDto {
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
  @IsEnum(dispatch_route_status_enum)
  status?: dispatch_route_status_enum;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  driver_user_id?: number;

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc';

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}

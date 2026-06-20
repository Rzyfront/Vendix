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

  /**
   * Filter by status. Accepts a single value (`?status=draft`) or a
   * comma-separated list (`?status=draft,dispatched`) — the wizard uses
   * the latter to populate the "Existing route" picker with routes that
   * can still accept new stops.
   */
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  )
  @IsEnum(dispatch_route_status_enum, { each: true })
  status?: dispatch_route_status_enum | dispatch_route_status_enum[];

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

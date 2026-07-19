import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query params for `GET /store/carrier/routes` (carrier route history).
 *
 * Mirrors `PoolQueryDto` pagination coercion (page/limit arrive as query
 * strings → coerced to int via @Transform). `status` optionally narrows to a
 * single `dispatch_route_status_enum` value; an unknown value simply matches no
 * rows (no throw).
 */
export class RouteHistoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;
}

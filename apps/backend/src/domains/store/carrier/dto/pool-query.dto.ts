import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query params for `GET /store/carrier/pool` (Repartos Fase B6).
 * Mirrors the pagination shape used across store admin list endpoints
 * (page/limit are query strings → coerced to int via @Transform).
 */
export class PoolQueryDto {
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
  search?: string;
}

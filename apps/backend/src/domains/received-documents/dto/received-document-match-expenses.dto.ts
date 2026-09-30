import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

function strictInteger(value: unknown): unknown {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
}

function normalizeSearch(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

/** Query contract for the manual-only expense destination picker. */
export class ReceivedDocumentMatchExpensesQueryDto {
  @IsOptional()
  @Transform(({ value }) => normalizeSearch(value))
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;
}

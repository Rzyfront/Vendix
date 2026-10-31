import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

/**
 * `filter` is validated by the segment compiler (closed catalog of fields and
 * operators), not field by field here: anything outside it is a 400.
 */
export class CreateCrmSegmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsObject()
  filter!: Record<string, unknown>;
}

export class UpdateCrmSegmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}

export class PreviewCrmSegmentDto {
  @IsObject()
  filter!: Record<string, unknown>;
}

export class CrmSegmentCustomersQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

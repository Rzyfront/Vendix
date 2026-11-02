import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

  /**
   * `false` creates a manual segment: no rules, only customers added by hand
   * from their profile. Defaults to a rule segment.
   */
  @IsOptional()
  @IsBoolean()
  is_dynamic?: boolean;

  /** Required for a rule segment; ignored by a manual one. */
  @ValidateIf((dto: CreateCrmSegmentDto) => dto.is_dynamic !== false)
  @IsObject()
  filter?: Record<string, unknown>;
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

/** `customer_ids=1,2,3`: the customers of a list page (at most 100). */
export class CrmMembershipsQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    String(value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number),
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  customer_ids!: number[];
}

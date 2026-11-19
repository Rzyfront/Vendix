import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** entity_metadata_values.value_number is Decimal(12, 4). */
const MAX_NUMBER = 99_999_999.9999;

/** `null` goes back to the CRM default template. */
export class SetCustomerDataTemplateDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  template_id!: number | null;
}

/** One answer; an entry with every value null deletes the answer. */
export class CustomerDataSheetValueDto {
  @IsInt()
  @Min(1)
  field_id!: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  value_text?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-MAX_NUMBER)
  @Max(MAX_NUMBER)
  value_number?: number | null;

  /** A real calendar date: 2026-13-45 or 2026-02-30 are rejected. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY, { message: 'value_date must be YYYY-MM-DD' })
  @IsDateString({ strict: true, strictSeparator: true })
  value_date?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  value_bool?: boolean | null;

  /** Multi-select answers: a short list of option values. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  value_json?: string[] | null;
}

export class SaveCustomerDataSheetValuesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomerDataSheetValueDto)
  values!: CustomerDataSheetValueDto[];
}

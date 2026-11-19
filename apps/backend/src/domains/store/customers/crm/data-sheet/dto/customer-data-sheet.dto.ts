import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
  @IsNumber()
  value_number?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY, { message: 'value_date must be YYYY-MM-DD' })
  value_date?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  value_bool?: boolean | null;

  /** Multi-select answers and other structured values. */
  @IsOptional()
  value_json?: unknown;
}

export class SaveCustomerDataSheetValuesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomerDataSheetValueDto)
  values!: CustomerDataSheetValueDto[];
}

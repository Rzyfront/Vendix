import {
  ArrayMaxSize,
  IsArray,
  ValidateBy,
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

/** Most attachments one documents answer may hold (mirrors DOCUMENT_MAX_FILES). */
const MAX_FILES = 10;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Multi-select answers: a short list of option values. */
const isShortStringList = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every((item) => typeof item === 'string' && item.length <= 500);

/** Documents answer: `{ files: [{ key, name?, size?, mime_type?, uploaded_at? }] }`. */
const isFilesAnswer = (value: unknown) => {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).some((k) => k !== 'files')) return false;
  const files = value['files'];
  return (
    Array.isArray(files) &&
    files.length <= MAX_FILES &&
    files.every(
      (file) =>
        isPlainObject(file) &&
        typeof file['key'] === 'string' &&
        file['key'].length > 0 &&
        file['key'].length <= 1000 &&
        (file['name'] === undefined ||
          (typeof file['name'] === 'string' && file['name'].length <= 255)) &&
        (file['size'] === undefined || typeof file['size'] === 'number') &&
        (file['mime_type'] === undefined ||
          (typeof file['mime_type'] === 'string' &&
            file['mime_type'].length <= 255)) &&
        (file['uploaded_at'] === undefined ||
          typeof file['uploaded_at'] === 'string'),
    )
  );
};

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

/** One stored attachment of a documents answer. */
export interface CustomerDataSheetFileDto {
  key: string;
  name?: string;
  size?: number;
  mime_type?: string;
  uploaded_at?: string;
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

  /**
   * Multi-select answers (a short list of option values) or the attachments
   * of a documents field (`{ files: [...] }`).
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateBy({
    name: 'isCustomerDataSheetJson',
    validator: {
      validate: (value) => isShortStringList(value) || isFilesAnswer(value),
      defaultMessage: () =>
        'value_json must be a short list of strings or { files: [...] }',
    },
  })
  value_json?: string[] | { files: CustomerDataSheetFileDto[] } | null;
}

export class SaveCustomerDataSheetValuesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomerDataSheetValueDto)
  values!: CustomerDataSheetValueDto[];
}

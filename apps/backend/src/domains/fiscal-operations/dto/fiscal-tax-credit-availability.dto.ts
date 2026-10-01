import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { tax_declaration_type_enum } from '@prisma/client';

export class FiscalTaxCreditAvailabilityQueryDto {
  @IsEnum(tax_declaration_type_enum)
  tax_type!: tax_declaration_type_enum;

  @IsString()
  @MaxLength(100)
  @Matches(/\S/, { message: 'jurisdiction_key must not be blank' })
  jurisdiction_key!: string;

  @IsString()
  @IsDateString({ strict: true }, { message: 'as_of must be a valid YYYY-MM-DD date' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'as_of must be a valid YYYY-MM-DD date',
  })
  as_of!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;
}

/** Construct midnight UTC only after the strict date-only DTO contract is validated. */
export function parseFiscalAsOfDate(asOf: string): Date {
  const date = new Date(`${asOf}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== asOf
  ) {
    throw new Error('as_of must be a valid YYYY-MM-DD date');
  }
  return date;
}

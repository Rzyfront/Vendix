import { DOCUMENT_TYPE_CODES } from '@common/constants/document-types';
import { Type, Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEmail,
  IsNotEmpty,
  IsIn,
  MaxLength,
  Matches,
  ValidateIf,
  ValidateNested,
  IsDefined,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class InvoiceHolderAddressDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address_line1: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) city: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state_province: string;
  @IsIn(['CO']) country_code: string;
  @Matches(/^\d{5}$/) municipality_code: string;
}
export class SubmitInvoiceDataDto {
  @IsIn(['NATURAL', 'JURIDICA']) person_type: 'NATURAL' | 'JURIDICA';
  @ValidateIf((o) => o.person_type !== 'JURIDICA')
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  first_name?: string;
  @ValidateIf((o) => o.person_type !== 'JURIDICA')
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  last_name?: string;
  @ValidateIf((o) => o.person_type === 'JURIDICA')
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legal_name?: string;
  @IsIn(DOCUMENT_TYPE_CODES) document_type: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  document_number: string;
  @IsOptional() @Matches(/^\d$/) verification_digit?: string;
  @Transform(trim) @IsNotEmpty() @IsEmail() @MaxLength(255) email: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) phone?: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => InvoiceHolderAddressDto)
  address: InvoiceHolderAddressDto;
}

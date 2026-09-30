import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { tax_type_enum } from '@prisma/client';
import { ReceivedDocumentType } from '../interfaces/received-document.interface';

const DOCUMENT_TYPES: ReceivedDocumentType[] = [
  'invoice',
  'credit_note',
  'debit_note',
  'non_electronic',
];
const TAX_TYPES = [...Object.values(tax_type_enum), 'unclassified'];
const PROCESSING_STATUSES = ['processing', 'ready', 'pending_ocr', 'error', 'duplicate'];
const VALIDATION_STATUSES = ['pending', 'valid', 'invalid', 'needs_review'];
const REVIEW_STATUSES = ['pending', 'reviewed'];
const FISCAL_STATUSES = ['pending', 'ready', 'recognized', 'not_applicable'];
const SOURCE_CHANNELS = ['manual', 'xml', 'email', 'api', 'automated'];

const MONEY_15_2 = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;
const QUANTITY_15_4 = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,4})?$/;
const UNIT_PRICE_15_6 = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const RATE_9_5 = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,5})?$/;

export class ReceivedDocumentQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @IsIn(PROCESSING_STATUSES)
  processing_status?: string;

  @IsOptional()
  @IsIn(VALIDATION_STATUSES)
  validation_status?: string;

  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  review_status?: string;

  @IsOptional()
  @IsIn(FISCAL_STATUSES)
  fiscal_status?: string;

  @IsOptional()
  @IsIn(SOURCE_CHANNELS)
  source_channel?: string;
}

export class ReceivedDocumentTaxDto {
  @IsIn(TAX_TYPES)
  tax_type!: tax_type_enum | 'unclassified';

  @IsOptional()
  @IsString()
  @Length(1, 30)
  scheme_code?: string;

  @IsString()
  @Length(1, 100)
  tax_name!: string;

  @Matches(RATE_9_5)
  rate!: string;

  @Matches(MONEY_15_2)
  base_amount!: string;

  @Matches(MONEY_15_2)
  amount!: string;
}

export class ReceivedDocumentItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  external_code?: string;

  @IsString()
  @Length(1, 2000)
  description!: string;

  @Matches(QUANTITY_15_4)
  quantity!: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  unit_code?: string;

  @Matches(UNIT_PRICE_15_6)
  unit_price!: string;

  @Matches(MONEY_15_2)
  discount_amount!: string;

  @Matches(MONEY_15_2)
  net_amount!: string;

  @Matches(MONEY_15_2)
  total_amount!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReceivedDocumentTaxDto)
  taxes?: ReceivedDocumentTaxDto[];
}

/**
 * Human-entered fiscal facts only. Tenant/entity/status/approval/link/stock
 * fields are deliberately not part of this request shape.
 */
export class ManualReceivedDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  document_type!: ReceivedDocumentType;

  @IsString()
  @Length(1, 100)
  invoice_number!: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  document_key?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  reference_key?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  reference_number?: string;

  @IsString()
  @Length(1, 50)
  issuer_tax_id!: string;

  @IsString()
  @Length(1, 255)
  issuer_name!: string;

  @IsString()
  @Length(1, 50)
  receiver_tax_id!: string;

  @IsString()
  @Length(1, 255)
  receiver_name!: string;

  @IsDateString({ strict: true })
  issue_date!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  due_date?: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Matches(MONEY_15_2)
  subtotal_amount!: string;

  @Matches(MONEY_15_2)
  discount_amount!: string;

  @IsOptional()
  @Matches(MONEY_15_2)
  charge_amount?: string;

  @IsOptional()
  @Matches(MONEY_15_2)
  tax_exclusive_amount?: string;

  @IsOptional()
  @Matches(MONEY_15_2)
  tax_inclusive_amount?: string;

  @Matches(MONEY_15_2)
  tax_amount!: string;

  @Matches(MONEY_15_2)
  total_amount!: string;

  @IsOptional()
  @Matches(MONEY_15_2)
  prepaid_amount?: string;

  @IsOptional()
  @Matches(/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/)
  payable_rounding_amount?: string;

  @IsOptional()
  @Matches(MONEY_15_2)
  withholding_amount?: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  reviewer_note?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReceivedDocumentItemDto)
  items!: ReceivedDocumentItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceivedDocumentTaxDto)
  taxes?: ReceivedDocumentTaxDto[];
}

export class UpdateReceivedDocumentReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  reviewer_note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualReceivedDocumentDto)
  facts?: ManualReceivedDocumentDto;
}

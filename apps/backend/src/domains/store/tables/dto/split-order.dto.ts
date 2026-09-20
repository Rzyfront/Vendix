import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsObject, Matches, ValidateIf,
  IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SPLIT_MODES = ['equal', 'custom'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export class SplitItemGroupDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  order_item_ids!: number[];
}

export class SplitAccountCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  customer_id?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer_alias?: string | null;
}

export class SplitRequestContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source_version?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotency_key?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SplitAccountCustomerDto)
  accounts?: SplitAccountCustomerDto[];
}

export class SplitByItemsDto extends SplitRequestContextDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SplitItemGroupDto)
  item_groups!: SplitItemGroupDto[];
}

export class SplitByAmountDto extends SplitRequestContextDto {
  @IsOptional()
  @IsIn(SPLIT_MODES)
  mode?: SplitMode = 'equal';

  @IsInt()
  @Min(2)
  @Max(20)
  @Type(() => Number)
  n_splits!: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0.01, { each: true })
  @Type(() => Number)
  amounts?: number[];
}

export class SplitPreviewDto extends SplitRequestContextDto {
  @IsIn(['equal', 'custom', 'items'])
  mode!: 'equal' | 'custom' | 'items';

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(20)
  @Type(() => Number)
  n_splits?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Min(0.01, { each: true })
  @Type(() => Number)
  amounts?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SplitItemGroupDto)
  item_groups?: SplitItemGroupDto[];
}

export class CancelFinancialSplitDto {
  @IsString()
  @MaxLength(64)
  source_version!: string;
}

/** Tokenized Wompi methods only; never accepts raw card/PAN credentials. */
export class SplitWompiPaymentMethodDto {
  @IsIn(['CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER', 'BANCOLOMBIA_COLLECT', 'BANCOLOMBIA_QR', 'DAVIPLATA', 'SU_PLUS', 'PCOL'])
  type!: string;

  @ValidateIf((method) => method.type === 'CARD')
  @IsString()
  @Matches(/^tok_[A-Za-z0-9_-]+$/)
  @MaxLength(255)
  token?: string;

  @ValidateIf((method) => method.type === 'CARD')
  @IsInt()
  @Min(1)
  @Max(36)
  installments?: number;

  @ValidateIf((method) => method.type === 'NEQUI')
  @IsString()
  @Matches(/^3[0-9]{9}$/)
  phone_number?: string;

  @ValidateIf((method) => method.type === 'PSE')
  @IsIn([0, 1])
  user_type?: number;

  @ValidateIf((method) => ['PSE', 'DAVIPLATA', 'SU_PLUS'].includes(method.type))
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  user_legal_id_type?: string;

  @ValidateIf((method) => ['PSE', 'DAVIPLATA', 'SU_PLUS'].includes(method.type))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  user_legal_id?: string;

  @ValidateIf((method) => method.type === 'PSE')
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  financial_institution_code?: string;

  @ValidateIf((method) => method.type === 'PSE' || method.payment_description !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  payment_description?: string;
}

export class SplitAccountPayDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_payment_method_id!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount!: number;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotency_key!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amount_received?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bank_account_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SplitWompiPaymentMethodDto)
  wompi_payment_method?: SplitWompiPaymentMethodDto;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  return_url?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  cancel_url?: string;
}

export class ConfirmSplitAccountPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;
}

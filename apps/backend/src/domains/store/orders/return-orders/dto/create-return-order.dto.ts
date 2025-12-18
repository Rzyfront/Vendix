import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReturnOrderItemDto {
  @IsOptional()
  @IsNumber()
  order_item_id?: number;

  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsOptional()
  @IsNumber()
  product_variant_id?: number;

  @IsNumber()
  @IsNotEmpty()
  quantity_returned: number;

  @IsEnum([
    'defective',
    'wrong_item',
    'damaged_shipping',
    'customer_dissatisfaction',
    'expired',
    'other',
  ])
  @IsNotEmpty()
  return_reason:
    | 'defective'
    | 'wrong_item'
    | 'damaged_shipping'
    | 'customer_dissatisfaction'
    | 'expired'
    | 'other';

  @IsEnum(['new', 'used', 'damaged', 'defective', 'missing_parts'])
  @IsNotEmpty()
  condition_on_return:
    | 'new'
    | 'used'
    | 'damaged'
    | 'defective'
    | 'missing_parts';

  @IsOptional()
  @IsNumber()
  refund_amount?: number;

  @IsNotEmpty()
  @IsBoolean()
  restock: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateReturnOrderDto {
  @IsNumber()
  @IsNotEmpty()
  customer_id: number;

  @IsOptional()
  @IsNumber()
  order_id?: number;

  @IsOptional()
  @IsNumber()
  store_id?: number;

  @IsOptional()
  @IsNumber()
  partner_id?: number;

  @IsEnum(['refund', 'replacement', 'credit'])
  @IsOptional()
  type?: 'refund' | 'replacement' | 'credit';

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  return_date?: Date;

  @IsOptional()
  @IsNumber()
  total_refund_amount?: number;

  @IsEnum([
    'defective',
    'wrong_item',
    'damaged_shipping',
    'customer_dissatisfaction',
    'expired',
    'other',
  ])
  @IsNotEmpty()
  reason:
    | 'defective'
    | 'wrong_item'
    | 'damaged_shipping'
    | 'customer_dissatisfaction'
    | 'expired'
    | 'other';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsEnum(['original_payment', 'store_credit', 'cash', 'bank_transfer'])
  refund_method?:
    | 'original_payment'
    | 'store_credit'
    | 'cash'
    | 'bank_transfer';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateReturnOrderItemDto)
  items: CreateReturnOrderItemDto[];
}

import {
  IsInt,
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateDispatchNoteItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  location_id?: number;

  @IsInt()
  @Min(0)
  ordered_quantity: number;

  @IsInt()
  @Min(1)
  dispatched_quantity: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  discount_amount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  tax_amount?: number;

  @IsOptional()
  @IsString()
  lot_serial?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sales_order_item_id?: number;
}

export class CreateDispatchNoteDto {
  @IsInt()
  @Min(1)
  customer_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sales_order_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dispatch_location_id?: number;

  @IsOptional()
  @IsDateString()
  emission_date?: string;

  @IsOptional()
  @IsDateString()
  agreed_delivery_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDispatchNoteItemDto)
  items: CreateDispatchNoteItemDto[];
}

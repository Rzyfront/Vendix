import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFromSalesOrderItemDto {
  @IsInt()
  @Min(1)
  sales_order_item_id: number;

  @IsInt()
  @Min(1)
  dispatched_quantity: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  location_id?: number;

  @IsOptional()
  @IsString()
  lot_serial?: string;
}

export class CreateFromSalesOrderDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  dispatch_location_id?: number;

  @IsOptional()
  @IsDateString()
  agreed_delivery_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFromSalesOrderItemDto)
  items: CreateFromSalesOrderItemDto[];
}

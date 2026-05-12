import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveItemDto {
  @IsInt()
  id: number; // purchase_order_item id

  @IsInt()
  @Min(0)
  quantity_received: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

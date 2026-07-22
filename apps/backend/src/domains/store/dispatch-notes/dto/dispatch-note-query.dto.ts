import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { dispatch_note_status_enum } from '@prisma/client';

export class DispatchNoteQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(dispatch_note_status_enum)
  status?: dispatch_note_status_enum;

  @IsOptional()
  @IsEnum(['outbound', 'inbound'])
  direction?: 'outbound' | 'inbound';

  @IsOptional()
  @IsEnum([
    'customer_delivery',
    'customer_return',
    'transfer_out',
    'transfer_in',
    'purchase_receipt',
  ])
  subtype?:
    | 'customer_delivery'
    | 'customer_return'
    | 'transfer_out'
    | 'transfer_in'
    | 'purchase_receipt';

  @IsOptional()
  @IsEnum([
    'sale',
    'sample',
    'consignment',
    'replacement_shipment',
    'loan',
    'defective',
    'wrong_item',
    'cancellation',
    'warranty',
    'overdelivery_return',
    'replenishment',
    'rebalancing',
    'returned_from_consignee',
    'normal_purchase',
    'replacement_for_damage',
    'sample_received',
  ])
  reason?:
    | 'sale'
    | 'sample'
    | 'consignment'
    | 'replacement_shipment'
    | 'loan'
    | 'defective'
    | 'wrong_item'
    | 'cancellation'
    | 'warranty'
    | 'overdelivery_return'
    | 'replenishment'
    | 'rebalancing'
    | 'returned_from_consignee'
    | 'normal_purchase'
    | 'replacement_for_damage'
    | 'sample_received';

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  sales_order_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  supplier_id?: number;

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc';

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}

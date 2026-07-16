import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateDispatchNoteItemDto } from './create-dispatch-note.dto';

/**
 * DTO for creating a customer return dispatch note (inbound).
 * related_dispatch_id is REQUIRED — must point to the original outbound dispatch.
 */
export class CreateReturnDispatchDto {
  @IsEnum(['inbound'])
  direction: 'inbound';

  @IsEnum(['customer_return'])
  subtype: 'customer_return';

  @IsEnum([
    'defective',
    'wrong_item',
    'cancellation',
    'warranty',
    'overdelivery_return',
  ])
  reason:
    | 'defective'
    | 'wrong_item'
    | 'cancellation'
    | 'warranty'
    | 'overdelivery_return';

  @IsInt()
  @Min(1)
  customer_id: number;

  @IsInt()
  @Min(1)
  related_dispatch_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  to_location_id?: number;

  @IsOptional()
  @IsDateString()
  emission_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDispatchNoteItemDto)
  items: CreateDispatchNoteItemDto[];
}
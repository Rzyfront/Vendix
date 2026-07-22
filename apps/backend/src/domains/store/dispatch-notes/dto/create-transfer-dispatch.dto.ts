import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  ValidateIf,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateDispatchNoteItemDto } from './create-dispatch-note.dto';

/**
 * DTO for creating a transfer dispatch note (outbound or inbound).
 * Transfer_out: stock leaves from_location_id; transfer_in: stock arrives at to_location_id.
 * Cross-field validation (direction↔subtype consistency, cross-store scope) is in the service.
 */
export class CreateTransferDispatchDto {
  @IsEnum(['outbound', 'inbound'])
  direction: 'outbound' | 'inbound';

  @IsEnum(['transfer_out', 'transfer_in'])
  subtype: 'transfer_out' | 'transfer_in';

  @IsOptional()
  @IsEnum([
    'replenishment',
    'rebalancing',
    'returned_from_consignee',
  ])
  reason?: 'replenishment' | 'rebalancing' | 'returned_from_consignee';

  @IsInt()
  @Min(1)
  store_id: number;

  @IsInt()
  @Min(1)
  from_location_id: number;

  @IsInt()
  @Min(1)
  to_location_id: number;

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
import {
  IsInt,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddStopItemDto {
  @IsInt()
  @Min(1)
  dispatch_note_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  stop_sequence?: number;
}

export class AddStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AddStopItemDto)
  stops: AddStopItemDto[];
}

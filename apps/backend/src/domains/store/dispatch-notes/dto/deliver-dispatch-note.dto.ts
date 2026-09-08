import {
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';

export class DeliverDispatchNoteDto {
  @IsOptional()
  @IsDateString()
  actual_delivery_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  courier_name?: string;
}

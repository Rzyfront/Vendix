import { IsOptional, IsString, IsDateString } from 'class-validator';

export class DeliverDispatchNoteDto {
  @IsOptional()
  @IsDateString()
  actual_delivery_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

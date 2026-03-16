import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CloseSessionDto {
  @IsNumber()
  @Type(() => Number)
  actual_closing_amount: number;

  @IsOptional()
  @IsString()
  closing_notes?: string;
}

import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id: number;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

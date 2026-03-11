import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateEntryLineDto } from './create-journal-entry.dto';

export class UpdateJournalEntryDto {
  @IsOptional()
  @IsDateString()
  entry_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @Type(() => CreateEntryLineDto)
  lines?: CreateEntryLineDto[];
}

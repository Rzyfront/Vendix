import {
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsObject,
  IsDateString,
} from 'class-validator';

export class SetMetadataValueDto {
  @IsInt()
  field_id: number;

  @IsOptional()
  @IsString()
  value_text?: string;

  @IsOptional()
  @IsNumber()
  value_number?: number;

  @IsOptional()
  @IsDateString()
  value_date?: string;

  @IsOptional()
  @IsBoolean()
  value_bool?: boolean;

  @IsOptional()
  @IsObject()
  value_json?: Record<string, any>;
}

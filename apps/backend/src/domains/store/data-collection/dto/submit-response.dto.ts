import {
  IsArray,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsInt,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FieldResponseDto {
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

export class SubmitStepResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldResponseDto)
  responses: FieldResponseDto[];
}

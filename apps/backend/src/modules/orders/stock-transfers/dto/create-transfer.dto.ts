import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDate,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTransferItemDto {
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsOptional()
  @IsNumber()
  product_variant_id?: number;

  @IsNumber()
  @IsNotEmpty()
  quantity_requested: number;

  @IsOptional()
  @IsNumber()
  cost_per_unit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateTransferDto {
  @IsNumber()
  @IsNotEmpty()
  from_location_id: number;

  @IsNumber()
  @IsNotEmpty()
  to_location_id: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expected_completion_date?: Date;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferItemDto)
  items: CreateTransferItemDto[];
}

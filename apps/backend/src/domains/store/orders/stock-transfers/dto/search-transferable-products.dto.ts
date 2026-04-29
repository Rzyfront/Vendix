import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchTransferableProductsDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  search: string;

  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  from_location_id: number;

  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  to_location_id: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10;
}

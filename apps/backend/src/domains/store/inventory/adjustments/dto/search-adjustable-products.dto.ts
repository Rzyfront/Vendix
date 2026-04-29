import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchAdjustableProductsDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  search: string;

  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  location_id: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10;
}

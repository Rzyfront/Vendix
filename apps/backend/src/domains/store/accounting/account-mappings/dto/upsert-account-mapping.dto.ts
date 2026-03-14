import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MappingItemDto {
  @IsString()
  mapping_key: string;

  @IsNumber()
  @Type(() => Number)
  account_id: number;
}

export class UpsertAccountMappingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => MappingItemDto)
  mappings: MappingItemDto[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;
}

export class ResetAccountMappingDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;
}

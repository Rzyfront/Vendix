import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  IsDateString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CreateQuotationItemDto } from './create-quotation.dto';

export class PreviewContractQuotationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quotation_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  invoice_profile_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4900)
  contract_object?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  aiu_value?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'due_date debe tener formato YYYY-MM-DD.',
  })
  due_date?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  items?: CreateQuotationItemDto[];
}
